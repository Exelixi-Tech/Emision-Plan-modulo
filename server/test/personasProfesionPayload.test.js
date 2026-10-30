/**
 * Profesión, ocupación y actividad económica en el payload de emisión de personas
 * (CreateEmissionPersonDto). El titular que es el mismo tomador hereda lo que le falte;
 * cada asegurado envía los suyos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEmissionPersonRequest } = require('../src/services/personasMapper');

const cotizacion = { mprimaext: 10, ptasa: 40 };
const tomador = {
  tipoDoc: 'V', identificacion: '12345678', nombre: 'ANA', apellido: 'PEREZ',
  cprofesion: '36', cocupacion: '101', cactividad: '',
};

test('tomador y titular (mismo tomador) envían profesión, ocupación y actividad', () => {
  const state = {
    tomador,
    funeral: { asegurados: [{ tipoDoc: 'V', identificacion: '12345678', nombre: 'ANA', apellido: 'PEREZ' }] },
  };
  const { payload } = buildEmissionPersonRequest(state, cotizacion);
  assert.equal(payload.cprofesion_tomador, 36);
  assert.equal(payload.cocupacion_tomador, 101);
  assert.equal(payload.cactividad_tomador, null);
  assert.equal(payload.cprofesion_titular, 36);
  assert.equal(payload.cocupacion_titular, 101);
  assert.equal(payload.asegurados[0].cprofesion, 36);
  assert.equal(payload.asegurados[0].cocupacion, 101);
});

test('titular distinto y asegurados adicionales envían sus propios datos', () => {
  const state = {
    tomador,
    funeral: {
      asegurados: [
        { tipoDoc: 'V', identificacion: '87654321', nombre: 'LUIS', cprofesion: 7, cactividad: 3 },
        { tipoDoc: 'V', identificacion: '22222222', nombre: 'HIJO', cparen: 3 },
      ],
    },
  };
  const { payload } = buildEmissionPersonRequest(state, cotizacion);
  assert.equal(payload.cprofesion_titular, 7);
  assert.equal(payload.cocupacion_titular, null, 'no hereda del tomador: es otra persona');
  assert.equal(payload.cactividad_titular, 3);
  assert.deepEqual(
    [payload.asegurados[1].cprofesion, payload.asegurados[1].cocupacion, payload.asegurados[1].cactividad],
    [null, null, null],
  );
});

test('sin datos, todo va en null (el SP no toca maclient_atr)', () => {
  const state = { tomador: { tipoDoc: 'V', identificacion: '1' }, funeral: { asegurados: [] } };
  const { payload } = buildEmissionPersonRequest(state, cotizacion);
  assert.equal(payload.cprofesion_tomador, null);
  assert.equal(payload.cprofesion_titular, null);
  assert.equal(payload.cocupacion_titular, null);
});
