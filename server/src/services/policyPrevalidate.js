/**
 * Prevalidación RCV (antes de cobrar): construye el mismo payload que la emisión
 * (buildEmissionRequest) y corre el mismo validador (validateEmissionPayload),
 * SIN cotizar ni emitir ni tocar Sis2000.
 *
 * Los montos se toman de state.quote si existen; si no, se usan valores
 * positivos de relleno para que solo se evalúen los datos de personas/vehículo.
 */
const { buildEmissionRequest } = require('./policyMapper');
const { validateEmissionPayload } = require('./policyValidator');

const ECONOMIC_ERROR_RE = /^(mprima|mprimaext|ptasa) /;

function validateStateForEmit(state, overrides = {}) {
  const plan = overrides.plan || state.selectedPlan?.cplan || process.env.LAMUNDIAL_PLAN_DEFAULT || 'RCVBAS';
  const frecuencia = overrides.frecuencia || state.rcv?.frecuencia || process.env.LAMUNDIAL_FRECUENCIA_DEFAULT || 'A';
  const ndias = overrides.ndias ?? state.rcv?.ndias;
  const q = state.quote || {};
  const cotizacion = {
    mprima: Number(q.mprima) > 0 ? Number(q.mprima) : 1,
    mprimaext: Number(q.mprimaext) >= 0 ? Number(q.mprimaext) : 0,
    ptasa: Number(q.ptasa) > 0 ? Number(q.ptasa) : 1,
  };
  const { payload } = buildEmissionRequest(state, cotizacion, { plan, frecuencia, ndias });
  return validateEmissionPayload(payload).filter((e) => !ECONOMIC_ERROR_RE.test(e));
}

module.exports = { validateStateForEmit };
