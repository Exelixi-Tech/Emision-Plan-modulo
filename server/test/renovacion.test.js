/**
 * Renovar = póliza nueva enlazada: cnpoliza_rel, itipoEmi NU y vigencia desde la fhasta anterior.
 * Sin state.renovacion el payload de emisión no cambia.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { renovacionDeState, esLaPolizaQueSeRenueva } = require('../src/lib/renovacion');
const { buildEmissionRequest, toLaMundialEmissionPayload } = require('../src/services/policyMapper');

const NOW = new Date(2026, 10, 2, 10, 0, 0); // 2-nov-2026

const renov = (extra = {}) => ({
  flujo: 'renovacion',
  cnpoliza_rel: '18-1-0130481024',
  itipoEmi: 'NU',
  precargada: true,
  fdesde_sugerida: '2026-11-20',
  fhasta_sugerida: '2027-11-20',
  ...extra,
});

test('sin renovación devuelve null', () => {
  assert.equal(renovacionDeState({}, NOW), null);
  assert.equal(renovacionDeState({ renovacion: renov({ precargada: false }) }, NOW), null);
  assert.equal(renovacionDeState({ renovacion: renov({ cnpoliza_rel: "x' or 1=1" }) }, NOW), null);
});

test('continuidad: fdesde = fhasta anterior y fhasta sugerida', () => {
  assert.deepEqual(renovacionDeState({ renovacion: renov() }, NOW), {
    cnpoliza_rel: '18-1-0130481024', itipoEmi: 'NU', fdesde: '2026-11-20', fhasta: '2027-11-20',
  });
});

test('también se lee desde metadataCanal (Pagos solo reenvía metadataCanal)', () => {
  const r = renovacionDeState({ metadataCanal: { renovacion: renov() } }, NOW);
  assert.equal(r.cnpoliza_rel, '18-1-0130481024');
});

test('fdesde sugerida en el pasado → hoy y +1 año', () => {
  const r = renovacionDeState({ renovacion: renov({ fdesde_sugerida: '2026-10-01' }) }, NOW);
  assert.equal(r.fdesde, '2026-11-02');
  assert.equal(r.fhasta, '2027-11-02');
});

test('póliza vigente: solo la que se renueva deja pasar', () => {
  assert.equal(esLaPolizaQueSeRenueva('18-1-0130481024', '18-1-0130481024'), true);
  assert.equal(esLaPolizaQueSeRenueva('18-1-0130481099', '18-1-0130481024'), false);
  assert.equal(esLaPolizaQueSeRenueva('18-1-0130481024', undefined), false);
});

function baseState(extra = {}) {
  return {
    tomador: { tipoDoc: 'V', identificacion: '12345678', nombre: 'ANA', apellido: 'PEREZ', fechaNac: '1980-01-01', sexo: 'F', telefono: '04141234567', email: 'a@b.com', cestado: 1, cciudad: 1, direccion: 'X' },
    sameInsured: true,
    vehicle: { placa: 'AB123CD', serial: 'SER123', año: '2015', cmarca: '1', cmodelo: '1', cversion: '1', marca: 'M', modelo: 'M', ccategoria_uso: 1, tipoPlaca: 'nacional' },
    selectedPlan: { cplan: 'RCVBAS' },
    rcv: { frecuencia: 'A' },
    metadataCanal: {},
    ...extra,
  };
}

test('buildEmissionRequest: sin renovación no manda cnpoliza_rel ni itipoEmi', () => {
  const { payload } = buildEmissionRequest(baseState(), { mprima: 1, mprimaext: 1, ptasa: 1 });
  assert.equal(payload.cnpoliza_rel, undefined);
  assert.equal(payload.itipoEmi, undefined);
  assert.equal(payload.fdesde, payload.fecha_emision);
  const body = toLaMundialEmissionPayload(payload, {});
  assert.equal(body.cnpoliza_rel, undefined);
  assert.equal(body.itipoEmi, undefined);
});

test('buildEmissionRequest: renovación manda cnpoliza_rel, NU y vigencia desde fdesde sugerida', () => {
  const fdesde = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const state = baseState({ renovacion: renov({ fdesde_sugerida: fdesde, fhasta_sugerida: null }) });
  const { payload } = buildEmissionRequest(state, { mprima: 1, mprimaext: 1, ptasa: 1 });
  assert.equal(payload.cnpoliza_rel, '18-1-0130481024');
  assert.equal(payload.itipoEmi, 'NU');
  assert.equal(payload.fdesde, fdesde);
  assert.notEqual(payload.fdesde, payload.fecha_emision);
  const body = toLaMundialEmissionPayload(payload, {});
  assert.equal(body.cnpoliza_rel, '18-1-0130481024');
  assert.equal(body.itipoEmi, 'NU');
  assert.equal(body.fdesde, fdesde);
  assert.equal(Number(body.fhasta.slice(0, 4)), Number(fdesde.slice(0, 4)) + 1);
});
