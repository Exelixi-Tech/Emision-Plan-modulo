/**
 * Alinea cotización con tasa y monto del pago verificado (fecha pasada).
 */
const { getPtasamonUsdForDate } = require('./bcvRate');

/**
 * @param {object} state wizard state (paymentVerified, paymentCapture)
 * @param {{ mprima: number, mprimaext: number, ptasa: number, metadata?: object }} quoteResult
 */
async function alignQuoteWithPaymentCapture(state, quoteResult) {
  if (!state?.paymentVerified) return quoteResult;
  const pay = state.paymentCapture || {};
  const fecha = String(pay.paidOn || pay.fpago || '').slice(0, 10);
  if (!fecha) return quoteResult;

  let ptasaPago = pay.ptasaPago != null ? Number(pay.ptasaPago) : 0;
  if (!(ptasaPago > 0)) {
    try {
      const row = await getPtasamonUsdForDate(fecha);
      ptasaPago = row.ptasa;
    } catch {
      return quoteResult;
    }
  }

  let mprima = Number(quoteResult.mprima);
  if (pay.amount != null && Number(pay.amount) > 0) {
    mprima = Number(pay.amount);
  } else if (Number(quoteResult.mprimaext) > 0) {
    mprima = parseFloat((Number(quoteResult.mprimaext) * ptasaPago).toFixed(2));
  }

  return {
    ...quoteResult,
    mprima,
    ptasa: ptasaPago,
    ptasamon_pago: ptasaPago,
  };
}

module.exports = { alignQuoteWithPaymentCapture };
