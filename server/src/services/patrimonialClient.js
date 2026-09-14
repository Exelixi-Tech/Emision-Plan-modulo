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
const personasClient = require('./personasClient');

const DEFAULT_RAMO = parseInt(process.env.LAMUNDIAL_RAMO_PATRIMONIAL || '20', 10);
const DEFAULT_TIMEOUT = 30_000;

const PATH_PREFIX = '/api/v1/valrep/';

function getTimeout() {
  return parseInt(process.env.LAMUNDIAL_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT;
}

let _patrimonial = null;
let _patrimonialCfg = null;

function getConfig() {
  return {
    baseUrl:
      process.env.PERSONAS_API_URL ||
      process.env.NEST_API_URL ||
      process.env.NESTAPI_BASE_URL ||
      process.env.SYSIP_API_URL ||
      DEFAULT_BASE,
    // apikey solo se usa en la emisión (canal maclient_api).
    apiKey: process.env.PERSONAS_API_KEY || process.env.LAMUNDIAL_PERSON_APIKEY || '',
    timeout: parseInt(process.env.LAMUNDIAL_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT,
    cramo: parseInt(process.env.LAMUNDIAL_RAMO_PERSON, 10) || 9,
  };
}

async function axiosOpts(extra = {}) {
  return {
    headers: await buildAuthHeaders(),
    timeout: getTimeout(),
    validateStatus: () => true,
    ...extra,
  };
}

function getPatrimonial() {
  const cfg = getConfig();
  if (_patrimonial && _patrimonialCfg &&
    _patrimonialCfg.baseUrl === cfg.baseUrl &&
    _patrimonialCfg.timeout === cfg.timeout) {
    return _patrimonial;
  }
  console.log('cfg.baseUrl', `${cfg.baseUrl.replace(/\/$/, '')}${PATH_PREFIX}`)
  _patrimonial = axios.create({
    baseURL: `${cfg.baseUrl.replace(/\/$/, '')}${PATH_PREFIX}`,
    timeout: cfg.timeout,
    headers: { 'Content-Type': 'application/json' },
    validateStatus: () => true,
  });
  _patrimonialCfg = cfg;
  return _patrimonial;
}

async function post(endpoint, body, extraHeaders) {
  const client = getPatrimonial();
  const ts = new Date().toISOString();
  console.log(`[Patrimonial][${ts}] -> ${endpoint} ${JSON.stringify(body).slice(0, 1500)}`);
  const t0 = Date.now();
  let response;
  const authHeaders = await buildAuthHeaders(extraHeaders);
  try {
    response = trackResponse(await client.post(endpoint, body, { headers: authHeaders }));
    console.log(response.data)
  } catch (netErr) {
    const err = new Error(`Red no disponible llamando ${endpoint}: ${netErr.message}`);
    err.code = 'PATRIMONIAL_NETWORK';
    err.endpoint = endpoint;
    throw err;
  }
  const elapsed = Date.now() - t0;
  const ok = response.data?.status === true;
  console.log(`[Patrimonial][${ts}] <- ${endpoint} ${response.status} ${ok ? 'ok' : 'FAIL'} in ${elapsed}ms`);
  if (!ok) console.warn(`[Patrimonial] body: ${JSON.stringify(response.data).slice(0, 800)}`);
  return response;
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
 */
async function getPlanesPatrimonial(cramo = DEFAULT_RAMO) {
  const planes = await getPlanes(cramo)
  console.log(planes)
  return planes;
}

async function getPlanes(cramo) {
  const ramo = cramo || getConfig().cramo;
  const endpoint = '/planes/producto';
  const response = await post(endpoint, { cproducto: 'EMB', citem: '80080', centidad: 'P' });
  if (response.status >= 200 && response.status < 300 && response.data?.status === true) {
    const planes = response.data.data?.plan ?? [];
    return { planes, raw: response.data };
  }
  throw buildError(response.status, response.data, endpoint);
}

/**
 * Normaliza y agrega las coberturas retornadas por spCalculoRiesgoGeneral / quote-generalRisks.
 * @param {Array<object>|object} rawData
 * @param {number} [ptasamonFallback=1]
 * @returns {{ mprima: number, mprimaext: number, ptasa: number, sumaAsegurada: number, coberturas: Array<object> }}
 */
function aggregateQuoteData(rawData, ptasamonFallback = 1) {
  if (!rawData) {
    return { mprima: 0, mprimaext: 0, ptasa: ptasamonFallback || 1, sumaAsegurada: 0, coberturas: [] };
  }

  console.log('rawDAta', rawData)

  function normalizeItem(row) {
    const primaExt = Number(row.mprimaext ?? row.prima ?? 0);
    const primaBs = Number(row.mprima ?? 0);
    const suma = Number(row.msuma ?? row.msumaasegext ?? row.msumaaseg ?? row.sumaAsegurada ?? row.msumamax ?? 0);
    const name = String(row.xcobertura ?? row.name ?? row.xdescripcion_l ?? row.xdescripcion ?? '').trim();

    return {
      ccobertura: row.ccobertura != null ? String(row.ccobertura).trim() : undefined,
      name,
      xcobertura: name,
      prima: primaExt,
      mprima: primaBs,
      mprimaext: primaExt,
      sumaAsegurada: suma || null,
      msuma: suma || null,
      msumamax: row.msumamax != null ? Number(row.msumamax) : undefined,
      msumamin: row.msumamin != null ? Number(row.msumamin) : undefined,
      cproducto: row.cproducto != null ? String(row.cproducto).trim() : undefined,
    };
  }

  // Si ya viene pre-calculado con mprima / mprimaext
  if (!Array.isArray(rawData) && (rawData.mprima != null || rawData.mprimaext != null)) {
    const rawCob = Array.isArray(rawData.coberturas) ? rawData.coberturas : (Array.isArray(rawData.data) ? rawData.data : []);
    const normalizedCoberturas = rawCob.map(normalizeItem);
    return {
      mprima: Number(rawData.mprima ?? 0),
      mprimaext: Number(rawData.mprimaext ?? 0),
      ptasa: Number(rawData.ptasa ?? rawData.ptasamon ?? ptasamonFallback ?? 1),
      sumaAsegurada: Number(rawData.sumaAsegurada ?? rawData.msuma ?? 0),
      coberturas: normalizedCoberturas,
    };
  }

  const items = Array.isArray(rawData) ? rawData : (rawData.data ?? rawData.recordset ?? rawData.coberturas ?? []);
  let totalPrimaExt = 0;
  let totalPrimaBs = 0;
  let maxSuma = 0;
  let ptasa = ptasamonFallback || 0;

  const coberturas = items.map((row) => {
    const mapped = normalizeItem(row);
    if (mapped.sumaAsegurada && mapped.sumaAsegurada > maxSuma) maxSuma = mapped.sumaAsegurada;
    totalPrimaExt += mapped.mprimaext;
    totalPrimaBs += mapped.mprima;
    if (row.ptasa != null && !ptasa) ptasa = Number(row.ptasa);
    if (row.ptasamon != null && !ptasa) ptasa = Number(row.ptasamon);
    return mapped;
  });

  return {
    mprima: totalPrimaBs || (totalPrimaExt * (ptasa || 1)),
    mprimaext: totalPrimaExt,
    ptasa: ptasa || 1,
    sumaAsegurada: maxSuma || 0,
    coberturas,
  };
}

/**
 * Cotiza un plan de Riesgos Generales / Patrimonial.
 * POST /api/v1/partner/starter/patrimonial/quote (QuoteGeneralRisksDto)
 * @param {{ cramo?: number, cplan: string, ptasamon?: number, cuotas?: number, ifrecuencia?: string, pdescuento?: number, precargo?: number }} params
 */
async function quoteGeneralRisks({ cramo = DEFAULT_RAMO, cplan, ptasamon = 500, cuotas = 1, ifrecuencia = 'A', pdescuento = 0, precargo = 0 }) {
  const base = getBaseUrl();
  const url = `${base}/api/v1/partner/starter/patrimonial/quote`;
  const payload = {
    cramo: Number(cramo || DEFAULT_RAMO),
    cplan: String(cplan).trim(),
    ptasamon: Number(ptasamon || 0),
    cuotas: Number(cuotas || 1),
    ifrecuencia: String(ifrecuencia || 'A').trim().toUpperCase(),
    pdescuento: Number(pdescuento || 0),
    precargo: Number(precargo || 0),
  };

  const ts = new Date().toISOString();
  console.log(`[Patrimonial][${ts}] -> quote ${JSON.stringify(payload)}`);
  const t0 = Date.now();

  const response = trackResponse(
    await axios.post(url, payload, await axiosOpts()),
  );
  const elapsed = Date.now() - t0;

  const data = response.data;
  const ok = response.status >= 200 && response.status < 300 && data?.status !== false;
  console.log(`[Patrimonial][${ts}] <- quote ${response.status} ${ok ? 'ok' : 'FAIL'} in ${elapsed}ms`);

  if (ok) {
    const rawResult = data?.data ?? data?.recordset ?? data;
    const aggregated = aggregateQuoteData(rawResult, payload.ptasamon);
    return {
      status: true,
      data: Array.isArray(data?.data) ? data.data : aggregated.coberturas,
      recordset: data?.recordset ?? (Array.isArray(data?.data) ? data.data : []),
      ...aggregated,
      raw: data,
    };
  }

  throw buildError(response.status, data, '/quote');
}

/**
 * Emite una póliza de Riesgos Generales / Patrimonial.
 * POST /api/v1/partner/starter/patrimonial/emit (CreateEmissionGeneralRiskDto)
 * @param {object} payload - Payload formateado con keys, tomador, asegurado, bien_asegurado, suma_asegurada, etc.
 */
async function createEmissionGeneralRisk(payload) {
  const base = getBaseUrl();
  const url = `${base}/api/v1/partner/starter/patrimonial/emit`;

  const ts = new Date().toISOString();
  console.log(`[Patrimonial][${ts}] -> generalRisks emit cplan=${payload.keys?.cplan ?? '?'} cramo=${payload.keys?.cramo ?? '?'}`);
  const t0 = Date.now();

  const response = trackResponse(
    await axios.post(url, payload, await axiosOpts()),
  );
  const elapsed = Date.now() - t0;

  const data = response.data;
  const ok = response.status >= 200 && response.status < 300 && data?.status !== false;
  console.log(`[Patrimonial][${ts}] <- emit ${response.status} ${ok ? 'ok' : 'FAIL'} in ${elapsed}ms`);

  if (ok) {
    const result = data?.result ?? data?.data ?? data;
    const cnpoliza = String(result.cnpoliza ?? result.number ?? '').trim();
    const cnrecibo = String(result.cnrecibo ?? '').trim();
    const urlpoliza = String(result.urlpoliza ?? result.documentUrl ?? '').trim();
    const lapso = Number(result.lapso ?? result.fanopol ?? new Date().getFullYear());
    const mes = String(result.mes ?? result.fmespol ?? String(new Date().getMonth() + 1).padStart(2, '0'));
    const ncuota = Number(result.ncuota ?? 1);
    const message = String(result.message ?? data?.message ?? 'Póliza generada exitosamente');

    if (!cnpoliza && !cnrecibo && !urlpoliza) {
      throw buildError(response.status, { message: 'Respuesta de emisión inválida: cnpoliza/cnrecibo faltantes' }, '/emit');
    }

    return {
      status: true,
      message,
      cnpoliza,
      urlpoliza,
      lapso,
      mes,
      cnrecibo,
      ncuota,
      fanopol: lapso,
      fmespol: mes,
      raw: data,
    };
  }

  throw buildError(response.status, data, '/emit');
}

module.exports = {
  getPlanesPatrimonial,
  quoteGeneralRisks,
  createEmissionGeneralRisk,
  aggregateQuoteData,
  DEFAULT_RAMO,
};
