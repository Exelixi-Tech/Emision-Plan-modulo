/**
 * Payload que se envía a Nest (/partner/starter/patrimonial/quote) al cotizar y al emitir.
 * Sin productor elegido debe ser el mismo de siempre (sin cproductor/centidad/citem), para no
 * depender de que el DTO de Nest acepte esos campos. Con productor elegido y autorizado, se envían.
 * El cliente de Nest se reemplaza por un doble: no hay llamadas de red.
 */
process.env.CROL_PRODUCTOR = '3,7';

const test = require('node:test');
const assert = require('node:assert/strict');
const patrimonialClient = require('../src/services/patrimonialClient');
const { handleQuote, handleEmit } = require('../src/routes/patrimonial');

const CANAL = ['cproductor', 'centidad', 'citem'];
const interno = { origen: 'backoffice', crol: 1, cproductor: '80080' };
const productor = { origen: 'backoffice', crol: 3, cproductor: '1234', centidad: 'P', citem: '1234' };

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

/** Ejecuta fn con quoteGeneralRisks reemplazado y devuelve los argumentos con que se llamó. */
async function capturarCotizacion(fn) {
  const original = patrimonialClient.quoteGeneralRisks;
  let args = null;
  patrimonialClient.quoteGeneralRisks = async (a) => {
    args = a;
    const err = new Error('stub: detener tras capturar la cotizacion');
    err.httpStatus = 599;
    throw err;
  };
  try {
    await fn();
  } finally {
    patrimonialClient.quoteGeneralRisks = original;
  }
  return args;
}

const tieneCanal = (args) => CANAL.some((k) => k in args);

test('cotizar sin seleccion (usuario productor): payload sin campos de canal', async () => {
  const args = await capturarCotizacion(() => handleQuote(
    { nexusMetadata: productor, query: {}, body: { cplan: 'PAT1', cramo: 28 } },
    fakeRes(),
  ));
  assert.ok(args, 'debio cotizar');
  assert.equal(tieneCanal(args), false);
  assert.deepEqual(Object.keys(args).sort(), ['cplan', 'cramo', 'cuotas', 'ifrecuencia', 'pdescuento', 'precargo', 'ptasamon'].sort());
});

test('cotizar: productor sin permiso que manda otro productor no altera el payload', async () => {
  const args = await capturarCotizacion(() => handleQuote(
    { nexusMetadata: productor, query: {}, body: { cplan: 'PAT1', cproductor: '999', centidad: 'P', citem: '999' } },
    fakeRes(),
  ));
  assert.equal(tieneCanal(args), false);
});

test('cotizar con productor elegido por usuario interno: envia el canal elegido', async () => {
  const args = await capturarCotizacion(() => handleQuote(
    { nexusMetadata: interno, query: {}, body: { cplan: 'PAT1', cproductor: '555', centidad: 'P', citem: '555' } },
    fakeRes(),
  ));
  assert.equal(args.cproductor, '555');
  assert.equal(args.centidad, 'P');
  assert.equal(args.citem, '555');
});

const stateBase = (metadataCanal) => ({
  tomador: { tipoDoc: 'V', identificacion: '123' },
  selectedPlan: { cplan: 'PAT1' },
  metadataCanal,
});

test('emitir sin seleccion: la cotizacion previa no lleva campos de canal', async () => {
  const args = await capturarCotizacion(() => handleEmit(
    { nexusMetadata: productor, query: {}, body: { state: stateBase({}) } },
    fakeRes(),
  ));
  assert.ok(args, 'debio cotizar antes de emitir');
  assert.equal(tieneCanal(args), false);
});

test('emitir con productor elegido por usuario interno: la cotizacion lleva el canal elegido', async () => {
  const args = await capturarCotizacion(() => handleEmit(
    { nexusMetadata: interno, query: {}, body: { state: stateBase({ productorSeleccionado: true, cproductor: '555' }) } },
    fakeRes(),
  ));
  assert.equal(args.cproductor, '555');
  assert.equal(args.centidad, 'P');
  assert.equal(args.citem, '555');
});

test('emitir: productor sin permiso con productorSeleccionado no envia otro canal', async () => {
  const args = await capturarCotizacion(() => handleEmit(
    { nexusMetadata: productor, query: {}, body: { state: stateBase({ productorSeleccionado: true, cproductor: '999' }) } },
    fakeRes(),
  ));
  assert.equal(tieneCanal(args), false);
});
