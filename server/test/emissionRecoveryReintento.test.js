/** Correcciones del 27-nov-2026: fecha de Sis2000 en servidores UTC, hora del primer intento y apikey. */
const test = require('node:test');
const assert = require('node:assert/strict');
const recovery = require('../src/services/emissionRecovery');

const MIN = 60 * 1000;
const t0 = Date.parse('2026-11-27T16:02:49Z');
const fila = {
  cnpoliza: '18-1-0000000001', placa: 'AA000AA', serial: 'S1', cproductor: 80080, ccanalalt: 30,
  fingreso: recovery.fingresoToIso('2026-11-27 12:02:50.000'),
};
const ctx = { placa: 'AA000AA', serial: 'S1', cproductor: 80080, ccanalalt: 30 };

test.beforeEach(() => recovery._resetForTests());

test('la hora de Sis2000 se convierte sin depender de la zona del servidor', () => {
  assert.equal(recovery.fingresoToIso('2026-11-27 12:02:50.000'), '2026-11-27T12:02:50.000-04:00');
  assert.equal(recovery.fingresoToIso('2026-11-27T16:02:50Z'), '2026-11-27T16:02:50Z');
});

test('un reintento tardío adopta la póliza creada en el primer intento', () => {
  recovery.markUncertain('K', t0 + 3 * MIN, t0);
  const now = t0 + 8 * MIN;
  const sinceMs = recovery.attemptSince('K', now, now);
  assert.equal(sinceMs, t0);
  assert.equal(recovery.matchesOwnRecentPolicy(fila, { ...ctx, sinceMs, now }), true);
  assert.equal(recovery.matchesOwnRecentPolicy(fila, { ...ctx, sinceMs: now, now }), false);
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

test('la consulta de pólizas por vehículo va con apikey y sin Bearer', async () => {
  process.env.NEST_API_KEY = 'nest_prueba';
  process.env.NEST_API_URL = 'http://nest.invalid';
  process.env.NEST_AUTH_USE_TOKEN = 'true';
  const axios = require('axios');
  const real = axios.get;
  let enviado;
  axios.get = async (url, opts) => { enviado = opts; return { status: 200, headers: {}, data: { data: [] } }; };
  try {
    await require('../src/services/nestApiClient').getPolizaPorVehiculoViaNestApi({ placa: 'AA000AA', desde: new Date(t0).toISOString() });
  } finally { axios.get = real; }
  assert.equal(enviado.headers.apikey, 'nest_prueba');
  assert.equal(enviado.headers.Authorization, undefined);
});
