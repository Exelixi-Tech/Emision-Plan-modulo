'use strict';

/**
 * Fase 2 de post-emisión: REINTENTO del cobro (ingreso de caja) de los recibos
 * que quedaron pendientes porque el cobro al Core falló (`step: 'cobro_error'`),
 * típicamente por caída de red entre emisión y nest-api/Core (caso real: el
 * débito SyPago llegó a ACCP pero el cobro nunca se registró en Sis2000).
 *
 * SEGURIDAD — doble cobro:
 *   El dedup del Core es por REFERENCIA y `spCobroSis_Ad` NO se detiene si el
 *   recibo ya está cobrado (marca la transacción vieja como superada y vuelve a
 *   cobrar). Por eso, ANTES de reintentar, se verifica en Sis2000 que el recibo
 *   siga pendiente (`adrecibos.iestadorec <> 'C'`). Si ya está cobrado por
 *   cualquier vía, NO se reintenta: se marca resuelto (`cobro_ya_cobrado`).
 *
 * Idempotencia / cortes:
 *   - Cada resultado se anexa al mismo store JSONL con un `step` de resolución.
 *   - El barrido salta los `cnrecibo` ya resueltos y los que agotaron intentos.
 *   - Solo se reintenta `cobro_error` (había referencia bancaria real). NO se
 *     tocan `cobro_omitido_sin_referencia` ni `pago_no_verificado`.
 *
 * Gate: `POST_EMISION_REINTENTO=true`. Sin la flag el barrido no hace nada.
 */

const {
  listarPendientes,
  registrarResolucion,
} = require('./postEmisionPendiente');

/** Steps de pendiente que SÍ se reintentan (tenían referencia bancaria real). */
const RETRYABLE_STEPS = new Set(['cobro_error']);

const STEP_OK = 'cobro_reintento_ok';
const STEP_YA = 'cobro_ya_cobrado';
const STEP_FALLO = 'cobro_reintento_fallo';
const STEP_AGOTADO = 'cobro_reintento_agotado';

/** Un cnrecibo con cualquiera de estos steps ya no se vuelve a reintentar. */
const RESOLVED_STEPS = new Set([STEP_OK, STEP_YA, STEP_AGOTADO]);

