/**
 * Registro persistente de "post-emisión pendiente".
 *
 * Después de que nest-api emite (o intenta emitir) una póliza con pago ya
 * verificado, hay pasos best-effort que hoy solo dejaban un console.log:
 * cobro del recibo (ingreso de caja), activación de tarjeta, record-emission
 * en Nexus, timeout de nest-api (el SP puede haber creado la póliza igual) y
 * reintentos que devuelven 409 "placa ya asegurada" / "póliza vigente".
 *
 * Este módulo escribe una línea JSON por incidente en
 *   `${POST_EMISION_DIR}/pendientes-YYYY-MM-DD.jsonl`
 * (default `server/data/post-emision/`, gitignored) y emite un
 * `console.error('[post-emision-pendiente] ...')` grepeable en logs de PM2.
 *
 * Nunca bloquea ni altera la respuesta al cliente: todo va en try/catch.
 *
 * Flags:
 *   POST_EMISION_DIR        carpeta de los .jsonl
 *   POST_EMISION_TOKEN      token para GET /api/internal/post-emision
 *   POST_EMISION_REINTENTO  (fase 2, implementada en `postEmisionReintento.js`)
 *                           true = un barrido periódico reintenta el cobro de los
 *                           pendientes `cobro_error` (verifica antes en Sis2000 que
 *                           el recibo siga sin cobrar). Sin la flag, no reintenta.
 */
const fs = require('fs');
const path = require('path');

const TAG = '[post-emision-pendiente]';
const REINTENTO_FLAG = 'POST_EMISION_REINTENTO';
const MAX_ERROR_LEN = 500;

function getDir() {
  const fromEnv = String(process.env.POST_EMISION_DIR || '').trim();
  return fromEnv || path.join(__dirname, '../../data/post-emision');
}

/** Oculta todo menos los últimos 3 dígitos: V12345678 → V*****678. */
function maskDocument(doc) {
  if (doc == null) return null;
  const s = String(doc).trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  const prefix = /^[A-Za-z]/.test(s) ? s[0].toUpperCase() : '';
  if (digits.length <= 3) return `${prefix}${'*'.repeat(digits.length)}`;
  return `${prefix}${'*'.repeat(digits.length - 3)}${digits.slice(-3)}`;
}

function truncate(value, max = MAX_ERROR_LEN) {
  if (value == null) return null;
  const s = typeof value === 'string' ? value : (value.message || String(value));
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function asRecord(v) {
  return v && typeof v === 'object' ? v : {};
}

/** Datos de pago del wizardState (paymentVerified / paymentCapture / sid). */
function resolvePaymentInfo(state) {
  const st = asRecord(state);
  const pay = asRecord(st.paymentCapture);
  const checkout = asRecord(st.checkoutPayload);
  const amount = pay.amount != null ? Number(pay.amount) : null;
  return {
    paymentVerified: st.paymentVerified === true,
    paymentReference: pay.reference || pay.transactionId || pay.xreferencia || null,
    paymentAmount: Number.isFinite(amount) ? amount : null,
    sid: String(st.paymentSid || st.sid || checkout.paymentSid || '').trim() || null,
  };
}

/** Documento del tomador (ya enmascarado). */
function resolveDocumento(state) {
  const st = asRecord(state);
  const tomador = asRecord(st.tomador);
  const raw = tomador.identificacion || tomador.cedula || tomador.rif || null;
  return maskDocument(raw);
}

function resolvePlaca(state) {
  const v = asRecord(asRecord(state).vehicle);
  const placa = v.placa || v.xplaca || null;
  return placa ? String(placa).trim().toUpperCase() : null;
}

/**
 * Construye el registro (puro, sin I/O).
 * @param {{
 *   flujo: 'rcv'|'personas', step: string, error?: string|Error,
 *   state?: object, internalPolicyId?: string, cnpoliza?: string, cnrecibo?: string,
 *   extra?: object, now?: Date,
 * }} input
 */
function buildRecord(input) {
  const { flujo, step, error, state, internalPolicyId, cnpoliza, cnrecibo, extra, now } = input || {};
  const pay = resolvePaymentInfo(state);
  const record = {
    timestamp: (now instanceof Date ? now : new Date()).toISOString(),
    flujo: flujo || 'desconocido',
    step: step || 'desconocido',
    internalPolicyId: internalPolicyId || null,
    sid: pay.sid,
    cnpoliza: cnpoliza ? String(cnpoliza) : null,
    cnrecibo: cnrecibo ? String(cnrecibo) : null,
    paymentVerified: pay.paymentVerified,
    paymentReference: pay.paymentReference,
    paymentAmount: pay.paymentAmount,
    documento: resolveDocumento(state),
    error: truncate(error),
  };
  if (flujo === 'rcv') record.placa = resolvePlaca(state);
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) record[k] = v;
    }
  }
  return record;
}

