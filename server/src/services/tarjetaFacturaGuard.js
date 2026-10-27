/**
 * Tarjeta pagada en caja (bfactura=1): la foto de la factura es obligatoria.
 * - Antes de emitir: sin foto no se emite (422 TARJETA_FACTURA_FOTO).
 * - Después de archivar: si el expediente no quedó con factura, alerta en log
 *   ([tarjeta-factura] ALERTA) y marca metadata.tarjetaFacturaFaltante.
 * Autopago retail no aplica: la caja registró la factura y no hay foto.
 */
const { isRcvTarjetaFlow } = require('./tarjetaActivateAfterEmit');

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** ¿Este flujo exige foto de factura? */
function requiereFotoFactura(state) {
  const meta = state?.metadataCanal || {};
  if (!isRcvTarjetaFlow(state)) return false;
  if (isTruthyFlag(meta.autopago) || String(meta.autopago_token || '').trim()) return false;
  return isTruthyFlag(meta.bfactura);
}

/** URL de la foto subida en OCR (wizard o metadata de la tarjeta). */
function urlFotoFactura(state) {
  const doc = state?.documents?.factura;
  const url = doc?.file?.url || doc?.url || state?.metadataCanal?.xfoto_factura;
  return url ? String(url).trim() : '';
}

/** @returns {{ status: number, body: object } | null} rechazo si falta la foto. */
function rechazoSinFotoFactura(state) {
  if (!requiereFotoFactura(state) || urlFotoFactura(state)) return null;
  const meta = state?.metadataCanal || {};
  console.warn(
    `[tarjeta-factura] emisión bloqueada: sin foto de factura xcodigo=${meta.xcodigo_unico ?? '?'} nfactura=${meta.nfactura ?? '?'}`,
  );
  return {
    status: 422,
    body: {
      success: false,
      code: 'TARJETA_FACTURA_FOTO',
      message: 'Falta la foto de la factura. Vuelve al paso de documentos y súbela para poder emitir.',
    },
  };
}

/**
 * Tras archivar el expediente: alerta si la factura no quedó con link absoluto.
 * @param {object} state
 * @param {object} emission
 * @param {string|undefined} facturaLink
 * @param {object} [metadata]
 */
function alertarSiFaltaFactura(state, emission, facturaLink, metadata) {
  if (!requiereFotoFactura(state) || facturaLink) return;
  const meta = state?.metadataCanal || {};
  if (metadata) metadata.tarjetaFacturaFaltante = true;
  console.error(
    `[tarjeta-factura] ALERTA sin factura archivada cnpoliza=${emission?.cnpoliza ?? '?'} `
    + `xcodigo=${meta.xcodigo_unico ?? '?'} nfactura=${meta.nfactura ?? '?'} foto=${urlFotoFactura(state) || 'ninguna'}`,
  );
}

module.exports = {
  requiereFotoFactura,
  urlFotoFactura,
  rechazoSinFotoFactura,
  alertarSiFaltaFactura,
};
