/**
 * Mensaje de edad solo con evidencia de edad. Caso real QA (MAEME1 ramo 50, titular de 30 años):
 * nest-api responde prima cero y la pantalla decía que la edad no estaba permitida.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AGE_OUT_OF_RANGE_MESSAGE,
  PLAN_UNAVAILABLE_MESSAGE,
  classifyPersonasError,
} = require('../src/lib/personasErrorClass');

test('prima cero de nest-api: plan no disponible, aunque el texto diga "edades"', () => {
  const msg = 'La cotización retornó prima cero. Verifique el plan, los parentescos y las edades de los asegurados.';
  assert.deepEqual(classifyPersonasError(msg), {
    code: 'PERSONAS_PLAN_UNAVAILABLE',
    message: PLAN_UNAVAILABLE_MESSAGE,
  });
});

test('falta de tarifa y prima del recibo en 0 (SP de emisión): plan no disponible', () => {
  for (const msg of [
    'Sin tarifa diaria en mapltabedad_d para plan/edad.',
    'Prima del recibo en 0 para el plan MAEME1 ramo 50: revise edad y parentesco de los asegurados contra la tarifa del plan.',
    'Este plan no tiene tarifa para los asegurados indicados.',
  ]) {
    assert.equal(classifyPersonasError(msg)?.code, 'PERSONAS_PLAN_UNAVAILABLE', msg);
  }
});

test('edad real: sigue siendo PERSONAS_AGE', () => {
  for (const msg of [
    'El asegurado/titular no cumple con los criterios de edad para este plan. (Min: 18, Max: 65).',
    'Edad fuera de rango permitido para el plan',
  ]) {
    assert.deepEqual(
      classifyPersonasError(msg),
      { code: 'PERSONAS_AGE', message: AGE_OUT_OF_RANGE_MESSAGE },
      msg,
    );
  }
});

test('el resto conserva su mensaje (vigencia, parentesco, red)', () => {
  for (const msg of [
    'Vigencia fuera de rango (1-366 días)',
    'El asegurado/titular no cumple con los criterios de parentesco para este plan.',
    'Red no disponible llamando /cotizacion: timeout',
    '',
    null,
  ]) {
    assert.equal(classifyPersonasError(msg), null, String(msg));
  }
});
