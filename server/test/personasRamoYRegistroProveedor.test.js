/**
 * 1) resolvePersonasCramo debe dar el MISMO ramo que main para los productos en produccion
 *    (funerario, vida, AP...). Los valores esperados se obtuvieron ejecutando la version de main.
 * 2) El registro del proveedor (adproveedor) toma los montos de la cotizacion real y no se escribe
 *    si falta algun dato (nunca ceros ni valores por defecto).
 */
delete process.env.LAMUNDIAL_PRODUCTO_FUNERARIO;
delete process.env.LAMUNDIAL_RAMO_PERSON;

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePersonasCramo } = require('../src/lib/funerarioPlan');
const { buildRegisterPolicyProveedorRequest, faltantesRegistroProveedor } = require('../src/services/personasMapper');

// [caso, opts, ramo esperado (= main)]
const RAMO_MAIN = [
  ['Funerario 57, plan con cramo 9', { selectedPlan: { cramo: 9 }, metadataCanal: { cproducto: '57', cramo: 9 } }, 9],
  ['Funerario 57, plan sin cramo, token cramo 9', { selectedPlan: {}, metadataCanal: { cproducto: '57', cramo: 9 } }, 45],
  ['Funerario 57 sin cramo en ningun lado', { metadataCanal: { cproducto: '57' } }, 45],
  ['Vida 76, token cramo 1', { metadataCanal: { cproducto: '76', cramo: 1 } }, 1],
  ['AP 78, token cramo 5', { metadataCanal: { cproducto: '78', cramo: 5 } }, 5],
  ['Otro producto del ramo 9 (58), token cramo 9', { metadataCanal: { cproducto: '58', cramo: 9 } }, 9],
  ['Token sin cproducto, cramo 1', { metadataCanal: { cramo: 1 } }, 45],
  ['Token sin cproducto, cramo 9', { metadataCanal: { cramo: 9 } }, 45],
  ['Token sin cproducto ni cramo', { metadataCanal: {} }, 45],
  ['Combinado familiar 51, cramo 51', { metadataCanal: { cproducto: '51', cramo: 51 } }, 51],
  ['/cotizacion: body.cramo 9 como plan y bodyCramo, producto 57', { selectedPlan: { cramo: 9 }, bodyCramo: 9, cproducto: '57', metadataCanal: { cproducto: '57' } }, 9],
  ['bodyCramo 9 sin plan, producto 57', { bodyCramo: 9, cproducto: '57', metadataCanal: { cproducto: '57' } }, 45],
];

for (const [nombre, opts, esperado] of RAMO_MAIN) {
  test(`ramo igual a main: ${nombre} -> ${esperado}`, () => {
    assert.equal(resolvePersonasCramo(JSON.parse(JSON.stringify(opts))), esperado);
  });
}

test('Combinado Familiar: el ramo del proveedor se usa solo cuando hay proveedor', () => {
  assert.equal(resolvePersonasCramo({ selectedProveedor: { cramo: 51 }, metadataCanal: { cproducto: '51' } }), 51);
  // el plan sigue mandando sobre el proveedor
  assert.equal(resolvePersonasCramo({ selectedPlan: { cramo: 51 }, selectedProveedor: { cramo: 28 } }), 51);
});

// State con la forma real que envia Pagos: los montos van en `quote`, no en la raiz.
const stateReal = () => ({
  selectedPlan: { cplan: 'COMBF2', cramo: 51 },
  metadataCanal: { cusuario: '1422', cproducto: '51' },
  quote: { mprima: 225640.98, mprimaext: 258.95, ptasa: 871.3689 },
  selectedProveedor: { cci_rif: 'J-30123456-7', cclave_num: 105, itiposerv: 'MED', cplan: 'COMBF2', cramo: 51 },
});
const emitida = { cnpoliza: '51-1-1100016030', cpoliza: 1100016030 };

test('registro: con el state real toma los montos de quote (no escribe ceros)', () => {
  const p = buildRegisterPolicyProveedorRequest(stateReal(), emitida, { plan: 'COMBF2' });
  assert.equal(p.mcosto, 225640.98);
  assert.equal(p.mcostoext, 258.95);
  assert.equal(p.ptasamon, 871.3689);
  assert.deepEqual(faltantesRegistroProveedor(p), []);
});

test('registro: la cotizacion de la emision tiene prioridad sobre la del state', () => {
  const p = buildRegisterPolicyProveedorRequest(stateReal(), emitida, {
    plan: 'COMBF2',
    cotizacion: { mprima: 300000, mprimaext: 300, ptasa: 1000 },
  });
  assert.equal(p.mcosto, 300000);
  assert.equal(p.mcostoext, 300);
  assert.equal(p.ptasamon, 1000);
});

test('registro: sin montos ni clave ni tipo de servicio NO se registra', () => {
  const s = stateReal();
  delete s.quote;
  delete s.selectedProveedor.cclave_num;
  delete s.selectedProveedor.itiposerv;
  const p = buildRegisterPolicyProveedorRequest(s, emitida, { plan: 'COMBF2' });
  const faltan = faltantesRegistroProveedor(p);
  for (const f of ['clave del proveedor', 'tipo de servicio', 'prima', 'tasa']) {
    assert.ok(faltan.includes(f), `deberia faltar: ${f}`);
  }
});

test('registro: sin usuario no se registra', () => {
  const s = stateReal();
  s.metadataCanal = { cproducto: '51' };
  const p = buildRegisterPolicyProveedorRequest(s, emitida, { plan: 'COMBF2' });
  assert.ok(faltantesRegistroProveedor(p).includes('usuario (cusuario)'));
});
