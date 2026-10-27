const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// axios no hace falta para estas funciones puras; evita instalar dependencias en CI local.
const load = Module._load;
Module._load = function stubAxios(request, ...rest) {
  if (request === 'axios') return { post: async () => ({}) };
  return load.call(this, request, ...rest);
};
const guard = require('../src/services/tarjetaFacturaGuard');
const { filesFromDocuments, pickFacturaLink } = require('../src/services/expedienteArchive');
const { buildTarjetaActivatePayload } = require('../src/services/tarjetaActivateAfterEmit');
Module._load = load;

const tarjeta = (extra = {}) => ({
  metadataCanal: { flujo: 'tarjeta', xcodigo_unico: 'ABC123', bfactura: 1, nfactura: '00162341', ...extra },
});

test('tarjeta con factura sin foto: no se emite', () => {
  const r = guard.rechazoSinFotoFactura(tarjeta());
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'TARJETA_FACTURA_FOTO');
});

test('tarjeta con foto en la metadata o en el wizard: se emite', () => {
  assert.equal(guard.rechazoSinFotoFactura(tarjeta({ xfoto_factura: '/files/empresa-7/_inbox/factura-x.webp' })), null);
  const conDoc = { ...tarjeta(), documents: { factura: { file: { url: '/files/empresa-7/1/pendiente/factura.webp' } } } };
  assert.equal(guard.rechazoSinFotoFactura(conDoc), null);
});

test('no aplica a autopago, tarjeta sin factura ni flujo normal', () => {
  assert.equal(guard.rechazoSinFotoFactura(tarjeta({ autopago: true, autopago_token: 'x'.repeat(20) })), null);
  assert.equal(guard.rechazoSinFotoFactura(tarjeta({ bfactura: 0 })), null);
  assert.equal(guard.rechazoSinFotoFactura({ metadataCanal: {} }), null);
  assert.equal(guard.rechazoSinFotoFactura({}), null);
});

test('archivar incluye la factura de _inbox desde la metadata', () => {
  const files = filesFromDocuments({}, { xfoto_factura: '/files/empresa-7/_inbox/factura-x.webp' });
  assert.deepEqual(files, [{ url: '/files/empresa-7/_inbox/factura-x.webp', docType: 'factura' }]);
  const conDoc = filesFromDocuments(
    { factura: { file: { url: '/files/a/factura.webp' } } },
    { xfoto_factura: '/files/b/factura.webp' },
  );
  assert.equal(conDoc.filter((f) => f.docType === 'factura').length, 1);
});

test('alerta y marca metadata si el expediente quedó sin factura', () => {
  const metadata = {};
  const errores = [];
  const orig = console.error;
  console.error = (m) => errores.push(m);
  try {
    guard.alertarSiFaltaFactura(tarjeta(), { cnpoliza: '45-1-1' }, undefined, metadata);
    guard.alertarSiFaltaFactura(tarjeta(), { cnpoliza: '45-1-2' }, 'https://x/factura.webp', {});
  } finally {
    console.error = orig;
  }
  assert.equal(metadata.tarjetaFacturaFaltante, true);
  assert.equal(errores.length, 1);
  assert.match(errores[0], /ALERTA sin factura archivada cnpoliza=45-1-1/);
});

test('activate solo manda link absoluto de la factura', () => {
  const state = tarjeta({ cpoliza: 9, casegurado: 7, xfoto_factura: '/files/empresa-7/_inbox/factura-x.webp' });
  const emision = { cnpoliza: '18-1-1', fanopol: 2026, fmespol: 10 };
  assert.equal(buildTarjetaActivatePayload(state, emision, {}).xfoto_factura, undefined);
  const link = pickFacturaLink({ archivos: { 'factura.webp': 'https://nexusqa.exelixitech.com/ocr/files/a/factura.webp' } });
  assert.equal(buildTarjetaActivatePayload(state, emision, { xfotoFactura: link }).xfoto_factura, link);
});
