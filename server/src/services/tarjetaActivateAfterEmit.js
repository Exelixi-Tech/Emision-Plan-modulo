/**
 * Activa tarjeta RCV en La Mundial tras emisión exitosa (solo flujo ?flujo=tarjeta).
 * Fail-open: un error en activate no revierte la póliza emitida.
 */
const { activateTarjetaCard } = require('./tarjetaCardsClient');

function isRcvTarjetaFlow(state) {
  const meta = state?.metadataCanal || {};
  return String(meta.flujo || '').toLowerCase() === 'tarjeta'
    || Boolean(meta.xcodigo_unico || meta.ctarjeta);
}

function normalizeCodigo(raw) {
  return String(raw || '').trim().replace(/\s+/g, '').slice(0, 80);
}

/** Mismo criterio que validate-bill en OCR. */
function normalizeNfactura(raw) {
  return String(raw || '').replace(/\D/g, '').slice(0, 16);
}

function resolveXfotoFactura(state) {
  const doc = state?.documents?.factura;
  const url = doc?.file?.url || doc?.url || state?.metadataCanal?.xfoto_factura;
  return url ? String(url).trim() : undefined;
}

function formatFactivacion(femision) {
  const raw = String(femision || '').trim();
  const datePart = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${datePart} ${hh}:${mm}:${ss}`;
  }
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function resolvePolicyKeys(emission, meta) {
  const raw = emission?._raw?.result ?? emission?._raw ?? {};
  const cpoliza = Number(emission?.cpoliza ?? raw.cpoliza ?? meta.cpoliza);
  const casegurado = Number(emission?.casegurado ?? raw.casegurado ?? meta.casegurado);
  return { cpoliza, casegurado };
}

/**
 * @param {object} state
 * @param {object} emission
 * @returns {Record<string, unknown>|null}
 */
function buildTarjetaActivatePayload(state, emission) {
  if (!isRcvTarjetaFlow(state)) return null;

  const meta = state?.metadataCanal || {};
  const xcodigo_unico = normalizeCodigo(meta.xcodigo_unico);
  if (!xcodigo_unico) return null;

  const cnpoliza = String(emission?.cnpoliza ?? '').trim();
  const fanopol = Number(emission?.fanopol);
  const fmespol = Number(emission?.fmespol);
  const { cpoliza, casegurado } = resolvePolicyKeys(emission, meta);

  if (!cnpoliza || !Number.isFinite(fanopol) || !Number.isFinite(fmespol)) {
    return { _skip: 'datos_poliza_incompletos' };
  }
  if (!Number.isFinite(cpoliza) || cpoliza <= 0) {
    return { _skip: 'cpoliza_no_disponible' };
  }
  if (!Number.isFinite(casegurado) || casegurado <= 0) {
    return { _skip: 'casegurado_no_disponible' };
  }

  const femision =
    state?.fechaEmision
    || state?.quote?.fechaEmision
    || emission?.femision
    || new Date().toISOString().slice(0, 10);

  const payload = {
    xcodigo_unico,
    cpoliza,
    cnpoliza,
    fanopol,
    fmespol,
    casegurado,
    factivacion: formatFactivacion(femision),
  };

  const nfactura = normalizeNfactura(meta.nfactura || state?.tarjeta?.nfactura);
  if (nfactura) payload.nfactura = nfactura;

  const xfoto_factura = resolveXfotoFactura(state);
  if (xfoto_factura) payload.xfoto_factura = xfoto_factura;

  return payload;
}

/**
 * @param {object} state
 * @param {object} emission
 * @param {object} [metadata]
 */
async function activateTarjetaAfterEmit(state, emission, metadata = {}) {
  const payload = buildTarjetaActivatePayload(state, emission);
  if (!payload) {
    metadata.tarjetaActivateSkipped = 'not_rcv_tarjeta_flow';
    return undefined;
  }
  if (payload._skip) {
    metadata.tarjetaActivateSkipped = payload._skip;
    console.warn(`[tarjeta-activate] omitido: ${payload._skip} cnpoliza=${emission?.cnpoliza ?? '?'}`);
    return undefined;
  }

  try {
    const result = await activateTarjetaCard(payload);
    metadata.tarjetaActivate = result;
    return result;
  } catch (err) {
    metadata.tarjetaActivateError = err.message;
    console.error(
      `[tarjeta-activate] falló cnpoliza=${emission?.cnpoliza ?? '?'}:`,
      err.message,
      err.raw ? JSON.stringify(err.raw).slice(0, 300) : '',
    );
    return undefined;
  }
}

module.exports = {
  activateTarjetaAfterEmit,
  buildTarjetaActivatePayload,
  isRcvTarjetaFlow,
};
