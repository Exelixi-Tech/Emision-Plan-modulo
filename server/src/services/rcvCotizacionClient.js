/**
 * nest-api para el flujo "Emitir RCV desde cotización": lectura de la cotización de SysIP y tasa BCV.
 * Misma credencial (apikey → token) con la que este server ya emite RCV; nunca se expone al navegador.
 */
const axios = require('axios');
const { getBaseUrl, buildAuthHeaders, trackResponse, getTimeout } = require('./nestApiClient');

function codedError(code, message, httpStatus, raw) {
  const err = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  if (raw !== undefined) err.raw = raw;
  return err;
}

/** GET /api/v1/cotizaciones-auto/:cproces → data de la cotización. */
async function getCotizacionAuto(cproces) {
  const url = `${getBaseUrl()}/api/v1/cotizaciones-auto/${encodeURIComponent(String(cproces))}`;
  let response;
  try {
    response = trackResponse(await axios.get(url, {
      headers: await buildAuthHeaders(),
      timeout: getTimeout(),
      validateStatus: () => true,
    }));
  } catch (err) {
    throw codedError('COTIZACION_NO_DISPONIBLE', `No se pudo consultar la cotización: ${err.message}`, 502);
  }
  const body = response.data ?? {};
  if (response.status === 404 || body.code === 'COTIZACION_NO_EXISTE') {
    throw codedError('COTIZACION_NO_EXISTE', body.message || `No existe la cotización ${cproces}.`, 404, body);
  }
  if (response.status >= 200 && response.status < 300 && body.data && typeof body.data === 'object') {
    return body.data;
  }
  throw codedError(
    'COTIZACION_NO_DISPONIBLE',
    body.message || `HTTP ${response.status} consultando la cotización ${cproces}.`,
    502,
    body,
  );
}

/** GET /api/v1/moneda/tasa-bcv?fecha= → ptasa (Bs por USD). */
async function getTasaBcv(fecha) {
  const qs = fecha ? `?fecha=${encodeURIComponent(fecha)}` : '';
  const response = trackResponse(await axios.get(`${getBaseUrl()}/api/v1/moneda/tasa-bcv${qs}`, {
    headers: await buildAuthHeaders(),
    timeout: getTimeout(),
    validateStatus: () => true,
  }));
  const ptasa = Number(response.data?.data?.ptasa ?? response.data?.ptasa);
  if (response.status >= 200 && response.status < 300 && ptasa > 0) return ptasa;
  throw codedError(
    'TASA_NO_DISPONIBLE',
    response.data?.message || `HTTP ${response.status} consultando la tasa BCV.`,
    502,
    response.data,
  );
}

module.exports = { getCotizacionAuto, getTasaBcv };
