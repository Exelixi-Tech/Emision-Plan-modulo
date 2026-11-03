/**
 * Prevalidación RCV antes de cobrar (POST /api/policies/validate): mismo mapeo y validador que emit,
 * sin cotizar ni emitir.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStateForEmit } = require('../src/services/policyPrevalidate');

function persona(extra = {}) {
  return {
    tipoDoc: 'V',
    identificacion: '19529692',
    nombre: 'MARIA',
    apellido: 'PEREZ',
    telefono: '04141234567',
    email: 'maria@example.com',
    fechaNac: '1990-05-10',
    cestado: 17,
    cciudad: 1,
    direccion: 'AV PRINCIPAL CASA 1',
    ...extra,
  };
}

function estado(extra = {}) {
  return {
    tomador: persona(),
    sameInsured: true,
    vehicle: { placa: 'AB123CD', serial: '8X1234567890', año: '2015', marca: 'TOYOTA', modelo: 'COROLLA' },
    selectedPlan: { cplan: 'RCVBAS' },
    rcv: { frecuencia: 'A' },
    ...extra,
  };
}

test('titular igual al tomador con datos completos: ok sin errores', () => {
  const errs = validateStateForEmit(estado());
  assert.deepEqual(errs, []);
});

test('titular distinto con nombre vacío (caso OCR 1 palabra): error nombre_titular requerido', () => {
  const errs = validateStateForEmit(estado({
    sameInsured: false,
    asegurado: persona({ identificacion: '12345678', nombre: '', apellido: 'GOMEZ' }),
  }));
  assert.ok(errs.includes('nombre_titular requerido'), errs.join('; '));
});

test('vehículo 1979: ok (fano ya corregido)', () => {
  const errs = validateStateForEmit(estado({
    vehicle: { placa: 'AB123CD', serial: '8X1234567890', año: '1979', marca: 'FORD', modelo: 'F350' },
  }));
  assert.deepEqual(errs, []);
});

test('sin cotización en el state no se reportan errores económicos', () => {
  const errs = validateStateForEmit(estado({ quote: undefined }));
  for (const e of errs) assert.doesNotMatch(e, /mprima|ptasa/);
});
