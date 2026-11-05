/**
 * Errores de cotizar personas con mensaje único al cliente (ver server/src/lib/personasErrorClass.js).
 * Edad: solo lo que lo dice expresamente ("criterios de edad", "edad fuera", "fuera de rango").
 * Prima 0 o sin tarifa es dato del plan en Sis2000, aunque el texto mencione "edades".
 */
export const AGE_OUT_OF_RANGE_TITLE = 'Edad fuera de rango';
export const AGE_OUT_OF_RANGE_MESSAGE =
  'La edad indicada del titular no está permitida en el rango del plan. Elige otro plan.';

export const PLAN_UNAVAILABLE_TITLE = 'Plan no disponible para cotizar';
export const PLAN_UNAVAILABLE_MESSAGE =
  'Este plan no está disponible para cotizar en este momento. Elige otro plan o contacta a soporte.';

const AGE_PATTERN = /criterios de edad|edad fuera|(?<!vigencia )fuera de rango|PERSONAS_AGE/i;
const PLAN_UNAVAILABLE_PATTERN = /prima cero|prima del recibo en 0|sin tarifa|no tiene tarifa|PERSONAS_PLAN_UNAVAILABLE/i;

export function isAgeOutOfRangeError(messageOrCode: unknown): boolean {
  return AGE_PATTERN.test(String(messageOrCode ?? ''));
}

export function isPlanUnavailableError(messageOrCode: unknown): boolean {
  return PLAN_UNAVAILABLE_PATTERN.test(String(messageOrCode ?? ''));
}
