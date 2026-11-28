/**
 * Recuperación de emisiones RCV con resultado incierto (timeout / 5xx / 409 por placa).
 *
 * Caso real (26-nov-2026, prod): nest-api emitió en Sis2000 pero tardó ~2 min en responder; Emisión cortó a
 * los 30 s, mostró error y los reintentos dieron 409 «póliza vigente con la misma placa». La póliza existía
 * pero su número nunca llegó a la sesión de Nexus.
 *
 * Este módulo:
 *  - evita emisiones concurrentes del mismo vehículo (candado en memoria);
 *  - recuerda los intentos con resultado incierto para no permitir un reintento inmediato;
 *  - adopta una póliza de Sis2000 solo si coinciden todos los datos del intento (cédulas, vehículo, plan,
 *    fechas, prima, productor y canal), está vigente, su recibo sigue pendiente y se creó después del intento.
 *
 * La búsqueda de la póliza (lookup) es inyectable; por defecto consulta GET /api/v1/canal/poliza-por-vehiculo
 * de nest-api (scope polizas:vehiculo).
 */

const MIN = 60 * 1000;

function getRecentWindowMs() {
  const n = parseInt(process.env.EMISSION_RECOVERY_WINDOW_MS, 10);
  return n > 0 ? n : 15 * MIN;
}

function getUncertainCooldownMs() {
  const n = parseInt(process.env.EMISSION_UNCERTAIN_COOLDOWN_MS, 10);
  return n >= 0 ? n : 3 * MIN;
}

function getLockTtlMs() {
  const n = parseInt(process.env.EMISSION_LOCK_TTL_MS, 10);
  return n > 0 ? n : 4 * MIN;
}

const clean = (v) => String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

function vehicleKey(placa, serial) {
  const p = clean(placa);
  if (!p) return null;
  return `${p}|${clean(serial)}`;
}

// ── Candado de emisión en curso ──────────────────────────────────────────────
const inFlight = new Map();

/** @returns {boolean} true si se obtuvo el candado; false si ya hay una emisión en curso. */
function acquireEmissionLock(key, now = Date.now()) {
  if (!key) return true;
  const since = inFlight.get(key);
  if (since !== undefined && now - since < getLockTtlMs()) return false;
  inFlight.set(key, now);
  return true;
}

function releaseEmissionLock(key) {
  if (key) inFlight.delete(key);
}

// ── Intentos con resultado incierto ──────────────────────────────────────────
const uncertain = new Map();
/** Hora de inicio del primer intento sin resolver: desde ahí pudo crearse la póliza. */
const firstAttempt = new Map();

/** Desde cuándo buscar la póliza: el primer intento sin resolver (dentro de la ventana) o este mismo. */
function attemptSince(key, startedAt, now = Date.now()) {
  const first = key ? firstAttempt.get(key) : undefined;
  if (first === undefined) return startedAt;
  if (now - first >= getRecentWindowMs()) {
    firstAttempt.delete(key);
    return startedAt;
  }
  return Math.min(first, startedAt);
}

function markUncertain(key, now = Date.now(), startedAt = now) {
  if (!key) return;
  uncertain.set(key, now);
  firstAttempt.set(key, attemptSince(key, startedAt, now));
}

function clearUncertain(key) {
  if (!key) return;
  uncertain.delete(key);
  firstAttempt.delete(key);
}

/** ¿Hay un intento reciente sin resolver para este vehículo? */
function isUncertainActive(key, now = Date.now()) {
  if (!key) return false;
  const at = uncertain.get(key);
  if (at === undefined) return false;
  if (now - at >= getUncertainCooldownMs()) {
    uncertain.delete(key);
    return false;
  }
  return true;
}

function _resetForTests() {
  inFlight.clear();
  uncertain.clear();
  firstAttempt.clear();
}

// ── Clasificación de errores ─────────────────────────────────────────────────
function isTimeoutError(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT' || msg.includes('timeout');
}

