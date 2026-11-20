const test = require('node:test');
const assert = require('node:assert');
const { cpolizaTexto, buildTarjetaActivatePayload } = require('../src/services/tarjetaActivateAfterEmit');

test('cpolizaTexto conserva los 19 dígitos que llegan como texto', () => {
  assert.strictEqual(cpolizaTexto('1800000000000234032'), '1800000000000234032');
  assert.strictEqual(cpolizaTexto(' 1800000000000234032 '), '1800000000000234032');
});

test('cpolizaTexto descarta un number ya redondeado y valores inválidos', () => {
  assert.strictEqual(cpolizaTexto(1800000000000234032), '');
  for (const v of [null, undefined, '', '0', 0, -1, 'abc', '18000000000002340321']) {
    assert.strictEqual(cpolizaTexto(v), '', String(v));
  }
  assert.strictEqual(cpolizaTexto(123), '123');
});

test('el payload de activación lleva el cpoliza exacto de 19 dígitos', () => {
  const state = { metadataCanal: { xcodigo_unico: 'ABC123' }, fechaEmision: '2026-11-20' };
  const emission = { cnpoliza: '18-1-0000137942', fanopol: 2026, fmespol: 11, cpoliza: '1800000000000234032', casegurado: 27425335 };
  const payload = buildTarjetaActivatePayload(state, emission);
  assert.ok(payload && !payload._skip, JSON.stringify(payload));
  assert.strictEqual(payload.cpoliza, '1800000000000234032');
});
