/**
 * Combinado Familiar (producto 51, ramo 51): cuestionario y semáforo propios desde el panel
 * (product_config.healthQuestionsByRamo["51"] / healthScoringRulesByRamo["51"]), como Salud.
 * Los demás productos no cambian.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  catalogForProducto,
  questionsStoredForRamo,
  scoringRulesStoredForRamo,
} = require('../src/config/healthQuestionsByRamo');

const pregunta = { id: 'comb1', type: 'boolean', label: '¿Pregunta?', required: true, plans: ['*'] };
const reglas = { rangesEnabled: true, ranges: { emit: { min: 0, max: 29 } } };
const cfg = {
  healthQuestionsByRamo: { 51: [pregunta], 7: [] },
  healthScoringRulesByRamo: { 51: reglas },
};

test('producto 51 = Combinado Familiar, ramo 51, sin cuestionario de fábrica', () => {
  assert.deepEqual(catalogForProducto('51'), { kind: 'combinado', questions: [], cramo: 51 });
});

test('ramo 51: usa las preguntas y el semáforo guardados en el panel', () => {
  assert.deepEqual(questionsStoredForRamo(cfg, 51), [pregunta]);
  assert.deepEqual(scoringRulesStoredForRamo(cfg, 51), reglas);
  assert.equal(questionsStoredForRamo({}, 51), null);
});

test('los demás productos siguen igual (4 en 1 sin cuestionario, Salud 14 en ramo 7)', () => {
  assert.equal(catalogForProducto('77'), null);
  assert.equal(catalogForProducto('14').kind, 'salud');
  assert.equal(catalogForProducto('76').kind, 'vida');
  assert.equal(questionsStoredForRamo(cfg, 7), null);
});
