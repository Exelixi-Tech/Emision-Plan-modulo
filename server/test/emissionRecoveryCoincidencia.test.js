/** La póliza recuperada debe coincidir en todos los datos del intento (27-nov-2026). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const file = require.resolve(path.join('..', 'src', 'services', 'nestApiClient.js'));
const real = require(file);
const llamadas = [];
let filas = [];
require.cache[file].exports = { ...real, getPolizaPorVehiculoViaNestApi: async (a) => { llamadas.push(a); return filas; } };
const recovery = require('../src/services/emissionRecovery');

const MIN = 60 * 1000;
const t0 = Date.parse('2026-11-27T16:02:49Z');
const payload = {
  placa: 'AK9C34D', serial_carroceria: '8YZRGV6C9TD000027', serial_motor: 'MOT1', rif_tomador: '12345678',
  rif_titular: '87654321', plan: 'RCVBAS', frecuencia: 'A', fdesde: '2026-11-27', fhasta: '2027-11-27',
  fecha_emision: '2026-11-27', productor: '80080', ccanalalt: 30, fano: 2024, marca: '10', modelo: '20', version: '30',
};
const intento = { ...recovery.attemptData(payload, { mprimaext: 36.22 }), sinceMs: t0, now: t0 + 3 * MIN };
const fila = {
  cnpoliza: '18-1-0000147613', cnrecibo: '18-1100000001', xplaca: 'AK9C34D', xsercar: '8YZRGV6C9TD000027', xsermot: 'MOT1',
  ctenedor: '12345678', casegurado: '87654321', cplan: 'RCVBAS', ifrecuencia: 'A', fdesde: '2026-11-27', fhasta: '2027-11-27',
  femision: '2026-11-27', cproductor: 80080, ccanalalt: 30, cano: 2024, cmarca: '10', cmodelo: '20', cversion: '30',
  mprimaext: 36.22, iestado: 'V', iestadorec: 'P', edadSegundos: 170,
};
const poliza = (over = {}) => { const f = { ...fila, ...over }; return { ...f, placa: f.xplaca, serial: f.xsercar }; };

test.beforeEach(() => { recovery._resetForTests(); llamadas.length = 0; delete process.env.EMISSION_RECOVERY_LOOKUP; });

test('la póliza con todos los datos iguales corresponde al intento', () => {
  assert.deepEqual(recovery.policyMismatches(poliza(), intento), []);
});

for (const [campo, cambio] of [
  ['placa', { xplaca: 'ZZ999ZZ' }], ['serial', { xsercar: 'OTRO' }], ['cedulaTomador', { ctenedor: '1' }],
  ['cedulaTitular', { casegurado: '1' }], ['plan', { cplan: 'OTRO' }], ['frecuencia', { ifrecuencia: 'M' }],
  ['fdesde', { fdesde: '2026-11-26' }], ['fhasta', { fhasta: '2027-05-27' }], ['femision', { femision: '2026-11-26' }],
  ['cproductor', { cproductor: 215 }], ['serialMotor', { xsermot: 'OTRO' }], ['ano', { cano: 2023 }],
  ['marca', { cmarca: '11' }], ['modelo', { cmodelo: '21' }], ['version', { cversion: '31' }],
  ['ccanalalt', { ccanalalt: 99 }], ['prima', { mprimaext: 40 }], ['estadoPoliza', { iestado: 'N' }],
  ['estadoRecibo', { iestadorec: 'C' }], ['fechaIngreso', { edadSegundos: 300 }],
]) {
  test(`una diferencia en ${campo} impide adoptarla`, () => {
    assert.deepEqual(recovery.policyMismatches(poliza(cambio), intento), [campo]);
  });
}

test('si el intento no traía canal, no se adopta una póliza con canal', () => {
  assert.deepEqual(recovery.policyMismatches(poliza(), { ...intento, ccanalalt: undefined }), ['ccanalalt']);
  assert.deepEqual(recovery.policyMismatches(poliza({ ccanalalt: null }), { ...intento, ccanalalt: undefined }), []);
});

test('sin un dato exigido en el intento o en la póliza no se adopta', () => {
  assert.ok(recovery.policyMismatches(poliza(), { ...intento, cedulaTomador: '' }).includes('cedulaTomador'));
  assert.ok(recovery.policyMismatches({ cnpoliza: '1', placa: 'AK9C34D' }, intento).length > 5);
});

test('un reintento tardío adopta la póliza creada en el primer intento, no una anterior', () => {
  recovery.markUncertain('K', t0 + 3 * MIN, t0);
  const now = t0 + 8 * MIN;
  const sinceMs = recovery.attemptSince('K', now, now);
  assert.equal(sinceMs, t0);
  assert.deepEqual(recovery.policyMismatches(poliza({ edadSegundos: 470 }), { ...intento, sinceMs, now }), []);
  assert.deepEqual(recovery.policyMismatches(poliza({ edadSegundos: 600 }), { ...intento, sinceMs, now }), ['fechaIngreso']);
});

test('un segundo fallo conserva la hora del primero; resolver o vencer la ventana la olvida', () => {
  recovery.markUncertain('K', t0 + 3 * MIN, t0);
  recovery.markUncertain('K', t0 + 6 * MIN, t0 + 5 * MIN);
  assert.equal(recovery.attemptSince('K', t0 + 7 * MIN, t0 + 7 * MIN), t0);
  assert.equal(recovery.attemptSince('K', t0 + 20 * MIN, t0 + 20 * MIN), t0 + 20 * MIN);
  recovery.markUncertain('J', t0, t0);
  recovery.clearUncertain('J');
  assert.equal(recovery.attemptSince('J', t0 + MIN, t0 + MIN), t0 + MIN);
});

test('consulta nest-api con placa y serial normalizados y adopta la fila completa', async () => {
  const ahora = Date.now();
  filas = [{ ...fila, edadSegundos: 10 }];
  const found = await recovery.recoverIssuedPolicy({ ...intento, placa: 'ak9-c34d', sinceMs: ahora - MIN, now: undefined });
  assert.equal(found.cnpoliza, fila.cnpoliza);
  assert.equal(llamadas[0].placa, 'AK9C34D');
  assert.ok(Date.parse(llamadas[0].desde) <= ahora - MIN);
});

test('una API sin los datos nuevos no permite adoptar nada', async () => {
  filas = [{ cnpoliza: '18-1-1', cnrecibo: 'r', xplaca: 'AK9C34D', xsercar: '8YZRGV6C9TD000027', cproductor: 80080, ccanalalt: 30, fingreso: '2026-11-27 12:02:50.000', iestado: 'V' }];
  assert.equal(await recovery.recoverIssuedPolicy({ ...intento, sinceMs: Date.now() - MIN, now: undefined }), null);
});

test('EMISSION_RECOVERY_LOOKUP=false no consulta', async () => {
  process.env.EMISSION_RECOVERY_LOOKUP = 'false';
  assert.equal(await recovery.recoverIssuedPolicy({ ...intento }), null);
  assert.equal(llamadas.length, 0);
});

test('la consulta de pólizas por vehículo va con apikey y sin Bearer', async () => {
  process.env.NEST_API_KEY = 'nest_prueba';
  process.env.NEST_API_URL = 'http://nest.invalid';
  process.env.NEST_AUTH_USE_TOKEN = 'true';
  const axios = require('axios');
  const get = axios.get;
  let enviado;
  axios.get = async (_url, opts) => { enviado = opts; return { status: 200, headers: {}, data: { data: [] } }; };
  try {
    await real.getPolizaPorVehiculoViaNestApi({ placa: 'AA000AA', desde: new Date(t0).toISOString() });
  } finally { axios.get = get; }
  assert.equal(enviado.headers.apikey, 'nest_prueba');
  assert.equal(enviado.headers.Authorization, undefined);
});
