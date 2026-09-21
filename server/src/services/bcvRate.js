/**
 * Tasa BCV (USD) por fecha — mavamonedas / mavamoneda en Sis2000.
 * Paridad spNotificaPago: CONVERT(date, fmoneda) = fecha del pago.
 */
const { getSis2000Pool, sql } = require('./sis2000Pool');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeFechaYmd(raw) {
  const s = String(raw ?? '').trim().slice(0, 10);
  if (!ISO_DATE_RE.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

async function queryPtasamonFromTable(pool, tableName, fechaYmd) {
  const req = pool.request();
  req.input('f', sql.Date, fechaYmd);
  const result = await req.query(`
    SELECT TOP 1 ptasamon
    FROM ${tableName}
    WHERE TRIM(cmoneda) = '$'
      AND CONVERT(date, fmoneda) = @f
    ORDER BY fmoneda DESC
  `);
  const ptasamon = Number(result.recordset?.[0]?.ptasamon ?? 0);
  return Number.isFinite(ptasamon) && ptasamon > 0 ? ptasamon : null;
}

async function queryPtasamonVigente(pool) {
  const result = await pool.request().query(
    `SELECT TOP 1 ptasamon FROM mamonedas WHERE TRIM(cmoneda) = '$'`,
  );
  const ptasamon = Number(result.recordset?.[0]?.ptasamon ?? 0);
  return Number.isFinite(ptasamon) && ptasamon > 0 ? ptasamon : null;
}

/**
 * @param {string} fechaYmd YYYY-MM-DD (fecha del pago móvil)
 * @returns {Promise<{ ptasa: number, fecha: string, source: 'mavamonedas'|'mavamoneda'|'mamonedas' }>}
 */
async function getPtasamonUsdForDate(fechaYmd) {
  const fecha = normalizeFechaYmd(fechaYmd);
  if (!fecha) {
    const err = new Error('Fecha inválida; use YYYY-MM-DD');
    err.code = 'BCV_INVALID_DATE';
    throw err;
  }

  const pool = await getSis2000Pool();

  for (const table of ['mavamonedas', 'mavamoneda']) {
    try {
      const ptasa = await queryPtasamonFromTable(pool, table, fecha);
      if (ptasa) {
        return { ptasa, fecha, source: table === 'mavamonedas' ? 'mavamonedas' : 'mavamoneda' };
      }
    } catch (err) {
      const msg = String(err?.message ?? '');
      if (!/Invalid object name/i.test(msg)) throw err;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  if (fecha === today) {
    const ptasa = await queryPtasamonVigente(pool);
    if (ptasa) return { ptasa, fecha, source: 'mamonedas' };
  }

  const err = new Error(`No hay tasa BCV registrada para la fecha ${fecha}`);
  err.code = 'BCV_RATE_NOT_FOUND';
  throw err;
}

module.exports = { getPtasamonUsdForDate, normalizeFechaYmd };
