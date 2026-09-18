/**
 * Activa recibo en Sis2000 tras pago verificado (RCV, funerario y demás ramos).
 * Devuelve URL pública del comprobante ingreso de caja cuando nest-api cobra OK.
 */
const { activateReceiptAfterPayment } = require('./nestApiCollectionClient');

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** Solo flujo RCV tarjeta (?flujo=tarjeta); RCV normal / funerario / demás ramos quedan igual. */
function isRcvTarjetaFlow(state) {
  const meta = state?.metadataCanal || {};
  return String(meta.flujo || '').toLowerCase() === 'tarjeta'
    || Boolean(meta.xcodigo_unico || meta.ctarjeta);
}

/**
 * bfactura=1: factura cargada y pagada en farmacia → xreferencia = nfactura.
 * bfactura=0: sin factura → referencia bancaria del pago móvil (flujo normal).
 */
function isTarjetaFarmaciaPayment(state, pay) {
  if (pay?.tarjetaFarmacia === true) return true;
  if (!isRcvTarjetaFlow(state)) return false;
  const meta = state?.metadataCanal || {};
  const pagadoEnFarmacia = isTruthyFlag(meta.skipPayment) || isTruthyFlag(meta.bfactura);
  if (!pagadoEnFarmacia) return false;
  return Boolean(String(meta.nfactura ?? pay?.reference ?? pay?.xreferencia ?? '').trim());
}

function resolveTarjetaFarmaciaNfactura(state, pay) {
  const meta = state?.metadataCanal || {};
  return String(
    pay?.xreferencia || pay?.reference || meta.nfactura || '',
  ).trim();
}

/**
 * @param {object} state - Wizard state con paymentVerified / paymentCapture
 * @param {{ cnrecibo: string, mpagoFallback?: number, metadata?: object }} opts
 * @returns {Promise<string|undefined>} url_ingreso_caja
 */
async function resolveIngresoCajaAfterPayment(state, { cnrecibo, mpagoFallback, metadata = {} }) {
  if (!cnrecibo) return undefined;

  if (!state?.paymentVerified) {
    metadata.collectionSkipped = 'pago_no_verificado';
    return undefined;
  }

  const pay = state.paymentCapture || {};
  const farmacia = isTarjetaFarmaciaPayment(state, pay);
  let xreferencia = farmacia
    ? resolveTarjetaFarmaciaNfactura(state, pay)
    : (pay.reference || pay.transactionId || pay.xreferencia);
  if (!xreferencia || String(xreferencia).trim() === '' || /^EX-/i.test(String(xreferencia))) {
    metadata.collectionSkipped = 'sin_referencia_bancaria';
    return undefined;
  }
  xreferencia = String(xreferencia).trim();

  const fpago = pay.paidOn || pay.fpago || new Date().toISOString().slice(0, 10);
  const mpago = pay.amount != null ? Number(pay.amount) : Number(mpagoFallback ?? 0);

  try {
    const collectionResult = await activateReceiptAfterPayment({
      cnrecibo,
      mpago,
      xreferencia,
      fpago: String(fpago).slice(0, 10),
      origen_pago: farmacia ? 'farmacia' : undefined,
      cusuario: pay.cusuario,
      cbanco_ref: pay.bankCode ? String(pay.bankCode).trim() : undefined,
      cbanco: pay.cbanco,
      cbanco_destino: pay.cbanco_destino,
      xtelefono: pay.sourcePhone ? String(pay.sourcePhone).trim() : undefined,
      telefono_dest: pay.telefonoDest ? String(pay.telefonoDest).trim() : undefined,
      cci_rif: pay.cci_rif ? String(pay.cci_rif).trim() : undefined,
      cbanco_dest_ref: pay.cbanco_dest_ref ? String(pay.cbanco_dest_ref).trim() : undefined,
    });
    metadata.collection = collectionResult;
    const url = collectionResult?.ingresoCaja;
    if (url) return String(url);
  } catch (err) {
    metadata.collectionError = err.message;
  }

  return undefined;
}

module.exports = { resolveIngresoCajaAfterPayment };