function serializeRecord(record) {
  return JSON.stringify(record);
}

/** Parsea JSON-lines tolerando líneas corruptas. */
function parseLines(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch (_) {
      /* línea corrupta: se ignora */
    }
  }
  return out;
}

function fileNameFor(timestampIso) {
  return `pendientes-${String(timestampIso).slice(0, 10)}.jsonl`;
}

function isValidYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

/** Filtra registros con timestamp >= desde (YYYY-MM-DD). Sin `desde` devuelve todo. */
function filterDesde(records, desde) {
  if (!isValidYmd(desde)) return records;
  return records.filter((r) => String(r.timestamp || '').slice(0, 10) >= desde);
}

/**
 * Persiste un registro. Nunca lanza: cualquier fallo de disco solo se loguea.
 * @returns {object|null} el registro escrito (o null si el input era inválido)
 */
function _appendRecord(record) {
  const line = serializeRecord(record);
  console.error(`${TAG} ${line}`);
  const dir = getDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFile(path.join(dir, fileNameFor(record.timestamp)), `${line}\n`, (err) => {
    if (err) console.error(`${TAG} no se pudo escribir en disco:`, err.message);
  });
}

function registrarPendiente(input) {
  let record = null;
  try {
    record = buildRecord(input);
    _appendRecord(record);
  } catch (err) {
    console.error(`${TAG} error registrando:`, err && err.message ? err.message : err);
  }
  return record;
}

/**
 * Anexa una línea de RESOLUCIÓN de un reintento (fase 2) al mismo store JSONL.
 * No necesita wizardState: recibe cnrecibo/cnpoliza/referencia explícitos. El
 * barrido lee estas líneas para saltar los recibos ya resueltos o agotados.
 * @param {{ step: string, cnrecibo?: string, cnpoliza?: string,
 *   paymentReference?: string, flujo?: string, extra?: object, now?: Date }} input
 * @returns {object|null} el registro escrito
 */
function registrarResolucion({ step, cnrecibo, cnpoliza, paymentReference, flujo = 'rcv', extra, now } = {}) {
  let record = null;
  try {
    record = {
      timestamp: (now instanceof Date ? now : new Date()).toISOString(),
      flujo: flujo || 'rcv',
      step: step || 'cobro_reintento',
      cnrecibo: cnrecibo != null ? String(cnrecibo) : null,
      cnpoliza: cnpoliza != null ? String(cnpoliza) : null,
      paymentReference: paymentReference != null ? String(paymentReference) : null,
      reintento: true,
    };
    if (extra && typeof extra === 'object') {
      for (const [k, v] of Object.entries(extra)) if (v !== undefined) record[k] = v;
    }
    _appendRecord(record);
  } catch (err) {
    console.error(`${TAG} error registrando resolución:`, err && err.message ? err.message : err);
  }
  return record;
}

/**
 * Lee los registros (más recientes primero).
 * @param {{ desde?: string, limite?: number }} opts
 */
function listarPendientes({ desde, limite } = {}) {
  const dir = getDir();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^pendientes-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  if (isValidYmd(desde)) {
    files = files.filter((f) => f.slice('pendientes-'.length, 'pendientes-'.length + 10) >= desde);
  }
  files.sort();
  let records = [];
  for (const f of files) {
    records = records.concat(parseLines(fs.readFileSync(path.join(dir, f), 'utf8')));
  }
  records = filterDesde(records, desde).reverse();
  const max = Number(limite);
  if (Number.isFinite(max) && max > 0) records = records.slice(0, max);
  return records;
}

module.exports = {
  TAG,
  REINTENTO_FLAG,
  getDir,
  maskDocument,
  resolvePaymentInfo,
  buildRecord,
  serializeRecord,
  parseLines,
  filterDesde,
  fileNameFor,
  registrarPendiente,
  registrarResolucion,
  listarPendientes,
};
