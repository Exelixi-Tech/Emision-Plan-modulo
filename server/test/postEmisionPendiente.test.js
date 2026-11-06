/**
 * Registro de post-emisión pendiente (helpers puros + escritura/lectura en carpeta temporal).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-emision-'));
process.env.POST_EMISION_DIR = tmpDir;

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  maskDocument,
  resolvePaymentInfo,
  buildRecord,
  parseLines,
  filterDesde,
  fileNameFor,
  registrarPendiente,
  listarPendientes,
  getDir,
  REINTENTO_FLAG,
} = require('../src/services/postEmisionPendiente');

const stateRcv = {
  paymentVerified: true,
  paymentSid: 'SID-123',
  paymentCapture: { reference: '00123456', amount: 1234.5 },
  tomador: { identificacion: 'V12345678', nombre: 'Prueba' },
  vehicle: { placa: 'ab123cd' },
};

test('maskDocument: oculta todo menos los últimos 3 dígitos', () => {
  assert.equal(maskDocument('V12345678'), 'V*****678');
  assert.equal(maskDocument('12345678'), '*****678');
  assert.equal(maskDocument('V-12.345.678'), 'V*****678');
  assert.equal(maskDocument('12'), '**');
  assert.equal(maskDocument(''), null);
  assert.equal(maskDocument(null), null);
});

test('resolvePaymentInfo: toma referencia, monto y sid del wizardState', () => {
  assert.deepEqual(resolvePaymentInfo(stateRcv), {
    paymentVerified: true,
    paymentReference: '00123456',
    paymentAmount: 1234.5,
    sid: 'SID-123',
  });
  assert.deepEqual(resolvePaymentInfo({}), {
    paymentVerified: false,
    paymentReference: null,
    paymentAmount: null,
    sid: null,
  });
  assert.equal(resolvePaymentInfo({ checkoutPayload: { paymentSid: 'S9' } }).sid, 'S9');
});

test('buildRecord: registro completo RCV sin datos personales en claro', () => {
  const now = new Date('2026-11-01T10:00:00.000Z');
  const rec = buildRecord({
    flujo: 'rcv',
    step: 'cobro_error',
    error: new Error('nest-api 500'),
    state: stateRcv,
    internalPolicyId: 'INT-1',
    cnpoliza: 'POL-1',
    cnrecibo: 'REC-1',
    extra: { code: 'X', omitido: undefined },
    now,
  });
  assert.deepEqual(rec, {
    timestamp: '2026-11-01T10:00:00.000Z',
    flujo: 'rcv',
    step: 'cobro_error',
    internalPolicyId: 'INT-1',
    sid: 'SID-123',
    cnpoliza: 'POL-1',
    cnrecibo: 'REC-1',
    paymentVerified: true,
    paymentReference: '00123456',
    paymentAmount: 1234.5,
    documento: 'V*****678',
    error: 'nest-api 500',
    placa: 'AB123CD',
    code: 'X',
  });
  assert.ok(!JSON.stringify(rec).includes('12345678'), 'la cédula no debe ir en claro');
  assert.ok(!JSON.stringify(rec).includes('Prueba'), 'el nombre no se registra');
});

test('buildRecord: personas no lleva placa y trunca errores largos', () => {
  const rec = buildRecord({ flujo: 'personas', step: 'emit_timeout', error: 'x'.repeat(600), state: {} });
  assert.equal('placa' in rec, false);
  assert.equal(rec.error.length, 501);
  assert.equal(rec.paymentVerified, false);
});

test('parseLines/filterDesde: tolera líneas corruptas y filtra por fecha', () => {
  const text = '{"timestamp":"2026-10-30T01:00:00Z","a":1}\nbasura\n\n{"timestamp":"2026-11-01T01:00:00Z","a":2}\n';
  const recs = parseLines(text);
  assert.equal(recs.length, 2);
  assert.deepEqual(filterDesde(recs, '2026-11-01').map((r) => r.a), [2]);
  assert.equal(filterDesde(recs, 'no-fecha').length, 2);
  assert.equal(fileNameFor('2026-11-01T01:00:00Z'), 'pendientes-2026-11-01.jsonl');
});

test('registrarPendiente/listarPendientes: escribe JSONL en POST_EMISION_DIR y lista desde fecha', async () => {
  assert.equal(getDir(), tmpDir);
  const origError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const r1 = registrarPendiente({ flujo: 'rcv', step: 'emit_timeout', error: 'timeout', state: stateRcv, now: new Date('2026-10-31T23:00:00Z') });
    const r2 = registrarPendiente({ flujo: 'personas', step: 'validar_vigente_409', error: 'póliza vigente', state: {}, now: new Date('2026-11-01T08:00:00Z') });
    assert.ok(r1 && r2);
  } finally {
    console.error = origError;
  }
  assert.ok(logged.every((l) => l.startsWith('[post-emision-pendiente] ')), 'tag fijo para grep');

  // appendFile es asíncrono: esperar a que estén en disco.
  await new Promise((r) => setTimeout(r, 100));
  const files = fs.readdirSync(tmpDir).sort();
  assert.deepEqual(files, ['pendientes-2026-10-31.jsonl', 'pendientes-2026-11-01.jsonl']);

  const todos = listarPendientes();
  assert.equal(todos.length, 2);
  assert.equal(todos[0].step, 'validar_vigente_409', 'más reciente primero');

  const desde = listarPendientes({ desde: '2026-11-01' });
  assert.deepEqual(desde.map((r) => r.flujo), ['personas']);
  assert.equal(listarPendientes({ limite: 1 }).length, 1);
});

test('registrarPendiente: nunca lanza aunque el input sea inválido', () => {
  const origError = console.error;
  console.error = () => {};
  try {
    assert.doesNotThrow(() => registrarPendiente(null));
    assert.doesNotThrow(() => registrarPendiente({ state: 'no-objeto' }));
  } finally {
    console.error = origError;
  }
});

test('listarPendientes: carpeta inexistente devuelve lista vacía', () => {
  process.env.POST_EMISION_DIR = path.join(tmpDir, 'no-existe');
  try {
    assert.deepEqual(listarPendientes(), []);
  } finally {
    process.env.POST_EMISION_DIR = tmpDir;
  }
});

test('expone el nombre de la flag de reintento (fase 2 en postEmisionReintento.js)', () => {
  assert.equal(REINTENTO_FLAG, 'POST_EMISION_REINTENTO');
});
