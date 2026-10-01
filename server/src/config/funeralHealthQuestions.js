/**
 * Catálogo de preguntas de salud para funerario — gestionado por Exélixi.
 *
 * Mapeo confirmado desde BD Sis2000 (ramo 9, planes individuales):
 *   cplan "2" → 1.000$ Funerario Individual
 *   cplan "3" → 1.500$ Funerario Individual
 *   cplan "4" → 2.000$ Funerario Individual
 *   cplan "5" → 2.500$ Funerario Individual
 *   cplan "6" → 3.000$ Funerario Individual
 *   cplan "7" → 4.000$ Funerario Individual
 *   cplan "8" → 5.000$ Funerario Individual
 *   cplan "9" → 7.500$ Individual
 *
 * Los cplan llegan como string desde la API (ej. cotización log: cplan "4", "6", "7", "8").
 *
 * `plans`: lista de cplan (string) o ['*'] para todos.
 * `showIf`: pregunta condicional según otra respuesta.
 */

/** Planes funerarios individuales — ramo 9 */
const PLAN = {
  P1000: '2',
  P1500: '3',
  P2000: '4',
  P2500: '5',
  P3000: '6',
  P4000: '7',
  P5000: '8',
  P7500: '9',
  ALL: '*',
};

/** Tiers de cobertura para agrupar preguntas */
const TIER = {
  /** 1.000$ – 2.000$ (cplan 2, 3, 4) */
  ENTRADA: [PLAN.P1000, PLAN.P1500, PLAN.P2000],
  /** 2.500$ – 3.000$ (cplan 5, 6) */
  INTERMEDIO: [PLAN.P2500, PLAN.P3000],
  /** 4.000$ – 7.500$ (cplan 7, 8, 9) */
  ALTO: [PLAN.P4000, PLAN.P5000, PLAN.P7500],
  /** Todos los planes individuales activos */
  TODOS: [
    PLAN.P1000, PLAN.P1500, PLAN.P2000,
    PLAN.P2500, PLAN.P3000,
    PLAN.P4000, PLAN.P5000, PLAN.P7500,
  ],
};

/** @typedef {'boolean' | 'text' | 'select' | 'multi_select'} HealthQuestionType */

/**
 * @typedef {Object} HealthQuestion
 * @property {string} id
 * @property {HealthQuestionType} type
 * @property {string} label
 * @property {string} [description]
 * @property {boolean} [required]
 * @property {string[]} plans
 * @property {{ field: string, equals: boolean | string }} [showIf]
 * @property {{ value: string, label: string }[]} [options]
 * @property {number} [scoreIfTrue]
 * @property {number} [scoreIfFalse]
 * @property {number} [scoreIfFilled]
 * @property {Record<string, number>} [optionScores]
 * @property {Record<string, 'reject'|'refer'|'score'>} [optionActions]
 * @property {boolean} [blockIfTrue]
 * @property {boolean} [blockIfFalse]
 * @property {string} [blockReason]
 */

const { SIS2000_V4_CATALOG } = require('./funeralHealthQuestions.sis2000-v4');

/** @type {HealthQuestion[]} */
const CATALOG = SIS2000_V4_CATALOG;

/**
 * @param {unknown} q
 * @returns {boolean}
 */
function isQuestionEnabled(q) {
  if (!q || typeof q !== 'object') return false;
  const v = q.enabled;
  if (v === false || v === 0) return false;
  if (typeof v === 'string' && /^(false|0|off|no|hidden)$/i.test(v.trim())) return false;
  return true;
}

/**
 * Si General tiene una pregunta Off, el canal del SSO no debe mostrarla.
 * @param {HealthQuestion[]} questions
 * @param {HealthQuestion[]|null|undefined} defaultList
 * @returns {HealthQuestion[]}
 */
