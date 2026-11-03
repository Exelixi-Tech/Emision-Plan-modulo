/**
 * Rango del año del vehículo (policyValidator), alineado con el SP RCV y el catálogo INMA.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { _internal: { fanoValido } } = require('../src/services/policyValidator');

test('fano: acepta vehículos anteriores a 1980 y el año del catálogo INMA (actual + 2)', () => {
  const y = new Date().getFullYear();
  assert.equal(fanoValido(1975), true);
  assert.equal(fanoValido(1950), true);
  assert.equal(fanoValido(y + 2), true);
  assert.equal(fanoValido(y + 3), false);
  assert.equal(fanoValido(1900), false);
  assert.equal(fanoValido(NaN), false);
});
