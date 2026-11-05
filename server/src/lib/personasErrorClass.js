/**
 * Clasifica los errores de cotizar/emitir personas que se le muestran al cliente con un
 * mensaje único. Solo es edad lo que lo dice expresamente (spCalculoPer, speeValidatePersonGeneral,
 * spCalculoViajeroProrrata). Prima 0 o sin tarifa es dato del plan en Sis2000, aunque el texto de
 * nest-api o del SP mencione "edades": la edad fuera del rango declarado ya falla antes con
 * "criterios de edad"; lo demás no se distingue de un plan sin tarifa cargada.
 */
const AGE_OUT_OF_RANGE_MESSAGE =
  'La edad indicada del titular no está permitida en el rango del plan. Elige otro plan.';
const PLAN_UNAVAILABLE_MESSAGE =
  'Este plan no está disponible para cotizar en este momento. Elige otro plan o contacta a soporte.';

function isAgeOutOfRange(msg) {
  return /criterios de edad|edad fuera|(?<!vigencia )fuera de rango/i.test(String(msg || ''));
}

function isPlanUnavailable(msg) {
  return /prima cero|prima del recibo en 0|sin tarifa|no tiene tarifa/i.test(String(msg || ''));
}

/** @returns {{ code: string, message: string } | null} null: no es un caso conocido. */
function classifyPersonasError(msg) {
  if (isAgeOutOfRange(msg)) return { code: 'PERSONAS_AGE', message: AGE_OUT_OF_RANGE_MESSAGE };
  if (isPlanUnavailable(msg)) return { code: 'PERSONAS_PLAN_UNAVAILABLE', message: PLAN_UNAVAILABLE_MESSAGE };
  return null;
}

module.exports = { AGE_OUT_OF_RANGE_MESSAGE, PLAN_UNAVAILABLE_MESSAGE, classifyPersonasError };
