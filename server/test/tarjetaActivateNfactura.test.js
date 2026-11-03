/**
 * cards/activate: con factura el payload no cambia; sin factura nfactura = referencia del pago
 * (tafactura.nfactura es NOT NULL), como hace ventacards de La Mundial.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTarjetaActivatePayload } = require('../src/services/tarjetaActivateAfterEmit');

const emission = {
  cnpoliza: '48-1-1100016164', fanopol: 2026, fmespol: 11, cpoliza: 123, casegurado: 456,
};
const state = (meta = {}, extra = {}) => ({
  metadataCanal: { flujo: 'tarjeta', xcodigo_unico: 'ABC123', ctarjeta: '77', ...meta },
  fechaEmision: '2026-11-03',
  ...extra,
});

test('con factura: nfactura de la factura, sin ctarjeta/xfactura extra', () => {
  const p = buildTarjetaActivatePayload(
    state({ nfactura: 'F-000123' }, { paymentCapture: { reference: '999' } }),
    emission,
  );
  assert.equal(p.nfactura, '000123');
  assert.equal(p.ctarjeta, undefined);
  assert.equal(p.xfactura, undefined);
});

test('sin factura: nfactura = referencia del pago, más ctarjeta y xfactura', () => {
  const p = buildTarjetaActivatePayload(
    state({}, { paymentCapture: { reference: ' 0012345678 ' } }),
    emission,
  );
  assert.equal(p.nfactura, '0012345678');
  assert.equal(p.ctarjeta, '77');
  assert.equal(p.xfactura, 'TAR-77');
});

test('sin factura: referencia alfanumérica se conserva (no se destroza)', () => {
  const p = buildTarjetaActivatePayload(
    state({}, { paymentCapture: { transactionId: 'AB12CD34' } }),
    emission,
  );
  assert.equal(p.nfactura, 'AB12CD34');
});

test('sin factura ni referencia: cnpoliza sin guiones', () => {
  const p = buildTarjetaActivatePayload(state(), emission);
  assert.equal(p.nfactura, '4811100016164');
});
