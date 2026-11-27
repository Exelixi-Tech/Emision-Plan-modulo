/**
 * Recuperación de emisiones con resultado incierto (timeout / 5xx / 409 por placa).
 * Incidente 26-nov-2026: nest-api emitió pero respondió ~2 min después; Emisión cortó a los 30 s.
 */
process.env.POLICY_MODE = 'live';
process.env.COVERAGE_BREAKDOWN_ENABLED = 'false';
process.env.QUOTE_SOURCE = 'nest-api';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const svc = (name) => require.resolve(path.join('..', 'src', 'services', name));
function stub(name, exports) {
  const file = svc(name);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const calls = { emit: 0, validate: 0, mail: [] };
let emitImpl;
let validateImpl;
let mailImpl;

stub('nestApiClient.js', {
  getCotizacionViaNestApi: async () => ({ mprima: 100, mprimaext: 10, ptasa: 10 }),
  calculatePlanCoberturasViaNestApi: async () => ({}),
  computeCoverageTotalUsd: () => 0,
  fetchCoberturaComponentPremiums: async () => ({}),
  extractTasasFromMount: () => ({}),
  buildTasasPayloadForCober: () => ({}),
  createEmissionAutoViaNestApi: async (b) => { calls.emit += 1; return emitImpl(b); },
  validateEmissionAutoViaNestApi: async (p) => { calls.validate += 1; return validateImpl(p); },
  generateConductorHabitualViaNestApi: async () => '',
  sendPolicyEmailViaNestApi: async (p) => { calls.mail.push(p); return mailImpl(p); },
  getValrepFrecuencias: async () => [],
  getBaseUrl: () => 'http://nest',
});
stub('collectionAfterPayment.js', { resolveIngresoCajaAfterPayment: async () => undefined });
stub('paymentQuoteAlign.js', { alignQuoteWithPaymentCapture: async (_s, q) => q });
stub('tarjetaActivateAfterEmit.js', { activateTarjetaAfterEmit: async () => {} });
const pendientes = [];
stub('postEmisionPendiente.js', {
  registrarPendiente: (o) => { pendientes.push(o); return { step: o.step, paymentReference: null }; },
});
stub('catalogs.js', { resolveCategoriaUsoFromVinma: async () => 1, resolveUsageCategory: () => 1 });
stub('policyValidator.js', { validateEmissionPayload: () => [] });
stub('planesClient.js', { resolveCusuarioCoberturas: () => 1 });
stub('policyMapper.js', {
  buildQuoteRequest: () => ({
    payload: { cplan: 'RCVBAS', cmarca: 1, cmodelo: 1, cversion: 1, fano: 2020 },
    metadata: {},
  }),
  buildCalculatePlanCoberturasRequest: () => ({ payload: null }),
  buildEmissionRequest: (state) => ({
    payload: {
      placa: state.vehicle.placa,
      serial_carroceria: state.vehicle.serial,
      cproductor: '80080',
      ccanalalt: 27,
      correo_tomador: 'a@b.c',
    },
    metadata: { internalPolicyId: 'INT-1' },
  }),
  toLaMundialEmissionPayload: (p) => ({ ...p, xplaca: p.placa }),
  resolveSelectedCoberturas: () => [],
  resolvePrimaryCoberAdicional: () => 'RC',
  resolveIplaca: () => 'N',
  resolveRcvCramo: () => 18,
});

const policyService = require('../src/services/policyService');
const recovery = require('../src/services/emissionRecovery');

const state = (placa = 'AB123CD') => ({
  vehicle: { placa, serial: 'SERIAL123', cmarca: 1, cmodelo: 1, cversion: 1, año: 2020 },
  tomador: {},
  paymentVerified: true,
  selectedPlan: { cplan: 'RCVBAS' },
  rcv: { frecuencia: 'A', ndias: 365 },
});

const ok = { cnpoliza: '18-1-0000147613', cnrecibo: '5-1-1', urlpoliza: 'u', ncuota: 1 };
const timeoutErr = () => Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
const plateErr = () => Object.assign(new Error('Ya existe una póliza vigente registrada con la misma placa.'), {
  code: 'LAMUNDIAL_PLATE_ALREADY_INSURED',
  httpStatus: 409,
});
const plateValidateErr = () => Object.assign(new Error('Ya existe una póliza vigente'), { code: 'PLATE_ALREADY_INSURED' });

const own = (over = {}) => ({
  cnpoliza: '18-1-0000147613',
  cnrecibo: '5-1-9',
  placa: 'AB123CD',
  serial: 'SERIAL123',
  cproductor: '80080',
  ccanalalt: 27,
  fingreso: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  ...over,
});

test.beforeEach(() => {
  recovery._resetForTests();
  calls.emit = 0;
  calls.validate = 0;
  calls.mail.length = 0;
  pendientes.length = 0;
  emitImpl = async () => ok;
  validateImpl = async () => ({ success: true });
  mailImpl = async () => ({ status: true, data: { sent: true } });
  policyService.testHooks.lookup = undefined;
});

test('emisión normal: emite una vez', async () => {
  const r = await policyService.quoteAndEmit(state());
  assert.equal(r.cnpoliza, ok.cnpoliza);
  assert.equal(calls.emit, 1);
});

test('timeout en emisión + póliza propia reciente -> recupera como emitida', async () => {
  emitImpl = async () => { throw timeoutErr(); };
  policyService.testHooks.lookup = async () => [own()];
  const r = await policyService.quoteAndEmit(state());
  assert.equal(r.cnpoliza, '18-1-0000147613');
  assert.equal(r.cnrecibo, '5-1-9');
});

test('5xx en emisión + póliza propia -> recupera', async () => {
  emitImpl = async () => { throw Object.assign(new Error('bad gateway'), { httpStatus: 502, code: 'NEST_API_EMISSION_ERROR' }); };
  policyService.testHooks.lookup = async () => own();
  const r = await policyService.quoteAndEmit(state());
  assert.equal(r.cnpoliza, '18-1-0000147613');
});

test('409 en validación + póliza propia reciente -> recupera sin re-emitir', async () => {
  validateImpl = async () => { throw plateValidateErr(); };
  policyService.testHooks.lookup = async () => [own()];
  const r = await policyService.quoteAndEmit(state());
  assert.equal(r.cnpoliza, '18-1-0000147613');
  assert.equal(calls.emit, 0);
});

test('409 al emitir + póliza propia reciente -> recupera', async () => {
  emitImpl = async () => { throw plateErr(); };
  policyService.testHooks.lookup = async () => [own()];
  const r = await policyService.quoteAndEmit(state());
  assert.equal(r.cnpoliza, '18-1-0000147613');
});

for (const [nombre, over] of [
  ['póliza vieja (hace 2 días)', { fingreso: new Date(Date.now() - 2 * 86400000).toISOString() }],
  ['otro productor', { cproductor: '1234' }],
  ['otro canal', { ccanalalt: 99 }],
  ['otro serial', { serial: 'OTRO999' }],
  ['otra placa', { placa: 'ZZ999ZZ' }],
  ['sin fecha de ingreso', { fingreso: undefined }],
]) {
  test(`409 con póliza ajena (${nombre}) -> error 409 de placa asegurada`, async () => {
    validateImpl = async () => { throw plateValidateErr(); };
    policyService.testHooks.lookup = async () => [own(over)];
    await assert.rejects(
      () => policyService.quoteAndEmit(state()),
      (e) => e.code === 'LAMUNDIAL_PLATE_ALREADY_INSURED' && e.httpStatus === 409,
    );
    assert.equal(calls.emit, 0);
  });
}

test('dos pólizas candidatas distintas -> ambiguo, no se adopta ninguna', async () => {
  validateImpl = async () => { throw plateValidateErr(); };
  policyService.testHooks.lookup = async () => [own(), own({ cnpoliza: '18-1-0000999999' })];
  await assert.rejects(() => policyService.quoteAndEmit(state()), (e) => e.code === 'LAMUNDIAL_PLATE_ALREADY_INSURED');
});

test('timeout sin lookup -> EMISSION_UNCERTAIN y el reintento no muestra el 409 genérico', async () => {
  emitImpl = async () => { throw timeoutErr(); };
  await assert.rejects(
    () => policyService.quoteAndEmit(state()),
    (e) => e.code === 'EMISSION_UNCERTAIN' && e.httpStatus === 409 && /verifique/i.test(e.message),
  );
  assert.equal(pendientes[0].step, 'emit_timeout');
  // Reintento: la validación da 409 por placa (como en el incidente) -> mensaje de incierto
  validateImpl = async () => { throw plateValidateErr(); };
  await assert.rejects(() => policyService.quoteAndEmit(state()), (e) => e.code === 'EMISSION_UNCERTAIN');
  assert.equal(calls.emit, 1);
});

test('409 genuino sin intento previo -> sigue siendo LAMUNDIAL_PLATE_ALREADY_INSURED', async () => {
  validateImpl = async () => { throw plateValidateErr(); };
  await assert.rejects(() => policyService.quoteAndEmit(state()), (e) => e.code === 'LAMUNDIAL_PLATE_ALREADY_INSURED');
});

test('idempotencia: dos emisiones simultáneas del mismo vehículo -> la segunda no llega a nest-api', async () => {
  let release;
  emitImpl = () => new Promise((resolve) => { release = () => resolve(ok); });
  const first = policyService.quoteAndEmit(state());
  await new Promise((r) => setTimeout(r, 30));
  await assert.rejects(() => policyService.quoteAndEmit(state()), (e) => e.code === 'EMISSION_IN_PROGRESS' && e.httpStatus === 409);
  release();
  const r = await first;
  assert.equal(r.cnpoliza, ok.cnpoliza);
  assert.equal(calls.emit, 1);
  // candado liberado: otro vehículo pasa
  emitImpl = async () => ok;
  const other = await policyService.quoteAndEmit(state('XY999ZZ'));
  assert.ok(other.cnpoliza);
});

test('el candado se libera si la emisión falla', async () => {
  emitImpl = async () => { throw Object.assign(new Error('boom'), { code: 'NEST_API_EMISSION_ERROR', httpStatus: 400 }); };
  await assert.rejects(() => policyService.quoteAndEmit(state()));
  emitImpl = async () => ok;
  const r = await policyService.quoteAndEmit(state());
  assert.equal(r.cnpoliza, ok.cnpoliza);
});

test('unwrapMailResponse lee data.sent del envoltorio de nest-api', () => {
  assert.equal(policyService.unwrapMailResponse({ status: true, data: { sent: true, mode: 'smtp' } }).sent, true);
  assert.equal(policyService.unwrapMailResponse({ sent: true }).sent, true);
  assert.equal(policyService.unwrapMailResponse({ status: true, data: { sent: false, mode: 'disabled' } }).mode, 'disabled');
  assert.deepEqual(policyService.unwrapMailResponse(null), {});
});

test('getEmitTimeout: default 150 s y configurable; getTimeout general no cambia', () => {
  const realPath = svc('nestApiClient.js');
  const saved = require.cache[realPath];
  delete require.cache[realPath];
  const real = require(realPath);
  delete process.env.EMISSION_TIMEOUT_MS;
  delete process.env.LAMUNDIAL_TIMEOUT_MS;
  assert.equal(real.getEmitTimeout(), 150000);
  assert.equal(real.getTimeout(), 60000);
  process.env.EMISSION_TIMEOUT_MS = '200000';
  assert.equal(real.getEmitTimeout(), 200000);
  delete process.env.EMISSION_TIMEOUT_MS;
  require.cache[realPath] = saved;
});
