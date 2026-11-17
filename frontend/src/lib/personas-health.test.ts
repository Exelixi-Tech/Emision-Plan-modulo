/**
 * Plan Proveedor / Combinado Familiar (51): cuestionario de salud solo si el producto tiene preguntas.
 * Correr con: node --test src/lib/personas-health.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  insuredKey,
  mapHealthToFuneral,
  planConProveedor,
  proveedorHealthPatch,
  proveedorQuestionnaireRequest,
} from './personas-health.ts';

const plan = { cplan: 'CF01', name: 'Plan CF', price: '', priceNum: 0, tag: '', desc: '', benefits: [], sumaAsegurada: 0 };

test('sin preguntas: el cuestionario queda resuelto (comportamiento de siempre)', () => {
  const p = proveedorHealthPatch(false);
  assert.equal(p.healthQuestionnaireDone, true);
  assert.deepEqual(p.healthAnswers, {});
  assert.equal(p.diagnosticoEnfermedad, false);
  assert.equal('aceptaTerminos' in p, false, 'los términos los da la casilla del proveedor');
});

test('con preguntas: queda pendiente y se limpian respuestas previas', () => {
  const p = proveedorHealthPatch(true);
  assert.equal(p.healthQuestionnaireDone, false);
  assert.deepEqual(p.healthAnswersByInsured, {});
});

test('las preguntas se piden por el producto del SSO (51 → ramo 51 en el servidor)', () => {
  assert.deepEqual(
    proveedorQuestionnaireRequest({ cproducto: 51, cramo: 51 }, { cramo: 51 }),
    { cproducto: '51', cramo: 51 },
  );
  // Sin SSO: el del producto o 51.
  assert.deepEqual(proveedorQuestionnaireRequest(null, { cramo: 51 }), { cproducto: '51', cramo: 51 });
  assert.deepEqual(
    proveedorQuestionnaireRequest({}, { cproducto: '51', cramo: 51 }),
    { cproducto: '51', cramo: 51 },
  );
});

test('respuestas del cuestionario → store como personas', () => {
  const key = insuredKey({ tipoDoc: 'V', identificacion: '12.345.678' }, 0);
  assert.equal(key, 'V-12345678');
  const out = mapHealthToFuneral({ [key]: { diagnosticoEnfermedad: true, descripcionEnfermedad: 'asma' } }, []);
  assert.equal(out.healthQuestionnaireDone, true);
  assert.equal(out.diagnosticoEnfermedad, true);
  assert.equal(out.descripcionEnfermedad, 'asma');
  assert.equal(out.aceptaTerminos, true);
});

test('el plan enviado a la solicitud lleva el proveedor y el cproducto', () => {
  const prov = { cci_rif: 'J123', cclave_num: 7, itiposerv: 'S', cplan: 'P1', cramo: 51, xproveedor: 'Clínica' };
  const out = planConProveedor(plan, prov, '51');
  assert.equal(out.cproducto, '51');
  assert.deepEqual(out.proveedor, prov);
  assert.notEqual(out.proveedor, prov, 'copia, no referencia');
  assert.equal('proveedor' in planConProveedor(plan, null, '51'), false);
});
