/**
 * Datos de cobro para pasar de Emisión a Pagos en la misma sesión (personas, pago directo).
 *
 * Misma forma que buildFuneralCheckoutPatch de Nexus (link de pago por correo): con
 * checkoutRules.requirePayment = true, Pagos exige el pago antes de emitir.
 * Nunca se emite sin pago desde este flujo.
 *
 * Frecuencias M/T/S: el monto a cobrar es la 1ª cuota (prima anual ÷ cuotas, paridad Sis2000
 * ROUND((ROUND(mprimaext,2)/cuotas)×ptasa,2)); Pagos cobra esa cuota y domicilia el resto.
 */

const CUOTAS_POR_FRECUENCIA = { M: 12, T: 4, S: 2 };

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {object} snapshot  quote, selectedPlan, funeral, metadataCanal, …
 * @param {{ cplan: string, planName?: string, submissionId: string, originSessionId?: string }} opts
 * @returns {object|null} null si la cotización no tiene prima válida (se usa el flujo por correo).
 */
function buildFuneralCheckoutPatch(snapshot, opts) {
  const quote = (snapshot && snapshot.quote) || {};
  const mprimaext = Number(quote.mprimaext ?? quote.mprima ?? 0);
  const ptasa = Number(quote.ptasa ?? 1) || 1;
  const mprima = Number(quote.mprima ?? mprimaext * ptasa);
  const annualVes = mprima > 0 ? mprima : mprimaext * ptasa;
  if (!Number.isFinite(annualVes) || annualVes <= 0) return null;

  const planLabel =
    opts.planName ||
    String((snapshot.selectedPlan && snapshot.selectedPlan.name) || '').trim() ||
    `Plan ${opts.cplan}`;

  const funeral = (snapshot && snapshot.funeral) || {};
  const ifrecuencia = String(funeral.frecuencia || 'A').trim().toUpperCase().charAt(0) || 'A';
  const cuotas = CUOTAS_POR_FRECUENCIA[ifrecuencia] || 1;
  const fraccionado = cuotas > 1;

  let totalVes = annualVes;
  let totalUsd = mprimaext > 0 ? mprimaext : undefined;
  if (fraccionado && mprimaext > 0) {
    const cuotaUsd = round2(mprimaext) / cuotas;
    totalVes = round2(cuotaUsd * ptasa);
    totalUsd = round2(cuotaUsd);
  } else if (fraccionado) {
    totalVes = round2(annualVes / cuotas);
  }
  if (!Number.isFinite(totalVes) || totalVes <= 0) return null;

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
      subtitle: fraccionado ? `Seguro de personas · 1ª de ${cuotas} cuotas` : 'Seguro de personas · pago en línea',
      totalVes,
      totalUsd,
      exchangeRate: ptasa,
    },
  };
}

module.exports = { buildFuneralCheckoutPatch, CUOTAS_POR_FRECUENCIA };
