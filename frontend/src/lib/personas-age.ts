/**
 * Edad fuera del rango de la tarifa del plan (personas).
 * Sis2000 lo informa de varias formas: prima 0, "criterios de edad", "Prima del recibo en 0…".
 * Al cliente siempre se le muestra el mismo mensaje.
 */
export const AGE_OUT_OF_RANGE_TITLE = 'Edad fuera de rango';
export const AGE_OUT_OF_RANGE_MESSAGE =
  'La edad indicada del titular no está permitida en el rango del plan. Elige otro plan.';

const AGE_PATTERN = /edad|rango|criterios de edad|sin tarifa|no tiene tarifa|prima del recibo en 0|PERSONAS_AGE/i;

export function isAgeOutOfRangeError(messageOrCode: unknown): boolean {
  return AGE_PATTERN.test(String(messageOrCode ?? ''));
}
