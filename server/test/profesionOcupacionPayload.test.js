/**
 * Profesión y ocupación del tomador en el body de emisión RCV (POST /external/createEmissionAuto).
 * Con la marca de Formulario (ocupacionSeparada) van por separado: cprofesion_* = maprofes,
 * cocupacion_* = maocupac. Sin la marca el body queda como antes (cprofesion trae la ocupación).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { toLaMundialEmissionPayload } = require('../src/services/policyMapper');

const base = {
  cramo: 18,
  plan: 'RCVBAS',
  tipo_cedula_tomador: 'V',
  rif_tomador: '10870482',
  rif_titular: '10870482',
  fdesde: '2026-10-29',
  fhasta: '2027-10-29',
};

test('con ocupación separada envía profesión, ocupación y la marca', () => {
  const body = toLaMundialEmissionPayload({
    ...base,
    bocupacion_separada: true,
    cprofesion_tomador: 7,
    cprofesion_titular: 7,
    cocupacion_tomador: 120,
    cocupacion_titular: 120,
  });
  assert.equal(body.bocupacion_separada, true);
  assert.equal(body.cprofesion_tomador, 7);
  assert.equal(body.cocupacion_tomador, 120);
  assert.equal(body.cocupacion_titular, 120);
});

test('con ocupación separada y sin ocupación elegida no envía cocupacion', () => {
  const body = toLaMundialEmissionPayload({ ...base, bocupacion_separada: true, cprofesion_tomador: 7 });
  assert.equal(body.bocupacion_separada, true);
  assert.equal('cocupacion_tomador' in body, false);
});

test('sin la marca el body no cambia (datos de una versión anterior de Formulario)', () => {
  const body = toLaMundialEmissionPayload({ ...base, cprofesion_tomador: 120, cocupacion_tomador: 5 });
  assert.equal('bocupacion_separada' in body, false);
  assert.equal('cocupacion_tomador' in body, false);
  assert.equal(body.cprofesion_tomador, 120);
});
