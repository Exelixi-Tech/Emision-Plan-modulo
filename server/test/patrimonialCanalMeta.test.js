/**
 * Patrimonial: canal (cproductor/centidad/citem) con el que se listan planes, se cotiza y se emite.
 * Debe ser el mismo productor en los tres pasos, y un productor sin permiso no puede cambiarlo.
 */
process.env.CROL_PRODUCTOR = '3,7';
delete process.env.LAMUNDIAL_RAMO_PATRIMONIAL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { patrimonialCanalMeta } = require('../src/routes/patrimonial');
const patrimonialClient = require('../src/services/patrimonialClient');

const interno = { origen: 'backoffice', crol: 1, cproductor: '80080' };
const productor = { origen: 'backoffice', crol: 3, cproductor: '1234', centidad: 'P', citem: '1234' };
const seleccion = { cproductor: '555', centidad: 'P', citem: '555' };
const actor = (m) => ({ cproductor: m.cproductor, centidad: m.centidad, citem: m.citem });

test('interno elige 555: GET /planes (selección por query) usa 555', () => {
  const m = patrimonialCanalMeta({ nexusMetadata: interno, query: { ...seleccion }, body: undefined });
  assert.deepEqual(actor(m), { cproductor: '555', centidad: 'P', citem: '555' });
});

test('interno elige 555: POST /cotizacion (selección en body) usa 555', () => {
  const m = patrimonialCanalMeta({ nexusMetadata: interno, query: {}, body: { cplan: 'X', ...seleccion } });
  assert.deepEqual(actor(m), { cproductor: '555', centidad: 'P', citem: '555' });
});

test('interno elige 555: POST /emision (state.metadataCanal) usa 555', () => {
  const m = patrimonialCanalMeta({
    nexusMetadata: interno,
    query: {},
    body: { state: { metadataCanal: { ...seleccion, productorSeleccionado: true } } },
  });
  assert.deepEqual(actor(m), { cproductor: '555', centidad: 'P', citem: '555' });
});

test('productor sin permiso: body.citem de otro productor se ignora', () => {
  const m = patrimonialCanalMeta({ nexusMetadata: productor, query: {}, body: { cplan: 'X', citem: '999', centidad: 'P' } });
  assert.deepEqual(actor(m), { cproductor: '1234', centidad: 'P', citem: '1234' });
});

test('productor sin permiso: query de otro productor se ignora en GET /planes', () => {
  const m = patrimonialCanalMeta({ nexusMetadata: productor, query: { cproductor: '999', citem: '999', centidad: 'P' }, body: undefined });
  assert.deepEqual(actor(m), { cproductor: '1234', centidad: 'P', citem: '1234' });
});

test('productor sin permiso: cproductor en body con productorSeleccionado se ignora', () => {
  const m = patrimonialCanalMeta({
    nexusMetadata: productor,
    query: {},
    body: { cproductor: '999', state: { metadataCanal: { productorSeleccionado: true, cproductor: '999' } } },
  });
  assert.deepEqual(actor(m), { cproductor: '1234', centidad: 'P', citem: '1234' });
});

test('ramo: el del JWT manda sobre el del body', () => {
  const m = patrimonialCanalMeta({ nexusMetadata: { ...interno, cramo: '28' }, query: {}, body: { cramo: 20 } });
  assert.equal(m.cramo, 28);
});

test('ramo patrimonial por defecto es 28 (LAMUNDIAL_RAMO_PATRIMONIAL sin definir)', () => {
  assert.equal(patrimonialClient.DEFAULT_RAMO, 28);
});
