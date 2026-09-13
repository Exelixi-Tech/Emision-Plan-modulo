/**
 * Motor de scoring del cuestionario de salud funerario.
 * Solo flujo funerario — no interfiere con RCV.
 */

const {
  parseScoringRules,
  worseVerdict,
  verdictFromRange,
  messageForVerdict,
} = require('./funeralScoringRules');

function toScore(value) {
  if (typeof value === 'string') {
    const n = Number(value.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function questionAction(q, side) {
  const key = side === 'false' ? 'actionIfFalse' : 'actionIfTrue';
  const raw = q && q[key];
  if (raw === 'refer' || raw === 'reject' || raw === 'score') return raw;
  if (side === 'true' && q && q.blockIfTrue) return 'reject';
  if (side === 'false' && q && q.blockIfFalse) return 'reject';
  return 'score';
}

/**
 * @param {import('../config/funeralHealthQuestions').HealthQuestion[]} questions
 * @param {Record<string, unknown>} answers
 * @param {object} [rulesRaw]
 */
function computeHealthScore(questions, answers, rulesRaw) {
  const rules = parseScoringRules(rulesRaw);
  const breakdown = [];
  let total = 0;
  let yesCount = 0;
  let forcedReject = false;
  let forcedRefer = false;
  let blockReason;

  for (const q of questions) {
    if (q.enabled === false) continue;
    if (!isQuestionVisible(q, answers)) continue;

    const answer = answers[q.id];
    let points = 0;
    let action = 'score';

    if (q.type === 'boolean') {
      if (answer === true) {
        points = toScore(q.scoreIfTrue);
        action = questionAction(q, 'true');
        const concIds = rules.concurrence.questionIds;
        const counts =
          !concIds.length || concIds.includes(String(q.id));
        if (counts) yesCount += 1;
      } else if (answer === false) {
        points = toScore(q.scoreIfFalse);
        action = questionAction(q, 'false');
      }
    } else if (q.type === 'select') {
      const val = String(answer ?? '');
      const map = q.optionScores && typeof q.optionScores === 'object' ? q.optionScores : {};
      points = toScore(map[val]);
    } else if (q.type === 'text') {
      const filled = String(answer ?? '').trim().length > 0;
      if (filled) points = toScore(q.scoreIfFilled);
    }

    if (action === 'reject') {
      forcedReject = true;
      blockReason = q.blockReason || `Respuesta en: ${q.label}`;
    } else if (action === 'refer') {
      forcedRefer = true;
    }

    if (Number.isFinite(points) && points !== 0) {
      total += points;
    }

    breakdown.push({
      questionId: q.id,
      label: q.label,
      answer,
      points,
      action,
      ...(action === 'reject' ? { blocked: true } : {}),
    });
  }

  let concurrencePoints = 0;
  if (
    rules.concurrence.enabled &&
    yesCount >= rules.concurrence.minYesCount &&
    rules.concurrence.extraPoints
  ) {
    concurrencePoints = rules.concurrence.extraPoints;
    total += concurrencePoints;
    breakdown.push({
      questionId: '_concurrence',
      label: `Concurrencia (${yesCount} respuestas Sí)`,
      answer: yesCount,
      points: concurrencePoints,
      action: 'score',
    });
  }

  let verdict = verdictFromRange(total, rules);
  if (forcedRefer) verdict = worseVerdict(verdict, 'referred');
  if (forcedReject) verdict = 'reject';

  const blocked = verdict === 'reject';
  return {
    total,
    breakdown,
    blocked,
    blockReason: blocked
      ? blockReason || messageForVerdict('reject', rules)
      : undefined,
    verdict,
    verdictMessage: blocked
      ? blockReason || messageForVerdict('reject', rules)
      : messageForVerdict(verdict, rules),
    concurrencePoints,
    yesCount,
    forcedRefer,
    forcedReject,
  };
}

function isQuestionVisible(q, answers) {
  if (!q.showIf?.field) return true;
  const actual = answers[q.showIf.field];
  const expected = q.showIf.equals;
  if (
    expected === true ||
    expected === false ||
    expected === 'true' ||
    expected === 'false'
  ) {
    const want = expected === true || expected === 'true';
    return actual === want;
  }
  return String(actual ?? '') === String(expected);
}

function insuredKey(person, idx) {
  const id = String(person?.identificacion ?? '').replace(/\D/g, '');
  if (id) return `${String(person?.tipoDoc || 'V').trim()}-${id}`;
  return `aseg-${idx}`;
}

function insuredLabel(person, idx) {
  const name = [person?.nombre, person?.apellido].filter(Boolean).join(' ').trim();
  return name || String(person?.identificacion || '').trim() || `Asegurado ${idx + 1}`;
}

/**
 * Un score por asegurado; la póliza toma el peor veredicto y el mayor puntaje.
 */
function computePolicyHealthScore(questions, insureds, rulesRaw) {
  const rules = parseScoringRules(rulesRaw);
  const list = Array.isArray(insureds) && insureds.length > 0
    ? insureds
    : [{ key: 'aseg-0', label: 'Asegurado', answers: {} }];

  const perInsured = list.map((item, idx) => {
    const answers =
      item.answers && typeof item.answers === 'object' ? item.answers : {};
    const scoring = computeHealthScore(questions, answers, rules);
    const key = item.key || insuredKey(item.person, idx);
    const label = item.label || insuredLabel(item.person, idx);
    return { key, label, answers, scoring };
  });

  let verdict = 'emit';
  let total = 0;
  const breakdown = [];
  for (const row of perInsured) {
    verdict = worseVerdict(verdict, row.scoring.verdict);
    if (row.scoring.total > total) total = row.scoring.total;
    for (const line of row.scoring.breakdown) {
      breakdown.push({ ...line, insuredKey: row.key, insuredLabel: row.label });
    }
  }

  const worst = perInsured.find((r) => r.scoring.verdict === verdict) || perInsured[0];
  const blocked = verdict === 'reject';
  return {
    total,
    breakdown,
    blocked,
    blockReason: worst?.scoring.blockReason,
    verdict,
    verdictMessage: worst?.scoring.verdictMessage || messageForVerdict(verdict, rules),
    perInsured,
    rules,
  };
}

module.exports = {
  computeHealthScore,
  computePolicyHealthScore,
  isQuestionVisible,
  insuredKey,
  insuredLabel,
};