/** Resultado de la emisión desconocido: la póliza pudo haberse creado en Sis2000. */
function isAmbiguousEmitError(err) {
  if (isTimeoutError(err)) return true;
  const status = Number(err?.httpStatus || 0);
  return status >= 500 && status < 600;
}

function isPlateAlreadyInsured(err) {
  return err?.code === 'LAMUNDIAL_PLATE_ALREADY_INSURED' || err?.code === 'PLATE_ALREADY_INSURED';
}

// ── Coincidencia con ESTE intento ────────────────────────────────────────────
/** Diferencia admitida entre la antigüedad de la póliza y el tiempo transcurrido desde el intento. */
const HOLGURA_SEG = 5;
const HOLGURA_PRIMA = 0.05;

const texto = (v) => String(v ?? '').trim().toUpperCase();
const cedula = (v) => String(v ?? '').replace(/\D+/g, '').replace(/^0+/, '');
const fecha = (v) => String(v ?? '').trim().slice(0, 10);
const canal = (v) => (texto(v) === '0' ? '' : texto(v));

/** Datos que el intento y la póliza deben traer, ambos, e iguales: [campo del intento, norma, campo de la póliza]. */
const OBLIGATORIOS = [
  ['placa', clean],
  ['serial', clean],
  ['cedulaTomador', cedula, 'ctenedor'],
  ['cedulaTitular', cedula, 'casegurado'],
  ['plan', texto, 'cplan'],
  ['frecuencia', texto, 'ifrecuencia'],
  ['fdesde', fecha],
  ['fhasta', fecha],
  ['femision', fecha],
  ['cproductor', texto],
];
/** Datos que se comparan cuando el intento los envió. */
const OPCIONALES = [
  ['serialMotor', clean, 'xsermot'],
  ['ano', texto, 'cano'],
  ['marca', texto, 'cmarca'],
  ['modelo', texto, 'cmodelo'],
  ['version', texto, 'cversion'],
];

/** Datos del intento de emisión contra los que se compara una póliza encontrada. */
function attemptData(payload, cotizacion = {}) {
  return {
    placa: payload.placa,
    serial: payload.serial_carroceria,
    serialMotor: payload.serial_motor,
    cedulaTomador: payload.rif_tomador,
    cedulaTitular: payload.rif_titular,
    plan: payload.plan,
    frecuencia: payload.frecuencia,
    fdesde: payload.fdesde,
    fhasta: payload.fhasta,
    femision: payload.fecha_emision,
    cproductor: payload.cproductor ?? payload.productor,
    ccanalalt: payload.ccanalalt,
    ano: payload.fano,
    marca: payload.marca,
    modelo: payload.modelo,
    version: payload.version,
    mprimaext: payload.mprimaext ?? cotizacion.mprimaext,
  };
}

/**
 * Datos por los que una póliza NO corresponde a este intento. Lista vacía = es la de este intento.
 * Si a la póliza le falta un dato exigido, cuenta como diferencia.
 * @param {object} candidate fila de nest-api ya pasada por mapNestRow
 * @param {object} ctx attemptData() + { sinceMs (epoch del primer intento), now? }
 */
function policyMismatches(candidate, ctx) {
  if (!candidate || !candidate.cnpoliza) return ['cnpoliza'];
  const out = [];
  for (const [campo, norma, columna = campo] of OBLIGATORIOS) {
    const esperado = norma(ctx[campo]);
    if (!esperado || norma(candidate[columna]) !== esperado) out.push(campo);
  }
  for (const [campo, norma, columna] of OPCIONALES) {
    const esperado = norma(ctx[campo]);
    if (esperado && norma(candidate[columna]) !== esperado) out.push(campo);
  }
  if (canal(candidate.ccanalalt) !== canal(ctx.ccanalalt)) out.push('ccanalalt');

  const prima = Number(ctx.mprimaext);
  if (!(prima > 0) || !(Math.abs(Number(candidate.mprimaext) - prima) <= HOLGURA_PRIMA)) out.push('prima');

  // Solo una póliza vigente con el recibo todavía por cobrar puede activarse con el pago de este intento.
  if (texto(candidate.iestado) !== 'V') out.push('estadoPoliza');
  if (!texto(candidate.cnrecibo) || texto(candidate.iestadorec) !== 'P') out.push('estadoRecibo');

  // Creada después de empezar el intento. Se comparan dos duraciones, cada una con su propio reloj,
  // así el desfase entre la base y este servidor no influye.
  const now = ctx.now ?? Date.now();
  const desde = Math.max(ctx.sinceMs ?? now, now - getRecentWindowMs());
  const transcurrido = (now - desde) / 1000;
  const edad = candidate.edadSegundos == null ? NaN : Number(candidate.edadSegundos);
  if (!(edad >= -HOLGURA_SEG && edad <= transcurrido + HOLGURA_SEG)) out.push('fechaIngreso');
  return out;
}