function maxIntentos() {
  const n = parseInt(process.env.POST_EMISION_REINTENTO_MAX, 10);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

function reintentoHabilitado() {
  const v = String(process.env.POST_EMISION_REINTENTO || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function _cn(v) {
  return v != null ? String(v).trim() : '';
}

// ───────────────────────── Lógica pura (testeable) ─────────────────────────

/**
 * Indexa resoluciones previas: qué cnrecibo ya está resuelto y cuántos fallos
 * acumula cada uno.
 * @returns {{ resueltos: Set<string>, intentos: Map<string, number> }}
 */
function indexarResoluciones(records) {
  const resueltos = new Set();
  const intentos = new Map();
  for (const r of records || []) {
    const cn = _cn(r && r.cnrecibo);
    if (!cn) continue;
    const step = r && r.step;
    if (RESOLVED_STEPS.has(step)) resueltos.add(cn);
    if (step === STEP_FALLO) intentos.set(cn, (intentos.get(cn) || 0) + 1);
  }
  return { resueltos, intentos };
}

/** ¿El registro es candidato a reintento por sus campos? (no mira resoluciones) */
function esReintentable(record) {
  if (!record || !RETRYABLE_STEPS.has(record.step)) return false;
  if (!_cn(record.cnrecibo)) return false;
  if (!_cn(record.paymentReference)) return false;
  if (record.paymentVerified !== true) return false;
  const monto = Number(record.paymentAmount);
  return Number.isFinite(monto) && monto > 0;
}

/**
 * Selecciona los recibos a reintentar y los que agotaron intentos.
 * `records` viene más reciente primero (como lo entrega listarPendientes);
 * se conserva el registro más reciente por cnrecibo.
 * @returns {{ aReintentar: object[], agotados: object[] }}
 */
function seleccionar(records, { max = maxIntentos() } = {}) {
  const { resueltos, intentos } = indexarResoluciones(records);
  const vistos = new Set();
  const aReintentar = [];
  const agotados = [];
  for (const r of records || []) {
    if (!esReintentable(r)) continue;
    const cn = _cn(r.cnrecibo);
    if (vistos.has(cn) || resueltos.has(cn)) continue;
    vistos.add(cn);
    if ((intentos.get(cn) || 0) >= max) agotados.push(r);
    else aReintentar.push(r);
  }
  return { aReintentar, agotados };
}

/** fpago para el Core: la fecha del incidente (≈ fecha de pago). */
function fpagoDe(record) {
  const ts = _cn(record && record.timestamp);
  return (ts && ts.slice(0, 10)) || new Date().toISOString().slice(0, 10);
}

// ───────────────────────── I/O (inyectable en tests) ───────────────────────

/**
 * Estado del recibo en Sis2000. Devuelve { found, cobrado }.
 * `cobrado` = iestadorec 'C'. Un error/instante sin BD devuelve found=false.
 */
async function reciboEstadoSis2000(cnrecibo, deps = {}) {
  const getPool = deps.getSis2000Pool || require('./sis2000Pool').getSis2000Pool;
  const sqlLib = deps.sql || require('./sis2000Pool').sql;
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('cn', sqlLib.VarChar(30), _cn(cnrecibo))
      .query(
        "SELECT TOP 1 LTRIM(RTRIM(iestadorec)) AS iestadorec FROM adrecibos WHERE LTRIM(RTRIM(cnrecibo)) = @cn",
      );
    if (!result.recordset.length) return { found: false, cobrado: false };
    const estado = _cn(result.recordset[0].iestadorec).toUpperCase();
    return { found: true, cobrado: estado === 'C', estado };
  } catch (err) {
    console.error('[post-emision-reintento] no se pudo leer adrecibos:', err && err.message);
    return { found: false, cobrado: false, error: err && err.message };
  }
}

/**
 * Reintenta UN recibo. Deps inyectables: { activate, reciboEstado, registrar }.
 * @returns {Promise<{ cnrecibo: string, outcome: string, error?: string }>}
 */
async function reintentarUno(record, deps = {}) {
  const activate = deps.activate || require('./nestApiCollectionClient').activateReceiptAfterPayment;
  const reciboEstado = deps.reciboEstado || ((cn) => reciboEstadoSis2000(cn, deps));
  const registrar = deps.registrar || registrarResolucion;

  const cnrecibo = _cn(record.cnrecibo);
  const base = { cnrecibo, cnpoliza: record.cnpoliza, paymentReference: record.paymentReference };

  // 1) Candado anti doble-cobro: ¿el recibo sigue pendiente en Sis2000?
  const estado = await reciboEstado(cnrecibo);
  if (!estado.found) {
    // No se pudo verificar (BD caída o recibo inexistente): NO reintentar ahora,
    // NO contar como fallo; el próximo barrido lo reevalúa.
    return { cnrecibo, outcome: 'sin_verificar' };
  }
  if (estado.cobrado) {
    registrar({ ...base, step: STEP_YA, extra: { motivo: 'adrecibos.iestadorec=C' } });
    return { cnrecibo, outcome: 'ya_cobrado' };
  }

  // 2) Recibo pendiente → reintentar el cobro en el Core.
  try {
    const res = await activate({
      cnrecibo,
      mpago: Number(record.paymentAmount),
      xreferencia: _cn(record.paymentReference),
      fpago: fpagoDe(record),
    });
    registrar({
      ...base,
      step: STEP_OK,
      extra: { ingresoCaja: res && (res.ingresoCaja || (res.cobro && res.cobro.transaccion)) ? (res.ingresoCaja || null) : null },
    });
    return { cnrecibo, outcome: 'cobrado' };
  } catch (err) {
    const httpStatus = err && err.httpStatus;
    const msg = (err && err.message) || String(err);
    registrar({ ...base, step: STEP_FALLO, extra: { error: String(msg).slice(0, 300), httpStatus: httpStatus || null } });
    return { cnrecibo, outcome: 'fallo', error: msg };
  }
}

/**
 * Barrido completo. Gate POST_EMISION_REINTENTO. Deps inyectables para tests.
 * @param {{ desde?: string, limite?: number, deps?: object }} opts
 */
async function runReintentoSweep({ desde, limite = 500, deps = {} } = {}) {
  if (!reintentoHabilitado()) {
    return { enabled: false, flag: 'POST_EMISION_REINTENTO' };
  }
  const listar = deps.listar || listarPendientes;
  const registrar = deps.registrar || registrarResolucion;
  const max = maxIntentos();

  const records = listar({ desde, limite });
  const { aReintentar, agotados } = seleccionar(records, { max });

  const resumen = {
    enabled: true,
    total: records.length,
    candidatos: aReintentar.length,
    cobrados: 0,
    yaCobrados: 0,
    fallos: 0,
    sinVerificar: 0,
    agotados: agotados.length,
  };

  // Marcar (una sola vez) los que agotaron intentos, para dejar de insistir y
  // que queden visibles para conciliación manual.
  for (const r of agotados) {
    registrar({
      cnrecibo: r.cnrecibo,
      cnpoliza: r.cnpoliza,
      paymentReference: r.paymentReference,
      step: STEP_AGOTADO,
      extra: { intentos: max },
    });
  }

  for (const r of aReintentar) {
    const res = await reintentarUno(r, deps);
    if (res.outcome === 'cobrado') resumen.cobrados += 1;
    else if (res.outcome === 'ya_cobrado') resumen.yaCobrados += 1;
    else if (res.outcome === 'fallo') resumen.fallos += 1;
    else if (res.outcome === 'sin_verificar') resumen.sinVerificar += 1;
  }

  console.log(`[post-emision-reintento] barrido: ${JSON.stringify(resumen)}`);
  return resumen;
}

module.exports = {
  RETRYABLE_STEPS,
  RESOLVED_STEPS,
  STEP_OK,
  STEP_YA,
  STEP_FALLO,
  STEP_AGOTADO,
  maxIntentos,
  reintentoHabilitado,
  indexarResoluciones,
  esReintentable,
  seleccionar,
  fpagoDe,
  reciboEstadoSis2000,
  reintentarUno,
  runReintentoSweep,
};
