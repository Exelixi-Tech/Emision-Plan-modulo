/**
 * Solicitudes funerario — scoring + registro en Nexus (revisión técnica).
 *
 * POST /api/funeral/submissions → valida póliza vigente, score y crea solicitud pending
 */
const express = require('express');
const { resolveQuestionsForPlan } = require('../config/funeralHealthQuestions');
const { computePolicyHealthScore, insuredKey, insuredLabel } = require('../lib/funeralHealthScoring');
const { parseScoringRules } = require('../lib/funeralScoringRules');
const { upsertHealthAnswers } = require('../services/healthDb');
const { createFuneralSubmission } = require('../services/nexusFuneralSubmission');
const { assertPersonasCanEmit } = require('../services/assertPersonasCanEmit');
const { productLabelFromMeta } = require('../config/healthQuestionsByRamo');
const { isPersonasCplan, resolvePersonasCramo } = require('../lib/funerarioPlan');
const { adjustPremiumByAnswers } = require('../lib/healthPremiumAdjust');
const personasClient = require('../services/personasClient');
const personasMapper = require('../services/personasMapper');
const { resolveCanalKey } = require('../lib/canalKey');

const router = express.Router();

function pickTomadorNombre(tomador) {
  if (!tomador || typeof tomador !== 'object') return '';
  const n = [tomador.nombre, tomador.apellido].filter(Boolean).join(' ').trim();
  return n || String(tomador.razonSocial ?? '').trim();
}