const matchesOwnRecentPolicy = (candidate, ctx) => policyMismatches(candidate, ctx).length === 0;

/** Fila de nest-api (xplaca/xsercar) → forma que espera policyMismatches. */
function mapNestRow(row) {
  return { ...row, placa: row.xplaca, serial: row.xsercar };
}

/**
 * Lookup por defecto: GET /api/v1/canal/poliza-por-vehiculo de nest-api (solo lectura; la key de Emisión
 * necesita el scope polizas:vehiculo). Si falta el scope o la función, devuelve [] y solo actúan el candado
 * y el mensaje «verifique antes de reintentar». EMISSION_RECOVERY_LOOKUP=false lo desactiva.
 */
async function defaultLookup({ placa, serial, sinceMs }) {
  if (String(process.env.EMISSION_RECOVERY_LOOKUP || '').toLowerCase() === 'false') return [];
  const client = require('./nestApiClient');
  if (typeof client.getPolizaPorVehiculoViaNestApi !== 'function') return [];
  const base = Math.max(sinceMs ?? 0, Date.now() - getRecentWindowMs());
  // 5 min extra hacia atrás por diferencia de relojes; matchesOwnRecentPolicy afina la ventana.
  const desde = new Date(base - 5 * MIN).toISOString();
  const rows = await client.getPolizaPorVehiculoViaNestApi({ placa: clean(placa), serial: clean(serial), desde });
  return (Array.isArray(rows) ? rows : []).map(mapNestRow);
}

/**
 * Busca una póliza recién emitida que corresponda a este intento.
 * @returns {Promise<{ cnpoliza, cnrecibo, urlpoliza, ... }|null>}
 */
async function recoverIssuedPolicy(ctx, opts = {}) {
  const lookup = opts.lookup || defaultLookup;
  let found;
  try {
    found = await lookup(ctx);
  } catch (err) {
    console.warn(`[emissionRecovery] lookup falló placa=${ctx.placa}: ${err?.message || err}`);
    return null;
  }
  const list = Array.isArray(found) ? found : found ? [found] : [];
  const matches = [];
  for (const c of list) {
    const diferencias = policyMismatches(c, ctx);
    if (diferencias.length === 0) matches.push(c);
    else console.warn(`[emissionRecovery] póliza ${c?.cnpoliza} no adoptada placa=${ctx.placa}: difiere ${diferencias.join(', ')}`);
  }
  // Más de una coincidencia distinta = ambiguo: no adoptar ninguna.
  const distinct = new Set(matches.map((m) => String(m.cnpoliza).trim()));
  if (distinct.size !== 1) return null;
  return matches[0];
}

module.exports = {
  vehicleKey,
  acquireEmissionLock,
  releaseEmissionLock,
  markUncertain,
  attemptSince,
  clearUncertain,
  isUncertainActive,
  isTimeoutError,
  isAmbiguousEmitError,
  isPlateAlreadyInsured,
  attemptData,
  policyMismatches,
  matchesOwnRecentPolicy,
  recoverIssuedPolicy,
  defaultLookup,
  getRecentWindowMs,
  getUncertainCooldownMs,
  _resetForTests,
};
