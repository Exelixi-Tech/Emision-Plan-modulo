/**
 * Tasa BCV por fecha — vía nest-api (GET /api/v1/moneda/tasa-bcv).
 * Sin consulta directa a Sis2000 desde el módulo de emisión.
 */
const { getTasaBcvForDateViaNestApi } = require('./nestApiClient');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeFechaYmd(raw) {
  const s = String(raw ?? '').trim().slice(0, 10);
  if (!ISO_DATE_RE.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

/**
 * @param {string} fechaYmd YYYY-MM-DD (fecha del pago móvil)
 * @returns {Promise<{ ptasa: number, fecha: string, source: string }>}
 */
async function getPtasamonUsdForDate(fechaYmd) {
  const fecha = normalizeFechaYmd(fechaYmd);
  if (!fecha) {
    const err = new Error('Fecha inválida; use YYYY-MM-DD');
    err.code = 'BCV_INVALID_DATE';
    throw err;
  }
  return getTasaBcvForDateViaNestApi(fecha);
}

module.exports = { getPtasamonUsdForDate, normalizeFechaYmd };
