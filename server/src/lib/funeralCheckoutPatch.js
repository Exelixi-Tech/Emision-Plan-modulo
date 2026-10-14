/**
 * Datos de cobro para pasar de Emisión a Pagos en la misma sesión (personas, pago directo).
 *
 * Misma forma que buildFuneralCheckoutPatch de Nexus (link de pago por correo): con
 * checkoutRules.requirePayment = true, Pagos exige el pago antes de emitir.
 * Nunca se emite sin pago desde este flujo.
 */

/**
 * @param {object} snapshot  quote, selectedPlan, funeral, metadataCanal, tomador, …
 * @param {{ cplan: string, planName?: string, submissionId: string, originSessionId?: string }} opts
 * @returns {object|null} null si la cotización no tiene prima válida (se usa el flujo por correo).
 */
function buildFuneralCheckoutPatch(snapshot, opts) {
  const quote = (snapshot && snapshot.quote) || {};
  const mprimaext = Number(quote.mprimaext ?? quote.mprima ?? 0);
  const ptasa = Number(quote.ptasa ?? 1) || 1;
  const mprima = Number(quote.mprima ?? mprimaext * ptasa);
  const totalVes = mprima > 0 ? mprima : mprimaext * ptasa;
  if (!Number.isFinite(totalVes) || totalVes <= 0) return null;

  const planLabel =
    opts.planName ||
    String((snapshot.selectedPlan && snapshot.selectedPlan.name) || '').trim() ||
    `Plan ${opts.cplan}`;

  const funeral = (snapshot && snapshot.funeral) || {};
  const ifrecuencia = String(funeral.frecuencia || 'A').trim().toUpperCase().charAt(0) || 'A';
  const fraccionado = ['M', 'T', 'S'].includes(ifrecuencia);

  const prevCanal =
    snapshot.metadataCanal && typeof snapshot.metadataCanal === 'object' ? snapshot.metadataCanal : {};

  return {
    product: 'funerario',
    quoteState: 'ready',
    metadataCanal: {
      ...prevCanal,
      funeralSubmissionId: opts.submissionId,
      ...(opts.originSessionId ? { originSessionId: opts.originSessionId } : {}),
    },
    funeralSubmissionId: opts.submissionId,
    originSessionId: opts.originSessionId,
    funeralApprovedCheckout: true,
    fraccionado,
    checkoutPayload: { ifrecuencia, fraccionado, requireFirstPayment: fraccionado },
    checkoutRules: {
      requirePayment: true,
      lockFields: true,
      hideNavigation: true,
      onSuccess: { mode: 'emit' },
      fraccionado,
    },
    checkout: {
      title: planLabel,
      subtitle: 'Seguro funerario · pago en línea',
      totalVes,
      totalUsd: mprimaext > 0 ? mprimaext : undefined,
      exchangeRate: ptasa,
    },
  };
}

module.exports = { buildFuneralCheckoutPatch };
