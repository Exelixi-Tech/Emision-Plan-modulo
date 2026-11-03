/**
 * Rango de año del vehículo (fano) en policyValidator: el piso debe cubrir lo que
 * ofrece el catálogo INMA/Formulario (prod 3-nov-2026: vehículo 1979 cotizado y
 * pagado, rechazado al emitir con "fano fuera de rango (1980-...)").
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEmissionPayload, FANO_MIN } = require('../src/services/policyValidator');

const fanoErrors = (fano) =>
  validateEmissionPayload({ fano }).filter((e) => e.startsWith('fano'));

test('acepta 1979 (vehículo real cotizado en INMA) y el piso del Formulario (1900)', () => {
  assert.equal(FANO_MIN, 1900);
  assert.deepEqual(fanoErrors(1979), []);
  assert.deepEqual(fanoErrors(1900), []);
  assert.deepEqual(fanoErrors(new Date().getFullYear() + 1), []);
});

test('acepta el año como string numérico', () => {
  assert.deepEqual(fanoErrors('1979'), []);
});

test('sigue rechazando fuera de rango, vacío o no entero', () => {
  const yearNow = new Date().getFullYear();
  for (const bad of [1899, yearNow + 2, '', null, undefined, 'abc', 2015.5]) {
    assert.equal(fanoErrors(bad).length, 1, `debe rechazar ${JSON.stringify(bad)}`);
  }
});
