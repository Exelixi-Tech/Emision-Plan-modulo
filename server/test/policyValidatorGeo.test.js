/**
 * Estado y ciudad de tomador y titular (policyValidator) y sin códigos inventados (catalogs).
 * En prod (nov-2026) llegaban emisiones con el titular sin estado/ciudad y la membresía Arys fallaba.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEmissionPayload, _internal: { codigoGeoValido, titularEsTomador } } = require('../src/services/policyValidator');
const { resolveStateCode, resolveCityCode } = require('../src/services/catalogs');

const geoErrores = (p) => validateEmissionPayload(p).filter((e) => /^(estado|ciudad)_/.test(e));

test('códigos de estado/ciudad: enteros > 0', () => {
  assert.equal(codigoGeoValido(24), true);
  assert.equal(codigoGeoValido('201'), true);
  for (const v of [0, '0', null, undefined, '', 'ZULIA', 1.5]) assert.equal(codigoGeoValido(v), false);
});

const tomador = { tipo_cedula_tomador: 'V', rif_tomador: '12345678', estado_tomador: 24, ciudad_tomador: 201 };

test('titular distinto del tomador: exige su propio estado y ciudad', () => {
  const p = { ...tomador, tipo_cedula_titular: 'V', rif_titular: '87654321', estado_titular: null, ciudad_titular: 0 };
  assert.equal(titularEsTomador(p), false);
  assert.deepEqual(geoErrores(p), [
    'estado_titular requerido (código de estado)',
    'ciudad_titular requerida (código de ciudad)',
  ]);
  assert.deepEqual(geoErrores({ ...p, estado_titular: 1, ciudad_titular: 128 }), []);
});

test('titular = tomador: solo se exigen los del tomador', () => {
  const p = { ...tomador, tipo_cedula_titular: 'V', rif_titular: '12345678', estado_titular: null, ciudad_titular: null };
  assert.equal(titularEsTomador(p), true);
  assert.deepEqual(geoErrores(p), []);
  assert.deepEqual(geoErrores({ ...p, estado_tomador: null }), ['estado_tomador requerido (código de estado)']);
});

test('mismo número con otro tipo de documento (V vs J) cuenta como persona distinta', () => {
  assert.equal(titularEsTomador({ ...tomador, tipo_cedula_titular: 'J', rif_titular: '12345678' }), false);
});

test('sin coincidencia ya no inventa Distrito Capital (1) ni la ciudad 128', () => {
  assert.equal(resolveStateCode('Zulia'), 24);
  assert.equal(resolveStateCode('La Guaira'), 22);
  assert.equal(resolveStateCode('Texto raro'), null);
  assert.equal(resolveStateCode(undefined), null);
  assert.equal(resolveCityCode('Maracaibo', 24), null);
});