function applyDisabledFromDefault(questions, defaultList) {
  const list = Array.isArray(questions) ? questions : [];
  if (!Array.isArray(defaultList) || defaultList.length === 0) return list;
  const off = new Set(
    defaultList
      .filter((q) => q && !isQuestionEnabled(q) && q.id != null)
      .map((q) => String(q.id)),
  );
  if (off.size === 0) return list;
  return list.map((q) => (q && off.has(String(q.id)) ? { ...q, enabled: false } : q));
}

/**
 * @param {HealthQuestion[]} catalog
 * @returns {HealthQuestion[]}
 */
function filterEnabledQuestions(catalog) {
  return (Array.isArray(catalog) ? catalog : []).filter((q) => isQuestionEnabled(q));
}

/**
 * @param {HealthQuestion[]} catalog
 * @param {string} cplan
 * @returns {HealthQuestion[]}
 */
function filterQuestionsForPlan(catalog, cplan) {
  const code = String(cplan || '').trim();
  const list = Array.isArray(catalog) ? catalog : [];
  const matched = list.filter((q) => {
    const plans = (q.plans || []).map((p) => String(p).trim()).filter(Boolean);
    // Sin planes → aplica a todos (evita perder preguntas creadas en el panel)
    if (plans.length === 0) return true;
    return plans.includes(PLAN.ALL) || plans.includes('*') || plans.includes(code);
  });
  if (matched.length === 0) {
    return list.filter((q) => {
      const plans = (q.plans || []).map((p) => String(p).trim()).filter(Boolean);
      return plans.length === 0 || plans.includes(PLAN.ALL) || plans.includes('*');
    });
  }
  return matched;
}

/**
 * Si el padre de showIf no está en el plan (p. ej. deporteRiesgo solo cplan 9),
 * quitar showIf para que la pregunta sea visible en este plan.
 * Evita “preguntas fantasma” que nunca aparecen en el modal.
 * @param {HealthQuestion[]} questions
 * @returns {HealthQuestion[]}
 */
function stripOrphanShowIf(questions) {
  const ids = new Set(
    (Array.isArray(questions) ? questions : [])
      .map((q) => (q && q.id != null ? String(q.id) : ''))
      .filter(Boolean),
  );
  return (Array.isArray(questions) ? questions : []).map((q) => {
    if (!q || !q.showIf || !q.showIf.field) return q;
    if (ids.has(String(q.showIf.field))) return q;
    const next = { ...q };
    delete next.showIf;
    return next;
  });
}

/**
 * @param {string} cplan Código del plan La Mundial (ej. "4", "6", "7", "8", "9")
 * @returns {HealthQuestion[]}
 */
function getQuestionsForPlan(cplan) {
  return filterQuestionsForPlan(CATALOG, cplan);
}

/**
 * Resuelve preguntas: parametrizador Nexus (si hay) → fallback catálogo local.
 * @param {string} cplan
 * @param {{ empresaId?: number }} [opts]
 * @returns {Promise<HealthQuestion[]>}
 */
/**
 * Resuelve preguntas por plan + canal (metadata JWT).
 * El parametrizador guarda en healthQuestionsByCanal[canal]; legacy usa healthQuestions.
 */
