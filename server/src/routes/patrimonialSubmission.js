/**
 * Solicitudes patrimonial — registro en Nexus (revisión técnica).
 * Mantiene la misma estructura que funeralSubmission.
 *
 * POST /api/patrimonial/submissions → valida y crea solicitud pending
 */
const express = require('express');
const { createFuneralSubmission } = require('../services/nexusFuneralSubmission');
const { resolveCanalKey } = require('../lib/canalKey');

const router = express.Router();

function pickTomadorNombre(tomador) {
  if (!tomador || typeof tomador !== 'object') return '';
  const n = [tomador.nombre, tomador.apellido].filter(Boolean).join(' ').trim();
  return n || String(tomador.razonSocial ?? '').trim();
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
  const cplan = String(body.cplan ?? body.selectedPlan?.cplan ?? 'RCE9').trim();

  if (!sessionId || !cplan) {
    return res.status(400).json({
      success: false,
      code: 'MISSING_FIELDS',
      message: 'sessionId y cplan son obligatorios.',
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
  const cramo = body.cramo != null ? Number(body.cramo) : 20;
  const planName = String(selectedPlan.name ?? body.planName ?? '').trim() || null;
  const tomadorRif = pickTomadorRif(tomador) || body.tomadorRif;
  const tomadorNombre = pickTomadorNombre(tomador) || body.tomadorNombre;
  const tomadorEmail = String(tomador.email ?? body.tomadorEmail ?? '').trim() || null;

  try {
    const snapshot = {
      tomador: body.tomador ?? null,
      asegurado: body.asegurado ?? null,
      sameInsured: body.sameInsured,
      patrimoniales: body.patrimoniales ?? body.bien ?? null,
      selectedPlan: body.selectedPlan ?? null,
      quote: body.quote ?? null,
      quoteState: body.quoteState ?? null,
      documents: body.documents ?? null,
      metadataCanal: body.metadataCanal ?? metadata,
      product: 'patrimonial',
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
      scoreTotal: 0,
      scoreBreakdown: {},
      snapshot,
    });

    return res.status(201).json({
      success: true,
      submission,
      message:
        'Solicitud patrimonial registrada. Un técnico revisará tu caso antes de continuar al pago.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === 'object' && 'code' in err ? err.code : 'SUBMISSION_ERROR';
    const httpStatus =
      (err && typeof err === 'object' && Number(err.httpStatus)) ||
      (code === 'NEXUS_API_KEY_MISSING' ? 503 : 500);
    console.error('[patrimonial/submissions]', code || '', msg);
    return res.status(httpStatus).json({
      success: false,
      code,
      message: msg,
      stage: 'submission',
    });
  }
});

module.exports = router;
