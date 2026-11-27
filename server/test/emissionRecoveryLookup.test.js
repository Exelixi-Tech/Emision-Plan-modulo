/** Lookup real de recuperación: nest-api GET /canal/poliza-por-vehiculo (26-nov-2026). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const file = require.resolve(path.join('..', 'src', 'services', 'nestApiClient.js'));
const llamadas = [];
let filas = [];
require.cache[file] = {
  id: file, filename: file, loaded: true,
  exports: { getPolizaPorVehiculoViaNestApi: async (a) => { llamadas.push(a); return filas; } },
};
const recovery = require('../src/services/emissionRecovery');

test.beforeEach(() => { llamadas.length = 0; delete process.env.EMISSION_RECOVERY_LOOKUP; });

test('fingresoToIso interpreta la hora de Sis2000 como Caracas (UTC-4)', () => {
  assert.equal(Date.parse(recovery.fingresoToIso('2026-11-26 12:19:49.000')), Date.parse('2026-11-26T16:19:49Z'));
});

test('caso 7311: recupera la póliza propia con placa+serial+productor+canal', async () => {
  filas = [{
    cnpoliza: '18-1-0000147613', cnrecibo: '18-1100000001', xplaca: 'AK9C34D', xsercar: '8YZRGV6C9TD000027',
    cproductor: 80080, ccanalalt: 30, cscanalalt: 23, fingreso: '2026-11-26 12:19:49.000', fanopol: 2026, fmespol: 11,
  }];
  const now = Date.parse('2026-11-26T16:21:00Z');
  const real = Date.now; Date.now = () => now;
  try {
    const found = await recovery.recoverIssuedPolicy({
      placa: 'ak9-c34d', serial: '8yzrgv6c9td000027', cproductor: 80080, ccanalalt: 30,
      sinceMs: Date.parse('2026-11-26T16:19:37Z'), now,
    });
    assert.equal(found.cnpoliza, '18-1-0000147613');
  } finally { Date.now = real; }
  assert.equal(llamadas[0].placa, 'AK9C34D');
  assert.equal(llamadas[0].serial, '8YZRGV6C9TD000027');
  assert.ok(Date.parse(llamadas[0].desde) <= Date.parse('2026-11-26T16:19:37Z'));
});

test('otra póliza del vehículo con otro productor no se adopta', async () => {
  filas = [{ cnpoliza: '18-1-1', xplaca: 'AK9C34D', xsercar: 'S1', cproductor: 999, ccanalalt: 30, fingreso: '2026-11-26 12:19:49.000' }];
  const now = Date.parse('2026-11-26T16:21:00Z');
  const r = await recovery.recoverIssuedPolicy({ placa: 'AK9C34D', serial: 'S1', cproductor: 80080, ccanalalt: 30, sinceMs: now - 60000, now });
  assert.equal(r, null);
});

test('EMISSION_RECOVERY_LOOKUP=false no consulta', async () => {
  process.env.EMISSION_RECOVERY_LOOKUP = 'false';
  const r = await recovery.recoverIssuedPolicy({ placa: 'A1B', serial: 'S', cproductor: 1, sinceMs: Date.now() });
  assert.equal(r, null);
  assert.equal(llamadas.length, 0);
});
