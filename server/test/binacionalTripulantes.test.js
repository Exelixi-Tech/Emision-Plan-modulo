/**
 * RCV Binacional: tripulantes (rcv.tripulantes, 1–3) → `puestos` al cotizar coberturas y
 * `npuestos` al emitir. Nacional y extranjera no cambian: sin `puestos` en la cotización
 * (nest-api usa los del modelo) y el mismo `npuestos` de siempre en la emisión.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCalculatePlanCoberturasRequest,
  buildEmissionRequest,
  toLaMundialEmissionPayload,
  resolveTripulantesBinacional,
} = require('../src/services/policyMapper');

function estado(tipoPlaca, rcv = {}) {
  return {
    tomador: {
      tipoDoc: 'V',
      identificacion: '12345678',
      nombre: 'ANA',
      apellido: 'PEREZ',
      telefono: '04141234567',
      email: 'ana@example.com',
      sexo: 'F',
      fechaNac: '1990-01-01',
      cestado: 17,
      cciudad: 1,
      direccion: 'AV PRINCIPAL',
    },
    sameInsured: true,
    vehicle: {
      placa: 'AB123CD',
      serial: '8X1234567890',
      año: '2015',
      marca: 'TOYOTA',
      modelo: 'COROLLA',
      cmarca: '1',
      cmodelo: '2',
      cversion: '3',
      ccategoria_uso: 1,
      tipoPlaca,
    },
    selectedPlan: { cplan: 'BINAC' },
    rcv: { frecuencia: 'A', ...rcv },
  };
}

const cotizar = (state) => buildCalculatePlanCoberturasRequest(state).payload;
const emitir = (state) => {
  const cot = { mprima: 10, mprimaext: 1, ptasa: 1 };
  const { payload } = buildEmissionRequest(state, cot);
  return { interno: payload, body: toLaMundialEmissionPayload(payload, cot) };
};

test('binacional: los tripulantes elegidos van como puestos (cotización) y npuestos (emisión)', () => {
  for (const n of [1, 2, 3]) {
    const state = estado('binacional', { tripulantes: n });
    assert.equal(cotizar(state).puestos, n);
    assert.equal(cotizar(state).iplaca, 'B');
    assert.equal(emitir(state).body.npuestos, n);
  }
});

test('binacional: fuera de rango se acota a 1–3 y acepta el número como texto', () => {
  assert.equal(resolveTripulantesBinacional(estado('binacional', { tripulantes: 0 })), 1);
  assert.equal(resolveTripulantesBinacional(estado('binacional', { tripulantes: 9 })), 3);
  assert.equal(resolveTripulantesBinacional(estado('binacional', { tripulantes: '2' })), 2);
  assert.equal(resolveTripulantesBinacional(estado('binacional', { tripulantes: 'x' })), null);
});

test('binacional sin dato (sesión anterior al selector): se comporta como antes', () => {
  const state = estado('binacional');
  assert.equal('puestos' in cotizar(state), false);
  assert.equal('npuestos' in emitir(state).interno, false);
  assert.equal(emitir(state).body.npuestos, 5);
});

test('nacional y extranjera: nunca se envían tripulantes aunque el estado los traiga', () => {
  for (const tipoPlaca of ['nacional', 'extranjera', undefined]) {
    const state = estado(tipoPlaca, { tripulantes: 2 });
    assert.equal(resolveTripulantesBinacional(state), null);
    assert.equal('puestos' in cotizar(state), false);
    assert.equal('npuestos' in emitir(state).interno, false);
    assert.equal(emitir(state).body.npuestos, 5);
  }
});
