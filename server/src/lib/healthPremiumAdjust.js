/**
 * Recargos y descuentos por respuesta del cuestionario de salud (Vida, AP, Funerario).
 *
 * Igual que la pasarela de La Mundial: el % se aplica sobre la prima de cada asegurado
 * y el total ajustado viaja como prima (mprimaext) a la emisión. Sin desglose en Sis2000.
 *
 *   prima asegurado = prima base × (1 + recargos% − descuentos%)
 *
 * Configuración por pregunta (parametrizador):
 *   - boolean: `recargoIfTrue` / `descuentoIfTrue` (% cuando responde "Sí")
 *   - select:  `optionRecargos` / `optionDescuentos` ({ valorOpcion: % })
 */
const { isQuestionVisible, insuredKey, insuredLabel } = require('./funeralHealthScoring');

/** @param {unknown} v @returns {number} porcentaje positivo o 0 */
function pct(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function hasAnyPct(map) {
  return Boolean(map) && typeof map === 'object' && Object.values(map).some((v) => pct(v) > 0);
}

/**
 * ¿Alguna pregunta tiene recargo o descuento configurado?
 * @param {object[]} questions
 */
function hasPremiumAdjustments(questions) {
  return (questions || []).some(
    (q) =>
      q &&
      (pct(q.recargoIfTrue) > 0 ||
        pct(q.descuentoIfTrue) > 0 ||
        hasAnyPct(q.optionRecargos) ||
        hasAnyPct(q.optionDescuentos)),
  );
}

/**
 * Suma de recargos y descuentos de un asegurado según sus respuestas.
 * @param {object[]} questions
 * @param {Record<string, unknown>} answers
 */
function computeInsuredAdjust(questions, answers) {
  let recargoPct = 0;
  let descuentoPct = 0;
  const lines = [];
  for (const q of questions || []) {
    if (!q || !q.id || !isQuestionVisible(q, answers)) continue;
    const val = answers[q.id];
    let r = 0;
    let d = 0;
    if (q.type === 'boolean' && val === true) {
      r = pct(q.recargoIfTrue);
      d = pct(q.descuentoIfTrue);
    } else if (q.type === 'select' && val != null && val !== '') {
      r = pct(q.optionRecargos?.[String(val)]);
      d = pct(q.optionDescuentos?.[String(val)]);
    }
    if (r > 0 || d > 0) {
      recargoPct += r;
      descuentoPct += d;
      lines.push({ questionId: q.id, label: q.label, recargoPct: r, descuentoPct: d });
    }
  }
  return {
    recargoPct: round2(recargoPct),
    descuentoPct: round2(descuentoPct),
    netoPct: round2(recargoPct - descuentoPct),
    lines,
  };
}

/** Respuestas de un asegurado: por clave, o por posición si las claves no coinciden. */
function answersFor(byInsured, person, idx) {
  if (!byInsured || typeof byInsured !== 'object') return {};
  const packed = byInsured[insuredKey(person, idx)] ?? Object.values(byInsured)[idx];
  if (!packed || typeof packed !== 'object') return {};
  return packed.answers && typeof packed.answers === 'object' ? packed.answers : packed;
}

/**
 * Prima ajustada por las respuestas, cotizando cada asegurado por separado.
 *
 * @param {{
 *   questions: object[],
 *   persons: object[],               // funeral.asegurados (mismo orden que asegurados)
 *   asegurados: object[],            // [{ cparen, xrif_asegurado, nedad_asegurado }]
 *   byInsured: Record<string, unknown>,
 *   quoteOne: (aseg: object) => Promise<{ mprima: number, mprimaext: number, ptasa?: number }>,
 * }} input
 * @returns {Promise<null | {
 *   base: { mprima: number, mprimaext: number },
 *   quote: { mprima: number, mprimaext: number, ptasa: number },
 *   porAsegurado: object[],
 * }>} null si no hay recargos/descuentos configurados o ninguno aplica.
 */
async function adjustPremiumByAnswers({ questions, persons, asegurados, byInsured, quoteOne }) {
  if (!hasPremiumAdjustments(questions) || !Array.isArray(asegurados) || !asegurados.length) {
    return null;
  }
  const people = Array.isArray(persons) ? persons : [];
  const porAsegurado = asegurados.map((aseg, idx) => {
    const person = people[idx] || {};
    return {
      key: insuredKey(person, idx),
      label: insuredLabel(person, idx),
      aseg,
      ...computeInsuredAdjust(questions, answersFor(byInsured, person, idx)),
    };
  });
  if (!porAsegurado.some((p) => p.netoPct !== 0)) return null;

  let baseExt = 0;
  let baseBs = 0;
  let ajustadaExt = 0;
  let ajustadaBs = 0;
  let ptasa = 0;
  for (const row of porAsegurado) {
    const q = await quoteOne(row.aseg);
    const factor = Math.max(0, 1 + row.netoPct / 100);
    row.primaBaseExt = round2(Number(q.mprimaext) || 0);
    row.primaAjustadaExt = round2(row.primaBaseExt * factor);
    baseExt += row.primaBaseExt;
    baseBs += Number(q.mprima) || 0;
    ajustadaExt += row.primaAjustadaExt;
    ajustadaBs += (Number(q.mprima) || 0) * factor;
    if (!ptasa && Number(q.ptasa) > 0) ptasa = Number(q.ptasa);
    delete row.aseg;
  }
  return {
    base: { mprima: round2(baseBs), mprimaext: round2(baseExt) },
    quote: { mprima: round2(ajustadaBs), mprimaext: round2(ajustadaExt), ptasa },
    porAsegurado,
  };
}

module.exports = {
  adjustPremiumByAnswers,
  computeInsuredAdjust,
  hasPremiumAdjustments,
};
