/**
 * Permiso para elegir productor (lib/nexusMetadata.puedeElegirProductor).
 * La tabla reproduce la regla de qa: solo marketplace con 80080 y backoffice interno
 * (no productor, con productor de sesión genérico). Todo lo demás se niega.
 */
process.env.CROL_PRODUCTOR = '3,7';

const test = require('node:test');
const assert = require('node:assert/strict');
const { puedeElegirProductor, withNexusMetadata } = require('../src/lib/nexusMetadata');

const tabla = [
  ['marketplace, token 80080', { origen: 'marketplace', cproductor: '80080' }, true],
  ['marketplace, token productor 1234', { origen: 'marketplace', cproductor: '1234' }, false],
  ['marketplace, sin productor', { origen: 'marketplace' }, false],
  ['backoffice interno (crol 1), 80080', { origen: 'backoffice', cproductor: '80080', crol: 1 }, true],
  ['backoffice interno (crol 1), sin productor', { origen: 'backoffice', crol: 1 }, true],
  ['backoffice rol productor (crol 3), 80080', { origen: 'backoffice', cproductor: '80080', crol: 3 }, false],
  ['backoffice con productor 1234, crol 1', { origen: 'backoffice', cproductor: '1234', crol: 1 }, false],
  ['backoffice con productor 1234, crol 3', { origen: 'backoffice', cproductor: '1234', crol: 3 }, false],
  ['sin origen, token 80080', { cproductor: '80080' }, false],
  ['sin origen, sin productor', {}, false],
  ['sin origen, productor 1234', { cproductor: '1234' }, false],
  ['origen desconocido, 80080', { origen: 'otro', cproductor: '80080' }, false],
  ['origen desconocido, productor 1234', { origen: 'otro', cproductor: '1234' }, false],
  ['tarjeta/canal sin rol, 80080', { origen: 'tarjeta', cproductor: '80080' }, false],
];

for (const [nombre, meta, esperado] of tabla) {
  test(`puedeElegirProductor: ${nombre} -> ${esperado}`, () => {
    assert.equal(puedeElegirProductor(meta), esperado);
  });
}

test('patrimonial withNexusMetadata: usuario con permiso emite con el productor elegido', () => {
  const out = withNexusMetadata(
    { metadataCanal: { productorSeleccionado: true, cproductor: '555' } },
    { origen: 'backoffice', crol: 1, cproductor: '80080' },
  );
  assert.equal(out.metadataCanal.cproductor, '555');
  assert.equal(out.metadataCanal.centidad, 'P');
  assert.equal(out.metadataCanal.citem, '555');
});

test('patrimonial withNexusMetadata: productor sin permiso no puede imponer otro productor', () => {
  const out = withNexusMetadata(
    { metadataCanal: { productorSeleccionado: true, cproductor: '999', centidad: 'P', citem: '999' } },
    { origen: 'backoffice', crol: 3, cproductor: '1234', centidad: 'P', citem: '1234' },
  );
  assert.equal(out.metadataCanal.cproductor, '1234');
  assert.equal(out.metadataCanal.citem, '1234');
});

test('patrimonial withNexusMetadata: sin permiso y sin productor en el token, el cliente no inyecta actor', () => {
  const out = withNexusMetadata(
    { metadataCanal: { cproductor: '999', centidad: 'P', citem: '999' } },
    { origen: 'marketplace' },
  );
  assert.equal(out.metadataCanal.cproductor, undefined);
  assert.equal(out.metadataCanal.centidad, undefined);
  assert.equal(out.metadataCanal.citem, undefined);
});
