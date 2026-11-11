/**
 * Si el registro del proveedor falla después de emitir, debe quedar alerta para mesa técnica
 * (pendiente post-emisión en JSONL) y no solo un console.warn.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proveedor-no-registrado-'));
process.env.POST_EMISION_DIR = tmpDir;
delete process.env.MONITOR_REPORT_ENABLED;

const test = require('node:test');
const assert = require('node:assert/strict');
const { listarPendientes } = require('../src/services/postEmisionPendiente');
const { _internal } = require('../src/routes/personas');

test('proveedor no registrado: deja pendiente con datos del proveedor y la póliza', async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    _internal.notificarProveedorNoRegistrado({
      req: { originalUrl: '/api/personas/emision' },
      state: { paymentVerified: true, tomador: { identificacion: 'V12345678' } },
      emitted: { cnpoliza: 'P-001', cnrecibo: 'R-001' },
      internalPolicyId: 'INT-1',
      proveedorError: { code: 'PROVEEDOR_REGISTRO_FALLIDO', message: 'timeout nest-api' },
      proveedorPayload: { cci_rif: 301234567, cclave_num: 105, itiposerv: 'MED', cplan: 'CF-01', cramo: 51 },
    });
  } finally {
    console.error = origError;
  }
  // appendFile es asíncrono.
  await new Promise((r) => setTimeout(r, 50));
  const [rec] = listarPendientes({});
  assert.ok(rec, 'se escribió el pendiente');
  assert.equal(rec.step, 'proveedor_no_registrado');
  assert.equal(rec.cnpoliza, 'P-001');
  assert.equal(rec.cnrecibo, 'R-001');
  assert.equal(rec.cci_rif, 301234567);
  assert.equal(rec.cclave_num, 105);
  assert.match(rec.error, /PROVEEDOR_REGISTRO_FALLIDO/);
});

test('proveedor no registrado: nunca lanza aunque falten datos', () => {
  const origError = console.error;
  console.error = () => {};
  try {
    assert.doesNotThrow(() => _internal.notificarProveedorNoRegistrado({
      proveedorError: { code: 'PROVEEDOR_DATOS_INCOMPLETOS', message: 'Faltan datos: tasa' },
    }));
  } finally {
    console.error = origError;
  }
});
