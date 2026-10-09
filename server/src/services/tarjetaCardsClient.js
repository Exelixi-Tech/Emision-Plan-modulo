/**
 * Cliente HTTP La Mundial — tarjetas RCV (POST /api/v1/cards/activate).
 */
const axios = require('axios');

function cardsBaseUrl() {
  return (
    process.env.LAMUNDIAL_CARDS_URL
    || process.env.LAMUNDIAL_BASE_URL
    || 'https://qaapisys2000.lamundialdeseguros.com'
  ).replace(/\/$/, '');
}

function cardsHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const key = (
    process.env.LAMUNDIAL_CARDS_APIKEY
    || process.env.LAMUNDIAL_APIKEY
    || process.env.LAMUNDIAL_EMISSION_APIKEY
    || ''
  ).trim();
  if (key) headers.apikey = key;
  return headers;
}

function lmMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
  if (typeof data.data?.mensaje === 'string' && data.data.mensaje.trim()) return data.data.mensaje.trim();
  if (typeof data.mensaje === 'string' && data.mensaje.trim()) return data.mensaje.trim();
  return fallback;
}

function isLmSuccess(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.success === false || data.status === false) return false;
  const resultado = data.data?.resultado ?? data.resultado;
  if (resultado != null && Number(resultado) !== 1) return false;
  return data.success === true || data.status === true || Number(resultado) === 1;
}

/**
 * @param {Record<string, unknown>} body
 */
async function activateTarjetaCard(body) {
  const url = `${cardsBaseUrl()}/api/v1/cards/activate`;
  console.log(
    `[tarjeta-cards] -> activate xcodigo=${body.xcodigo_unico} cnpoliza=${body.cnpoliza}`,
  );

  const upstream = await axios.post(url, body, {
    headers: cardsHeaders(),
    timeout: parseInt(process.env.LAMUNDIAL_TIMEOUT_MS, 10) || 20000,
    validateStatus: () => true,
  });

  const data = upstream.data && typeof upstream.data === 'object' ? upstream.data : {};
  if (upstream.status >= 400 || !isLmSuccess(data)) {
    const err = new Error(lmMessage(data, 'Activación de tarjeta rechazada por La Mundial.'));
    err.code = 'TARJETA_ACTIVATE_LM_ERROR';
    err.httpStatus = upstream.status >= 400 ? upstream.status : 422;
    err.raw = data;
    throw err;
  }

  console.log(`[tarjeta-cards] <- activate OK HTTP ${upstream.status}`);
  return data.data || data;
}

module.exports = { activateTarjetaCard };
