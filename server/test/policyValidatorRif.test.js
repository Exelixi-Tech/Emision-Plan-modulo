/**
 * Límite de dígitos de cédula/RIF por tipo de documento (policyValidator).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { _internal: { rifMaxDigitos, rifValido } } = require('../src/services/policyValidator');

test('J/G/C aceptan el RIF con dígito verificador (9 dígitos)', () => {
  for (const tipo of ['J', 'G', 'C', 'j']) assert.equal(rifMaxDigitos(tipo), 9);
  assert.equal(rifValido('313174769', 'J'), true);
  assert.equal(rifValido('3131747690', 'J'), false);
});

test('V y P siguen en 8 dígitos; E en 10', () => {
  assert.equal(rifValido('19529692', 'V'), true);
  assert.equal(rifValido('195296920', 'V'), false);
  assert.equal(rifValido('123456789', 'P'), false);
  assert.equal(rifValido('1234567890', 'E'), true);
  assert.equal(rifValido('12345678901', 'E'), false);
});

test('sin tipo se usa el límite de cédula (8)', () => {
  assert.equal(rifMaxDigitos(undefined), 8);
  assert.equal(rifValido('', 'J'), false);
});
