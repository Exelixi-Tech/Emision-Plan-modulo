/**
 * Registro persistente de incidentes post-emisión para revisión operativa.
 * Los registros se guardan como JSONL en POST_EMISION_DIR.
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

function maskDocument(doc) {
  if (doc == null) return null;
  const value = String(doc).trim();
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  const prefix = /^[A-Za-z]/.test(value) ? value[0].toUpperCase() : '';
  if (digits.length <= 3) return `${prefix}${'*'.repeat(digits.length)}`;
  return `${prefix}${'*'.repeat(digits.length - 3)}${digits.slice(-3)}`;
}

function truncate(value, max = MAX_ERROR_LEN) {
  if (value == null) return null;
  const text = typeof value === 'string' ? value : (value.message || String(value));
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function asRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

function resolvePaymentInfo(state) {
  const st = asRecord(state);
  const payment = asRecord(st.paymentCapture);
  const checkout = asRecord(st.checkoutPayload);
  const amount = payment.amount != null ? Number(payment.amount) : null;
  return {
    paymentVerified: st.paymentVerified === true,
    paymentReference: payment.reference || payment.transactionId || payment.xreferencia || null,
    paymentAmount: Number.isFinite(amount) ? amount : null,
    sid: String(st.paymentSid || st.sid || checkout.paymentSid || '').trim() || null,
  };
}

function resolveDocumento(state) {
  const tomador = asRecord(asRecord(state).tomador);
  return maskDocument(tomador.identificacion || tomador.cedula || tomador.rif || null);
}

function resolvePlaca(state) {
  const vehicle = asRecord(asRecord(state).vehicle);
  const placa = vehicle.placa || vehicle.xplaca || null;
  return placa ? String(placa).trim().toUpperCase() : null;
}

function buildRecord(input) {
  const { flujo, step, error, state, internalPolicyId, cnpoliza, cnrecibo, extra, now } = input || {};
  const payment = resolvePaymentInfo(state);
  const record = {
    timestamp: (now instanceof Date ? now : new Date()).toISOString(),
    flujo: flujo || 'desconocido',
    step: step || 'desconocido',
    internalPolicyId: internalPolicyId || null,
    sid: payment.sid,
    cnpoliza: cnpoliza ? String(cnpoliza) : null,
    cnrecibo: cnrecibo ? String(cnrecibo) : null,
    paymentVerified: payment.paymentVerified,
    paymentReference: payment.paymentReference,
    paymentAmount: payment.paymentAmount,
    documento: resolveDocumento(state),
    error: truncate(error),
  };
  if (flujo === 'rcv') record.placa = resolvePlaca(state);
  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) record[key] = value;
    }
  }
  return record;
}

function serializeRecord(record) {
  return JSON.stringify(record);
}

function parseLines(text) {
  const records = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch (_) {
      // Ignore corrupt lines so other records remain available.
    }
  }
  return records;
}

function fileNameFor(timestampIso) {
  return `pendientes-${String(timestampIso).slice(0, 10)}.jsonl`;
}

function isValidYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function filterDesde(records, desde) {
  if (!isValidYmd(desde)) return records;
  return records.filter((record) => String(record.timestamp || '').slice(0, 10) >= desde);
}

function appendRecord(record) {
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
    appendRecord(record);
  } catch (err) {
    console.error(`${TAG} error registrando:`, err && err.message ? err.message : err);
  }
  return record;
}

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
      for (const [key, value] of Object.entries(extra)) {
        if (value !== undefined) record[key] = value;
      }
    }
    appendRecord(record);
  } catch (err) {
    console.error(`${TAG} error registrando resolución:`, err && err.message ? err.message : err);
  }
  return record;
}

function listarPendientes({ desde, limite } = {}) {
  const dir = getDir();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((file) => /^pendientes-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file));
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  if (isValidYmd(desde)) {
    files = files.filter((file) => file.slice('pendientes-'.length, 'pendientes-'.length + 10) >= desde);
  }
  files.sort();
  let records = [];
  for (const file of files) {
    records = records.concat(parseLines(fs.readFileSync(path.join(dir, file), 'utf8')));
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
