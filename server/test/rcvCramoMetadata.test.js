/**
 * Ramo de la emisión RCV cuando el token del canal trae el ramo de otro producto.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { _internal: { resolveRcvCramo } } = require('../src/services/policyMapper');

const moto = { placa: 'AV9A16D', tipoPlaca: 'nacional' };

test('metadata de funerario (cramo 9) no cambia el ramo RCV: va al 18', () => {
  assert.equal(resolveRcvCramo(moto, { cramo: 9, product: 'funerario' }), 18);
});

test('cramo 18 de la metadata se respeta; sin cramo, 18', () => {
  assert.equal(resolveRcvCramo(moto, { cramo: '18' }), 18);
  assert.equal(resolveRcvCramo(moto, {}), 18);
});
