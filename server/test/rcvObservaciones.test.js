/**
 * Observaciones de la póliza RCV: viajan en state.rcv.observaciones (Pagos reenvía state.rcv)
 * y llegan a nest-api createEmissionAuto como `observaciones` (recortadas, máx. 255; vacío no se envía).
 *
 * Correr: node --test server/test/rcvObservaciones.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarObservaciones, OBSERVACIONES_MAX } = require('../src/lib/observaciones');
const { buildEmissionRequest, toLaMundialEmissionPayload } = require('../src/services/policyMapper');

function baseState(rcvExtra = {}) {
  return {
    tomador: { tipoDoc: 'V', identificacion: '12345678', nombre: 'ANA', apellido: 'PEREZ', fechaNac: '1980-01-01', sexo: 'F', telefono: '04141234567', email: 'a@b.com', cestado: 1, cciudad: 1, direccion: 'X' },
    sameInsured: true,
    vehicle: { placa: 'AB123CD', serial: 'SER123', año: '2015', cmarca: '1', cmodelo: '1', cversion: '1', marca: 'M', modelo: 'M', ccategoria_uso: 1, tipoPlaca: 'nacional' },
    selectedPlan: { cplan: 'RCVBAS' },
    rcv: { frecuencia: 'A', ...rcvExtra },
    metadataCanal: {},
  };
}

function bodyNest(state) {
  const { payload } = buildEmissionRequest(state, { mprima: 1, mprimaext: 1, ptasa: 1 });
  return { payload, body: toLaMundialEmissionPayload(payload, {}) };
}

test('normalizar: recorta espacios y vacío = undefined', () => {
  assert.equal(normalizarObservaciones('  Pago con cheque  '), 'Pago con cheque');
  assert.equal(normalizarObservaciones('   '), undefined);
  assert.equal(normalizarObservaciones(''), undefined);
  assert.equal(normalizarObservaciones(undefined), undefined);
  assert.equal(normalizarObservaciones(null), undefined);
  assert.equal(normalizarObservaciones(42), undefined);
});

test('normalizar: saltos de línea y tabs pasan a un espacio', () => {
  assert.equal(normalizarObservaciones('Línea 1\r\nLínea 2\t\tfin'), 'Línea 1 Línea 2 fin');
});

test('normalizar: nunca pasa de 255 (nest-api rechaza más largo)', () => {
  const r = normalizarObservaciones(`  ${'a'.repeat(300)}`);
  assert.equal(r.length, OBSERVACIONES_MAX);
});

test('sin observaciones el payload a nest-api no cambia', () => {
  const { payload, body } = bodyNest(baseState());
  assert.equal('observaciones' in payload, false);
  assert.equal('observaciones' in body, false);
});

test('observaciones solo con espacios no se envían', () => {
  const { body } = bodyNest(baseState({ observaciones: '   \n ' }));
  assert.equal('observaciones' in body, false);
});

test('con observaciones llegan recortadas a createEmissionAuto', () => {
  const { payload, body } = bodyNest(baseState({ observaciones: '  Asegurado solicita copia física  ' }));
  assert.equal(payload.observaciones, 'Asegurado solicita copia física');
  assert.equal(body.observaciones, 'Asegurado solicita copia física');
});

test('texto de más de 255 llega truncado a 255', () => {
  const { body } = bodyNest(baseState({ observaciones: 'b'.repeat(400) }));
  assert.equal(body.observaciones.length, 255);
});