function positiveCramo(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickTomadorRif(tomador) {
  if (!tomador || typeof tomador !== 'object') return '';
  const tipo = String(tomador.tipoDoc ?? 'V').trim();
  const id = String(tomador.identificacion ?? '').trim();
  if (!id) return '';
  return `${tipo}-${id}`;
}

router.post('/submissions', async (req, res) => {
  const body = req.body ?? {};
  const sessionId = String(body.sessionId ?? '').trim();
  const cplan = String(body.cplan ?? body.selectedPlan?.cplan ?? '').trim();
  const answers =
    body.healthAnswers && typeof body.healthAnswers === 'object'
      ? body.healthAnswers
      : body.answers;

  if (!sessionId || !cplan) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_FIELDS',
      message: 'sessionId y cplan son obligatorios.',
    });
  }

  if (!isPersonasCplan(cplan, body.cproducto)) {
    return res.status(400).json({
      success: false,
      code: 'NOT_PERSONAS_PLAN',
      message: `El cplan "${cplan}" no es un plan de personas.`,
    });
  }

  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({
      success: false,
      code: 'MISSING_ANSWERS',
      message: 'Debe enviar healthAnswers con las respuestas del cuestionario.',
    });
  }

  const empresaId =
    Number(req.empresa?.id ?? body.empresaId ?? process.env.EMPRESA_ID ?? 1) || 1;

  const metadata = {
    ...(req.nexusMetadata && typeof req.nexusMetadata === 'object' ? req.nexusMetadata : {}),
    ...(body.metadataCanal && typeof body.metadataCanal === 'object' ? body.metadataCanal : {}),
  };
  const canal = resolveCanalKey(metadata);

  const tomador = body.tomador ?? {};
  const selectedPlan = body.selectedPlan ?? {};
  const cramo = positiveCramo(metadata.cramo)
    ?? positiveCramo(body.cramo)
    ?? positiveCramo(selectedPlan.cramo)
    ?? 9;
  const planName = String(selectedPlan.name ?? body.planName ?? '').trim() || null;
  const tomadorRif = pickTomadorRif(tomador) || body.tomadorRif;
  const tomadorNombre = pickTomadorNombre(tomador) || body.tomadorNombre;
  const tomadorEmail = String(tomador.email ?? body.tomadorEmail ?? '').trim() || null;

  try {
    // Gate Sis2000: si ya hay póliza vigente, no crear solicitud ni avisar al técnico.
    await assertPersonasCanEmit(
      {
        tomador,
        funeral: body.funeral,
        selectedPlan,
        metadataCanal: body.metadataCanal ?? metadata,
      },
      { plan: cplan },
    );

    const { questions, scoringRules } = await resolveQuestionsForPlan(cplan, {
      empresaId,
      metadata,
      cramo,
      selectedPlan,
      cproducto: metadata.cproducto ?? body.cproducto,
    });
    const rules = parseScoringRules(scoringRules);

    const funeral = body.funeral && typeof body.funeral === 'object' ? body.funeral : {};
    const rawAsegurados = Array.isArray(funeral.asegurados) ? funeral.asegurados : [];
    const byInsuredIn =
      answers && answers.byInsured && typeof answers.byInsured === 'object'
        ? answers.byInsured
        : funeral.healthAnswersByInsured && typeof funeral.healthAnswersByInsured === 'object'
          ? funeral.healthAnswersByInsured
          : null;

    const insureds = (rawAsegurados.length ? rawAsegurados : [body.tomador || {}]).map(
      (person, idx) => {
        const key = insuredKey(person, idx);
        const packed = byInsuredIn && byInsuredIn[key];
        const personAnswers =
          packed && typeof packed === 'object' && packed.answers
            ? packed.answers
            : packed && typeof packed === 'object' && !packed.answers
              ? packed
              : idx === 0 && (!byInsuredIn || !Object.keys(byInsuredIn).length)
                ? answers
                : {};
        return {
          key,
          label: insuredLabel(person, idx),
          person,
          answers: personAnswers && typeof personAnswers === 'object' ? personAnswers : {},
        };
      },
    );

    const scoring = computePolicyHealthScore(questions, insureds, rules);

    // Solo el rechazo de una pregunta (términos, blockIfTrue, etc.) corta sin mesa.
    // El rango "Alto" debe crear solicitud para que mesa técnica la vea.
    if (scoring.forcedReject) {
      return res.status(422).json({
        success: false,
        code: 'HEALTH_BLOCKED',
        message:
          scoring.verdictMessage ||
          scoring.blockReason ||
          'La solicitud no cumple los criterios del cuestionario de salud.',
        scoring: {
          total: scoring.total,
          breakdown: scoring.breakdown,
          blocked: true,
          verdict: 'reject',
          verdictMessage: scoring.verdictMessage,
          perInsured: scoring.perInsured?.map((p) => ({
            key: p.key,
            label: p.label,
            total: p.scoring.total,
            verdict: p.scoring.verdict,
          })),
        },
      });
    }

    // Recargos/descuentos por respuesta: prima ajustada por asegurado (cotiza anual como la
    // pantalla de planes). La emisión recalcula igual con su cotización autoritativa.
    const quoteCramo = resolvePersonasCramo({
      selectedPlan,
      metadataCanal: metadata,
      cproducto: metadata.cproducto,
    });
    const premiumAdjust = await adjustPremiumByAnswers({
      questions,
      persons: rawAsegurados,
      asegurados: personasMapper.buildAseguradosForQuote(funeral, {
        tomador: body.tomador,
        asegurado: body.asegurado,
        sameInsured: body.sameInsured,
      }),
      byInsured: Object.fromEntries(insureds.map((i) => [i.key, i.answers])),
      quoteOne: (aseg) =>
        personasClient.getCotizacionPer({ cramo: quoteCramo, cplan, asegurados: [aseg], ifrecuencia: 'A' }),
    });
    const quoteFinal = premiumAdjust
      ? { ...(body.quote || {}), ...premiumAdjust.quote, ptasa: premiumAdjust.quote.ptasa || body.quote?.ptasa }
      : body.quote ?? null;

    upsertHealthAnswers({
      sessionId,
      cplan,
      cramo,
      tomadorRif: tomadorRif || undefined,
      planName: planName || undefined,
      answers,
    });

    const snapshot = {
      tomador: body.tomador ?? null,
      asegurado: body.asegurado ?? null,
      sameInsured: body.sameInsured,
      hasBeneficiary: body.hasBeneficiary,
      beneficiario: body.beneficiario ?? null,
      funeral: body.funeral ?? null,
      selectedPlan: body.selectedPlan ?? null,
      quote: quoteFinal,
      quoteState: body.quoteState ?? null,
      /** Detalle interno: prima base, recargo/descuento por asegurado y preguntas. */
      premiumAdjust: premiumAdjust ?? null,
      documents: body.documents ?? null,
      metadataCanal: body.metadataCanal ?? metadata,
      product: 'funerario',
      /** Producto real para los correos (Nexus lo lee del snapshot). */
      productLabel: productLabelFromMeta(body.metadataCanal ?? metadata),
    };

    const submission = await createFuneralSubmission({
      empresaId,
      sessionId,
      canal,
      tomadorRif: tomadorRif || undefined,
      tomadorNombre: tomadorNombre || undefined,
      tomadorEmail: tomadorEmail || undefined,
      cplan,
      planName: planName || undefined,
      cramo,
      scoreTotal: scoring.total,
      scoreBreakdown: scoring.breakdown,
      healthAnswers: {
        byInsured: Object.fromEntries(
          (scoring.perInsured || []).map((p) => [
            p.key,
            { label: p.label, answers: p.answers, total: p.scoring.total, verdict: p.scoring.verdict },
          ]),
        ),
      },
      snapshot: {
        ...snapshot,
        healthVerdict: scoring.verdict,
        healthByInsured: (scoring.perInsured || []).map((p) => ({
          key: p.key,
          label: p.label,
          total: p.scoring.total,
          verdict: p.scoring.verdict,
        })),
      },
      verdict: scoring.verdict,
      reviewerEmails: rules.reviewerEmails,
      notifyReviewers: scoring.verdict !== 'emit',
      autoApprove: scoring.verdict === 'emit',
    });

    const autoPayOk = scoring.verdict === 'emit' && submission?.estado === 'approved';
    const clientVerdict = autoPayOk ? 'emit' : scoring.verdict === 'emit' ? 'referred' : scoring.verdict;
    const clientMessage = autoPayOk
      ? scoring.verdictMessage
      : scoring.verdict === 'emit'
        ? 'Un técnico revisará tu solicitud antes de continuar al pago.'
        : scoring.verdictMessage;

    return res.status(201).json({
      success: true,
      submission,
      scoring: {
        total: scoring.total,
        breakdown: scoring.breakdown,
        blocked: scoring.blocked,
        verdict: clientVerdict,
        verdictMessage: clientMessage,
        perInsured: scoring.perInsured?.map((p) => ({
          key: p.key,
          label: p.label,
          total: p.scoring.total,
          verdict: p.scoring.verdict,
        })),
      },
      quote: quoteFinal,
      premiumAdjust: premiumAdjust ?? null,
      message: clientMessage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === 'object' && 'code' in err ? err.code : 'SUBMISSION_ERROR';
    const httpStatus =
      (err && typeof err === 'object' && Number(err.httpStatus)) ||
      (code === 'NEXUS_API_KEY_MISSING' ? 503 : 500);
    console.error('[funeral/submissions]', code || '', msg);
    return res.status(httpStatus).json({
      success: false,
      code,
      message: msg,
      stage: 'validate',
    });
  }
});

module.exports = router;
