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
 *  - decide si una póliza encontrada en Sis2000 corresponde a ESTE intento (placa + serial + productor/canal
 *    + fecha de ingreso reciente) antes de adoptarla como emitida.
 *
 * La búsqueda de la póliza (lookup) es inyectable. Hoy nest-api NO expone un endpoint de solo lectura por
 * placa/serial; mientras no exista, el lookup por defecto devuelve null y solo actúan el candado y el
 * mensaje «verifique antes de reintentar».
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

function markUncertain(key, now = Date.now()) {
  if (key) uncertain.set(key, now);
}

function clearUncertain(key) {
  if (key) uncertain.delete(key);
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
/**
 * @param {object} candidate { cnpoliza, cnrecibo?, placa, serial, cproductor, ccanalalt, fingreso, ... }
 * @param {object} ctx { placa, serial, cproductor, ccanalalt, sinceMs (epoch), now? }
 * Todas las condiciones deben cumplirse; si el candidato no trae un dato exigido, NO coincide.
 */
function matchesOwnRecentPolicy(candidate, ctx) {
  if (!candidate || !candidate.cnpoliza) return false;
  const now = ctx.now ?? Date.now();

  if (!clean(ctx.placa) || clean(candidate.placa) !== clean(ctx.placa)) return false;
  if (!clean(ctx.serial) || clean(candidate.serial) !== clean(ctx.serial)) return false;

  if (String(ctx.cproductor ?? '').trim() === '' || String(candidate.cproductor ?? '').trim() !== String(ctx.cproductor).trim()) {
    return false;
  }
  // Canal alterno: si el intento lo traía, debe coincidir; si no traía, el candidato tampoco debe tener uno distinto.
  const ctxCanal = String(ctx.ccanalalt ?? '').trim();
  const candCanal = String(candidate.ccanalalt ?? '').trim();
  if (ctxCanal !== '' && ctxCanal !== '0' && candCanal !== ctxCanal) return false;

  const at = Date.parse(candidate.fingreso);
  if (!Number.isFinite(at)) return false;
  const desde = Math.max(ctx.sinceMs ?? 0, now - getRecentWindowMs());
  // 2 min de holgura por diferencia de relojes entre servidores.
  if (at < desde - 2 * MIN || at > now + 2 * MIN) return false;
  return true;
}

/**
 * Lookup por defecto: no existe endpoint de solo lectura en nest-api (placa/serial → cnpoliza + fingreso).
 * Cuando exista, reemplazar aquí (o inyectar vía opts.lookup).
 */
async function defaultLookup() {
  return null;
}

/**
 * Busca una póliza recién emitida que corresponda a este intento.
 * @returns {Promise<{ cnpoliza, cnrecibo, urlpoliza, ... }|null>}
 */
async function recoverIssuedPolicy(ctx, opts = {}) {
  const lookup = opts.lookup || defaultLookup;
  let found;
  try {
    found = await lookup({ placa: ctx.placa, serial: ctx.serial, cproductor: ctx.cproductor, ccanalalt: ctx.ccanalalt });
  } catch (err) {
    console.warn(`[emissionRecovery] lookup falló placa=${ctx.placa}: ${err?.message || err}`);
    return null;
  }
  const list = Array.isArray(found) ? found : found ? [found] : [];
  const matches = list.filter((c) => matchesOwnRecentPolicy(c, ctx));
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
  clearUncertain,
  isUncertainActive,
  isTimeoutError,
  isAmbiguousEmitError,
  isPlateAlreadyInsured,
  matchesOwnRecentPolicy,
  recoverIssuedPolicy,
  getRecentWindowMs,
  getUncertainCooldownMs,
  _resetForTests,
};
