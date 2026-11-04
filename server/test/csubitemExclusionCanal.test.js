const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCsubitemForExclusion } = require('../src/services/planesClient');

test('canal: el subcanal no reemplaza al canal (55 de GLJM-LMDS no es LOTTI PLAY, canal 55)', () => {
  const meta = { centidad: 'C', citem: '54', cscanalalt_in: 55 };
  assert.equal(resolveCsubitemForExclusion(meta), '54');
});

test('canal sin subcanal: usa el canal', () => {
  assert.equal(resolveCsubitemForExclusion({ centidad: 'C', citem: '188' }), '188');
});

test('canal con gestor de 3 dígitos: sigue compuesto', () => {
  assert.equal(resolveCsubitemForExclusion({ centidad: 'C', citem: '27', csubitem: '252' }), '27-252');
});

test('entidad G y sin entidad: sin exclusión', () => {
  assert.equal(resolveCsubitemForExclusion({ centidad: 'G', citem: '348' }), null);
  assert.equal(resolveCsubitemForExclusion({}), null);
});
