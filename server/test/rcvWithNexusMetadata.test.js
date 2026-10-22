/**
 * RCV (/api/policies/*): la fusión de metadata SSO debe comportarse EXACTAMENTE como en qa.
 * Los valores esperados (fixtures/rcvWithNexusMetadata.qa.json) se generaron ejecutando la
 * versión de qa; si este test falla, el cambio altera la emisión RCV o el flujo tarjeta.
 */
process.env.CROL_PRODUCTOR = '3,7';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withNexusMetadata } = require('../src/routes/emision');
const casos = require('./fixtures/rcvWithNexusMetadata.qa.json');

for (const [nombre, { input, expected }] of Object.entries(casos)) {
  test(`RCV withNexusMetadata igual a qa: ${nombre}`, () => {
    const state = JSON.parse(JSON.stringify(input.state));
    assert.deepEqual(withNexusMetadata(state, input.nexusMetadata), expected);
  });
}

test('RCV tarjeta: el canal del lote manda sobre el token y el selector', () => {
  const out = withNexusMetadata(
    { vehicle: {}, metadataCanal: { flujo: 'tarjeta', centidad: 'C', citem: '55', productorSeleccionado: true, cramo: 99 } },
    { origen: 'backoffice', cproductor: '1234', centidad: 'P', citem: '1234', crol: 3 },
  );
  assert.equal(out.metadataCanal.centidad, 'C');
  assert.equal(out.metadataCanal.citem, '55');
  assert.equal(out.metadataCanal.cproductor, undefined);
  assert.equal(out.metadataCanal.productorSeleccionado, undefined);
  assert.equal(out.metadataCanal.cramo, undefined);
});