async function resolveQuestionsForPlan(cplan, opts = {}) {
  const { resolveCanalKey, pickHealthQuestionsForCanal } = require('../lib/canalKey');
  // Como RCV: la config es por empresa del JWT; canal opcional; fallback default.
  const fromReq = Number(opts.empresaId) > 0 ? Number(opts.empresaId) : 0;
  const fromEnv = Number(process.env.PRODUCT_CONFIG_EMPRESA_ID || process.env.EMPRESA_ID || 0);
  const primaryEmpresa = fromReq || fromEnv || 1;
  const candidates = [...new Set([primaryEmpresa, 1].filter((n) => n > 0))];
  const meta = {
    ...(opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {}),
    ...(opts.canal ? { canal: opts.canal } : {}),
  };
  const canalKey = resolveCanalKey(meta);

  let catalog = CATALOG;
  let source = 'catalog';
  let empresaId = primaryEmpresa;
  let resolvedCanal = canalKey;
  let scoringRulesRaw = null;
  try {
    const {
      fetchProductConfig,
      clearProductConfigCache,
    } = require('../services/nexusProductConfig');
    clearProductConfigCache();

    /** @type {{ questions: any[], resolvedCanal: string, source: string } | null} */
    let picked = null;
    for (const eid of candidates) {
      const cfg = await fetchProductConfig(eid, 'funerario', 'emision', {
        bypassCache: true,
      });
      if (cfg?.healthScoringRules && !scoringRulesRaw) {
        scoringRulesRaw = cfg.healthScoringRules;
      }
      const hit = pickHealthQuestionsForCanal(cfg, canalKey);
      if (!hit) continue;
      const defaultList =
        cfg?.healthQuestionsByCanal &&
        typeof cfg.healthQuestionsByCanal === 'object' &&
        !Array.isArray(cfg.healthQuestionsByCanal) &&
        Array.isArray(cfg.healthQuestionsByCanal.default)
          ? cfg.healthQuestionsByCanal.default
          : Array.isArray(cfg?.healthQuestions)
            ? cfg.healthQuestions
            : [];
      hit.questions = applyDisabledFromDefault(hit.questions, defaultList);
      // Prioridad: match exacto de canal en la empresa del JWT
      if (hit.source === 'nexus-canal' && eid === primaryEmpresa) {
        picked = hit;
        empresaId = eid;
        if (cfg?.healthScoringRules) scoringRulesRaw = cfg.healthScoringRules;
        break;
      }
      if (!picked) {
        picked = hit;
        empresaId = eid;
      } else if (
        hit.questions.length > picked.questions.length &&
        eid === primaryEmpresa
      ) {
        picked = hit;
        empresaId = eid;
      }
    }
    if (picked) {
      catalog = picked.questions;
      source = picked.source;
      resolvedCanal = picked.resolvedCanal;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[funeralHealthQuestions] Nexus fallback: ${msg}`);
  }
  const filtered = filterQuestionsForPlan(filterEnabledQuestions(catalog), cplan);
  const questions = stripOrphanShowIf(filtered);
  const disabledCount = catalog.filter((q) => q && !isQuestionEnabled(q)).length;
  const catalogIds = catalog.map((q) => q?.id).filter(Boolean);
  const matchedIds = new Set(questions.map((q) => q?.id));
  const skippedIds = catalogIds.filter((id) => !matchedIds.has(id));
  const strippedShowIf = filtered
    .filter((q) => q?.showIf?.field && !matchedIds.has(String(q.showIf.field)))
    .map((q) => q.id)
    .filter(Boolean);
  console.log(
    `[funeralHealthQuestions] cplan=${cplan} canal=${canalKey}→${resolvedCanal} empresa=${empresaId} source=${source} catalog=${catalog.length} matched=${questions.length} off=${disabledCount}` +
      (strippedShowIf.length ? ` strippedShowIf=${strippedShowIf.join(',')}` : ''),
  );
  const { DEFAULT_SCORING_RULES } = require('../lib/funeralScoringRules');
  return {
    questions,
    source,
    catalogCount: catalog.length,
    skippedIds,
    strippedShowIf,
    empresaId,
    triedEmpresas: candidates,
    canal: canalKey,
    resolvedCanal,
    scoringRules: scoringRulesRaw ?? DEFAULT_SCORING_RULES,
  };
}

/** Etiqueta legible para mostrar en logs/admin */
const PLAN_LABELS = {
  '2': '1.000$ Funerario Individual',
  '3': '1.500$ Funerario Individual',
  '4': '2.000$ Funerario Individual',
  '5': '2.500$ Funerario Individual',
  '6': '3.000$ Funerario Individual',
  '7': '4.000$ Funerario Individual',
  '8': '5.000$ Funerario Individual',
  '9': '7.500$ Individual',
};

module.exports = {
  CATALOG,
  PLAN,
  TIER,
  PLAN_LABELS,
  getQuestionsForPlan,
  filterQuestionsForPlan,
  stripOrphanShowIf,
  resolveQuestionsForPlan,
};
