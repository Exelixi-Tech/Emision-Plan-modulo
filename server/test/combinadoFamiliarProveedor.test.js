const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePersonasCramo } = require('../src/lib/funerarioPlan');
const { buildRegisterPolicyProveedorRequest } = require('../src/services/personasMapper');

test('Combinado Familiar: resolvePersonasCramo resuelve ramo 51 correctamente', () => {
  // 1. Desde selectedPlan
  assert.equal(resolvePersonasCramo({ selectedPlan: { cramo: 51 } }), 51);

  // 2. Desde selectedProveedor
  assert.equal(resolvePersonasCramo({ selectedProveedor: { cramo: 51 } }), 51);

  // 3 y 4. Combinado Familiar siempre viaja con cproducto 51 (token SSO). Sin cproducto, la regla
  // de produccion asume funerario (57 -> 45) y no debe cambiar: ver personasRamoYRegistroProveedor.test.js.
  // 3. Desde bodyCramo
  assert.equal(resolvePersonasCramo({ bodyCramo: 51, cproducto: '51' }), 51);

  // 4. Desde metadataCanal cramo
  assert.equal(resolvePersonasCramo({ metadataCanal: { cramo: '51', cproducto: '51' } }), 51);

  // 5. Fallback Funerario 57 sigue retornando 45
  assert.equal(resolvePersonasCramo({ cproducto: '57' }), 45);
});

test('Combinado Familiar: buildRegisterPolicyProveedorRequest construye el payload con cnpoliza y datos del proveedor', () => {
  const state = {
    selectedPlan: { cplan: 'CF-01', cramo: 51 },
    selectedProveedor: {
      cci_rif: 'J-30123456-7',
      cclave_num: 105,
      itiposerv: 'MED',
      xproveedor: 'Clinica El Avila',
      cplan_proveedor: 'CF-01',
      cramo_proveedor: 51,
    },
    metadataCanal: {
      cusuario: '4',
      cproductor: '80080',
    },
    mprima: 1500,
    mprimaext: 45.5,
    ptasa: 36.5,
  };

  const emitted = {
    cnpoliza: 987654,
    cnrecibo: 12345,
  };

  const overrides = {
    fdesde: '2026-01-01',
    fhasta: '2027-01-01',
  };

  const req = buildRegisterPolicyProveedorRequest(state, emitted, overrides);

  assert.ok(req, 'Debe generar el payload');
  assert.equal(req.cpoliza, 987654, 'Debe tomar cnpoliza como cpoliza');
  assert.equal(req.cnpoliza, 987654);
  assert.equal(req.cramo, 51);
  assert.equal(req.cplan, 'CF-01');
  assert.equal(req.cci_rif, 301234567, 'Debe limpiar caracteres no numéricos del RIF');
  assert.equal(req.cclave_num, 105);
  assert.equal(req.itiposerv, 'MED');
  assert.equal(req.fdesde, '2026-01-01');
  assert.equal(req.fhasta, '2027-01-01');
  assert.equal(req.mcosto, 1500);
  assert.equal(req.mcostoext, 45.5);
  assert.equal(req.cmoneda, 'D');
});

test('Combinado Familiar: buildRegisterPolicyProveedorRequest funciona cuando el proveedor viene en state.cproveedor', () => {
  const state = {
    cplan_proveedor: 'CF-02',
    cramo_proveedor: 51,
    cproveedor: '12345678',
    cclave_num: 200,
    itiposerv: 'FUN',
  };

  const emitted = {
    cnpoliza: 555666,
  };

  const req = buildRegisterPolicyProveedorRequest(state, emitted);

  assert.ok(req);
  assert.equal(req.cpoliza, 555666);
  assert.equal(req.cci_rif, 12345678);
  assert.equal(req.cclave_num, 200);
  assert.equal(req.cplan, 'CF-02');
  assert.equal(req.cramo, 51);
});
