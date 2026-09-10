/**
 * Reglas de scoring funerario (rangos, concurrencia, correos).
 * Solo ramo funerario — no usar en RCV.
 */

const DEFAULT_SCORING_RULES = {
  rangesEnabled: false,
  ranges: {
    emit: {
      min: 0,
      max: 29,
      message: 'Tus respuestas permiten continuar con la contratación.',
    },
    referred: {
      min: 30,
      max: 69,
      message: 'Un técnico revisará tu solicitud antes de continuar al pago.',
    },
    reject: {
      min: 70,
      max: 9999,
      message: 'Según tus respuestas no es posible emitir esta póliza en línea.',
    },
  },
  concurrence: {
    enabled: false,
    minYesCount: 2,
    extraPoints: 10,
    questionIds: [],
  },
  reviewerEmails: [],
};

function toNum(v, fallback) {
  const n = Number(typeof v === 'string' ? v.replace(',', '.') : v);
  return Number.isFinite(n) ? n : fallback;
}

function band(raw, fallback) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    min: toNum(src.min, fallback.min),
    max: toNum(src.max, fallback.max),
    message: String(src.message ?? fallback.message).trim() || fallback.message,
  };
}

function parseEmails(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const email = String(item ?? '')
      .trim()
      .toLowerCase();
    if (!email || !email.includes('@') || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function parseScoringRules(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const d = DEFAULT_SCORING_RULES;
  const conc = src.concurrence && typeof src.concurrence === 'object' ? src.concurrence : {};
  return {
    rangesEnabled: src.rangesEnabled === true,
    ranges: {
      emit: band(src.ranges?.emit, d.ranges.emit),
      referred: band(src.ranges?.referred, d.ranges.referred),
      reject: band(src.ranges?.reject, d.ranges.reject),
    },
    concurrence: {
      enabled: conc.enabled === true,
      minYesCount: Math.max(1, Math.round(toNum(conc.minYesCount, d.concurrence.minYesCount))),
      extraPoints: toNum(conc.extraPoints, d.concurrence.extraPoints),
      questionIds: Array.isArray(conc.questionIds)
        ? conc.questionIds.map((id) => String(id).trim()).filter(Boolean)
        : [],
    },
    reviewerEmails: parseEmails(src.reviewerEmails),
  };
}

const VERDICT_RANK = { emit: 0, referred: 1, reject: 2 };

function worseVerdict(a, b) {
  return (VERDICT_RANK[a] || 0) >= (VERDICT_RANK[b] || 0) ? a : b;
}

function verdictFromRange(total, rules) {
  if (!rules.rangesEnabled) return 'referred';
  const { emit, referred, reject } = rules.ranges;
  if (total >= reject.min && total <= reject.max) return 'reject';
  if (total >= referred.min && total <= referred.max) return 'referred';
  if (total >= emit.min && total <= emit.max) return 'emit';
  if (total >= reject.min) return 'reject';
  if (total >= referred.min) return 'referred';
  return 'emit';
}

function messageForVerdict(verdict, rules) {
  if (verdict === 'reject') return rules.ranges.reject.message;
  if (verdict === 'emit') return rules.ranges.emit.message;
  return rules.ranges.referred.message;
}

module.exports = {
  DEFAULT_SCORING_RULES,
  parseScoringRules,
  parseEmails,
  worseVerdict,
  verdictFromRange,
  messageForVerdict,
};
