/**
 * Renovar = póliza nueva enlazada (para el cliente renovación; en Sis2000 NU + cnpoliza_rel).
 * `state.renovacion` lo arma Formulario con nest-api GET /renovacion/:cnpoliza y viaja en la
 * sesión del flujo. Sin `state.renovacion` (flujo normal) todo devuelve null y nada cambia.
 */

const CNPOLIZA_RE = /^[0-9A-Z][0-9A-Z-]{2,29}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayYmd(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ymd(v) {
  const s = String(v ?? '').trim().slice(0, 10);
  return YMD_RE.test(s) ? s : null;
}

/** +1 año respetando 29-feb. */
function addOneYear(fdesde) {
  const [y, m, d] = fdesde.split('-').map(Number);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * @param {object} state wizard state (sesión del flujo)
 * @param {Date} [now]
 * @returns {null | { cnpoliza_rel: string, itipoEmi: 'NU', fdesde: string, fhasta: string }}
 *   fdesde = fdesde_sugerida (fhasta de la póliza anterior) o hoy si quedó en el pasado;
 *   fhasta = fhasta_sugerida si fdesde no cambió, si no +1 año.
 */
function renovacionDeState(state, now = new Date()) {
  // Formulario lo deja en state.renovacion y en metadataCanal.renovacion (Pagos solo reenvía metadataCanal).
  const r = state && (state.renovacion || (state.metadataCanal && state.metadataCanal.renovacion));
  if (!r || r.flujo !== 'renovacion' || !r.precargada) return null;
  const cnpoliza = String(r.cnpoliza_rel ?? '').trim().toUpperCase();
  if (!CNPOLIZA_RE.test(cnpoliza)) return null;
  const hoy = todayYmd(now);
  const sugerida = ymd(r.fdesde_sugerida);
  const fdesde = sugerida && sugerida >= hoy ? sugerida : hoy;
  const fhastaSug = ymd(r.fhasta_sugerida);
  const fhasta = fdesde === sugerida && fhastaSug && fhastaSug > fdesde ? fhastaSug : addOneYear(fdesde);
  return { cnpoliza_rel: cnpoliza, itipoEmi: 'NU', fdesde, fhasta };
}

/** La póliza vigente encontrada es la que se renueva → no bloquea. */
function esLaPolizaQueSeRenueva(cnpolizaVigente, cnpolizaRel) {
  const a = String(cnpolizaVigente ?? '').trim().toUpperCase();
  const b = String(cnpolizaRel ?? '').trim().toUpperCase();
  return Boolean(a && b && a === b);
}

module.exports = { renovacionDeState, esLaPolizaQueSeRenueva, _internal: { addOneYear, todayYmd } };
