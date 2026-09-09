/**
 * Cliente hacia nest-api / SysIP para Riesgos Generales (Patrimonial, cramo 20).
 * Maneja cotizaciones con /quote-generalRisks y emisiones con /generalRisks.
 */
const axios = require('axios');
const {
  getBaseUrl,
  buildAuthHeaders,
  trackResponse,
} = require('./nestTokenService');
const { fetchPlanesV2 } = require('./planesClient');

const DEFAULT_RAMO = parseInt(process.env.LAMUNDIAL_RAMO_PATRIMONIAL || '20', 10);
const DEFAULT_TIMEOUT = 30_000;

function getTimeout() {
  return parseInt(process.env.LAMUNDIAL_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT;
}

async function axiosOpts(extra = {}) {
  return {
    headers: await buildAuthHeaders(),
    timeout: getTimeout(),
    validateStatus: () => true,
    ...extra,
  };
}

function extractErrorMessage(data) {
  if (!data) return 'Sin respuesta del servidor';
  if (typeof data === 'string') {
    const s = data.trim();
    if (s.startsWith('<')) return 'El servidor retornó HTML (ruta no encontrada o proxy)';
    return s.slice(0, 300);
  }
  if (data.message) {
    return Array.isArray(data.message) ? data.message.join('; ') : String(data.message);
  }
  if (data.result?.error) return String(data.result.error);
  if (data.error) return typeof data.error === 'object' ? JSON.stringify(data.error) : String(data.error);
  try {
    const snippet = JSON.stringify(data).slice(0, 400);
    if (snippet && snippet !== '{}') return `Respuesta: ${snippet}`;
  } catch (_) { /* ignore */ }
  return 'Error desconocido en módulo patrimonial';
}

function buildError(httpStatus, data, endpoint) {
  const message = extractErrorMessage(data);
  let code = 'PATRIMONIAL_ERROR';
  const lower = message.toLowerCase();
  if (httpStatus === 401 || httpStatus === 403) code = 'PATRIMONIAL_UNAUTHORIZED';
  else if (lower.includes('poliza vigente') || lower.includes('póliza vigente')) code = 'PATRIMONIAL_DUPLICATE';
  else if (httpStatus >= 500) code = 'PATRIMONIAL_SERVER_ERROR';

  const err = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  err.endpoint = endpoint;
  err.raw = data;
  return err;
}

/**
 * Consulta la lista de planes vigentes para el ramo patrimonial (default 20).
 * @param {number} [cramo=20]
 * @param {Record<string, unknown>} [nexusMetadata]
 */
async function getPlanesPatrimonial(cramo = DEFAULT_RAMO, nexusMetadata = {}) {
  const metadata = { ...nexusMetadata, cramo: Number(cramo || DEFAULT_RAMO) };
  return fetchPlanesV2(metadata);
}

/**
 * Normaliza y agrega las coberturas retornadas por spCalculoRiesgoGeneral / quote-generalRisks.
 * @param {Array<object>|object} rawData
 * @returns {{ mprima: number, mprimaext: number, ptasa: number, coberturas: Array<object> }}
 */
function aggregateQuoteData(rawData) {
  if (!rawData) {
    return { mprima: 0, mprimaext: 0, ptasa: 1, coberturas: [] };
  }

  // Si ya viene pre-calculado con mprima / mprimaext
  if (!Array.isArray(rawData) && (rawData.mprima != null || rawData.mprimaext != null)) {
    return {
      mprima: Number(rawData.mprima ?? 0),
      mprimaext: Number(rawData.mprimaext ?? 0),
      ptasa: Number(rawData.ptasa ?? 1),
      coberturas: Array.isArray(rawData.coberturas) ? rawData.coberturas : [],
    };
  }

  const items = Array.isArray(rawData) ? rawData : (rawData.recordset ?? rawData.coberturas ?? []);
  let totalPrimaExt = 0;
  let totalPrimaBs = 0;
  let maxSuma = 0;
  let ptasa = 0;

  const coberturas = items.map((row) => {
    const primaExt = Number(row.mprimaext ?? row.prima ?? 0);
    const primaBs = Number(row.mprima ?? 0);
    const suma = Number(row.msumaasegext ?? row.msumaaseg ?? row.sumaAsegurada ?? 0);
    if (suma > maxSuma) maxSuma = suma;
    totalPrimaExt += primaExt;
    totalPrimaBs += primaBs;
    if (row.ptasa != null && !ptasa) ptasa = Number(row.ptasa);
    if (row.ptasamon != null && !ptasa) ptasa = Number(row.ptasamon);

    return {
      ccobertura: row.ccobertura != null ? String(row.ccobertura).trim() : undefined,
      name: String(row.xdescripcion_l ?? row.xdescripcion ?? row.xcobertura ?? row.name ?? '').trim(),
      prima: primaExt,
      sumaAsegurada: suma || null,
      cproducto: row.cproducto != null ? String(row.cproducto).trim() : undefined,
    };
  });

  return {
    mprima: totalPrimaBs || (totalPrimaExt * (ptasa || 1)),
    mprimaext: totalPrimaExt,
    ptasa: ptasa || 1,
    coberturas,
  };
}

/**
 * Cotiza un plan de Riesgos Generales / Patrimonial.
 * POST /api/v1/emissions/quote-generalRisks
 * @param {{ cramo?: number, cplan: string, ifrecuencia?: string, pdescuento?: number, precargo?: number }} params
 */
async function quoteGeneralRisks({ cramo = DEFAULT_RAMO, cplan, ifrecuencia = 'A', pdescuento = 0, precargo = 0 }) {
  const base = getBaseUrl();
  const url = `${base}/api/v1/emissions/quote-generalRisks`;
  const payload = {
    cramo: Number(cramo || DEFAULT_RAMO),
    cplan: String(cplan).trim(),
    ifrecuencia: String(ifrecuencia || 'A').trim().toUpperCase(),
    pdescuento: Number(pdescuento || 0),
    precargo: Number(precargo || 0),
  };

  const ts = new Date().toISOString();
  console.log(`[Patrimonial][${ts}] -> quote-generalRisks ${JSON.stringify(payload)}`);
  const t0 = Date.now();

  const response = trackResponse(
    await axios.post(url, payload, await axiosOpts()),
  );
  const elapsed = Date.now() - t0;

  const data = response.data;
  const ok = response.status >= 200 && response.status < 300 && data?.status !== false;
  console.log(`[Patrimonial][${ts}] <- quote-generalRisks ${response.status} ${ok ? 'ok' : 'FAIL'} in ${elapsed}ms`);

  if (ok) {
    const rawResult = data?.data ?? data?.recordset ?? data;
    const aggregated = aggregateQuoteData(rawResult);
    return {
      ...aggregated,
      raw: data,
    };
  }

  throw buildError(response.status, data, '/quote-generalRisks');
}

/**
 * Emite una póliza de Riesgos Generales / Patrimonial.
 * POST /api/v1/emissions/generalRisks
 * @param {object} payload - Payload formateado con keys, tomador, asegurado, bien_asegurado, etc.
 */
async function createEmissionGeneralRisk(payload) {
  const base = getBaseUrl();
  const url = `${base}/api/v1/emissions/generalRisks`;

  const ts = new Date().toISOString();
  console.log(`[Patrimonial][${ts}] -> generalRisks emision cplan=${payload.keys?.cplan ?? '?'} cramo=${payload.keys?.cramo ?? '?'}`);
  const t0 = Date.now();

  const response = trackResponse(
    await axios.post(url, payload, await axiosOpts()),
  );
  const elapsed = Date.now() - t0;

  const data = response.data;
  const ok = response.status >= 200 && response.status < 300 && data?.status !== false;
  console.log(`[Patrimonial][${ts}] <- generalRisks ${response.status} ${ok ? 'ok' : 'FAIL'} in ${elapsed}ms`);

  if (ok) {
    const result = data?.result ?? data?.data ?? data;
    const cnpoliza = String(result.cnpoliza ?? result.number ?? '').trim();
    const cnrecibo = String(result.cnrecibo ?? '').trim();
    const urlpoliza = String(result.urlpoliza ?? result.documentUrl ?? '').trim();

    if (!cnpoliza && !cnrecibo && !urlpoliza) {
      throw buildError(response.status, { message: 'Respuesta de emisión inválida: cnpoliza/cnrecibo faltantes' }, '/generalRisks');
    }

    return {
      cnpoliza,
      cnrecibo,
      urlpoliza,
      ncuota: result.ncuota ?? 1,
      fanopol: result.lapso ?? result.fanopol,
      fmespol: result.mes ?? result.fmespol,
      message: result.message ?? 'Póliza generada exitosamente',
      raw: data,
    };
  }

  throw buildError(response.status, data, '/generalRisks');
}

module.exports = {
  getPlanesPatrimonial,
  quoteGeneralRisks,
  createEmissionGeneralRisk,
  aggregateQuoteData,
  DEFAULT_RAMO,
};
