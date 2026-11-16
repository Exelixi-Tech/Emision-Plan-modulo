/**
 * RCV Binacional: 1 tripulante fijo (criterio La Mundial 16-nov-2026) → `puestos` al cotizar coberturas y
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

test('binacional: siempre 1 tripulante (puestos y npuestos) y sin bpuestos_informados', () => {
  for (const rcv of [{}, { tripulantes: 0 }, { tripulantes: 3 }]) {
    const state = estado('binacional', rcv);
    state.vehicle.tripulantes = 2;
    assert.equal(resolveTripulantesBinacional(state), 1);
    assert.equal(cotizar(state).puestos, 1);
    assert.equal(cotizar(state).iplaca, 'B');
    assert.equal(emitir(state).body.npuestos, 1);
    assert.equal('bpuestos_informados' in cotizar(state), false);
    assert.equal('bpuestos_informados' in emitir(state).body, false);
  }
});

test('nacional y extranjera: nunca se envían tripulantes aunque el estado los traiga', () => {
  for (const tipoPlaca of ['nacional', 'extranjera', undefined]) {
    const state = estado(tipoPlaca, { tripulantes: 2 });
    state.vehicle.tripulantes = 3;
    assert.equal(resolveTripulantesBinacional(state), null);
    assert.equal('puestos' in cotizar(state), false);
    assert.equal('npuestos' in emitir(state).interno, false);
    assert.equal(emitir(state).body.npuestos, 5);
    assert.equal('bpuestos_informados' in emitir(state).body, false);
  }
});
