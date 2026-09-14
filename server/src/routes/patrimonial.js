/**
 * Rutas del producto Patrimonial (Riesgos Generales) — cramo 20.
 *
 *   GET  /api/patrimonial/planes?cramo=20     → planes vigentes para riesgos generales
 *   POST /api/patrimonial/cotizacion           → cotización vía quote-generalRisks
 *   POST /api/patrimonial/quote-generalRisks   → alias directo para cotización
 *   POST /api/patrimonial/emision              → cotiza + formatea + emite vía generalRisks
 *   POST /api/patrimonial/generalRisks         → alias directo para emisión
 */
const express = require('express');
const patrimonialClient = require('../services/patrimonialClient');
const { mapWizardToGeneralRisksEmitDto } = require('../services/patrimonialMapper');
const { resolveIngresoCajaAfterPayment } = require('../services/collectionAfterPayment');
const { recordFuneralEmissionFlexible } = require('../services/nexusFuneralSubmission');
const { archiveExpedienteAfterEmit } = require('../services/expedienteArchive');

const router = express.Router();
const DEFAULT_RAMO = patrimonialClient.DEFAULT_RAMO || 20;

function asRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

function resolveSubmissionRefs(state) {
  const payload = asRecord(state?.checkoutPayload);
  const canal = asRecord(state?.metadataCanal);
  return {
    submissionId: String(
      state?.patrimonialSubmissionId
      || state?.funeralSubmissionId
      || payload.patrimonialSubmissionId
      || payload.funeralSubmissionId
      || canal.patrimonialSubmissionId
      || canal.funeralSubmissionId
      || '',
    ).trim(),
    paymentSid: String(state?.paymentSid || state?.sid || payload.paymentSid || '').trim(),
    sessionId: String(
      state?.originSessionId
      || payload.originSessionId
      || canal.originSessionId
      || state?.sessionId
      || payload.sessionId
      || '',
    ).trim(),
  };
}

function withNexusMetadata(state, nexusMetadata) {
  if (!state || typeof state !== 'object') return state;
  if (!nexusMetadata || typeof nexusMetadata !== 'object' || !Object.keys(nexusMetadata).length) {
    return state;
  }
  return {
    ...state,
    metadataCanal: { ...(state.metadataCanal || {}), ...nexusMetadata },
  };
}

// ── GET /planes ─────────────────────────────────────────────────────────────
router.get('/planes', async (req, res) => {
  const cramo = req.query.cramo ? parseInt(req.query.cramo, 10) : DEFAULT_RAMO;
  try {
    const { planes } = await patrimonialClient.getPlanesPatrimonial(cramo);
    res.json({ success: true, planes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[patrimonial/planes]', msg);
    res.status(502).json({
      success: false,
      code: err.code || 'PATRIMONIAL_PLANES_ERROR',
      message: `No se pudieron obtener los planes patrimoniales: ${msg}`,
    });
  }
});

// ── POST /cotizacion /quote-generalRisks ──────────────────────────────────────
async function handleQuote(req, res) {
  const body = req.body || {};
  const cplan = String(
    body.cplan ||
    body.state?.selectedPlan?.cplan ||
    body.plan ||
    '',
  ).trim();

  const cramo = body.cramo != null
    ? Number(body.cramo)
    : (body.state?.cramo != null ? Number(body.state.cramo) : DEFAULT_RAMO);

  const ifrecuencia = String(
    body.ifrecuencia ||
    body.frecuencia ||
    body.state?.rcv?.frecuencia ||
    body.state?.frecuencia ||
    'A',
  ).trim();

  const ptasamon = body.ptasamon != null
    ? Number(body.ptasamon)
    : (body.ptasa != null ? Number(body.ptasa) : (body.state?.ptasamon != null ? Number(body.state.ptasamon) : 500));

  const cuotas = body.cuotas != null
    ? Number(body.cuotas)
    : (body.ncuota != null ? Number(body.ncuota) : (body.state?.cuotas != null ? Number(body.state.cuotas) : 1));

  const pdescuento = Number(body.pdescuento ?? 0);
  const precargo = Number(body.precargo ?? 0);

  if (!cplan) {
    return res.status(400).json({
      success: false,
      status: false,
      code: 'MISSING_PLAN',
      message: 'cplan es obligatorio para cotizar.',
    });
  }

  try {
    const quote = await patrimonialClient.quoteGeneralRisks({
      cramo,
      cplan,
      ptasamon,
      cuotas,
      ifrecuencia,
      pdescuento,
      precargo,
    });

    return res.json({
      success: true,
      status: true,
      mprima: quote.mprima,
      mprimaext: quote.mprimaext,
      ptasa: quote.ptasa,
      ptasamon: quote.ptasa,
      sumaAsegurada: quote.sumaAsegurada,
      coberturas: quote.coberturas,
      data: quote.data,
      recordset: quote.recordset,
      metadata: {
        cramo,
        cplan,
        ifrecuencia,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[patrimonial/cotizacion]', msg);
    return res.status(err.httpStatus || 502).json({
      success: false,
      status: false,
      code: err.code || 'PATRIMONIAL_QUOTE_ERROR',
      message: `No se pudo cotizar el plan patrimonial: ${msg}`,
      stage: 'quote',
    });
  }
}

router.post('/cotizacion', handleQuote);
router.post('/quote-generalRisks', handleQuote);

// ── POST /emision /generalRisks ───────────────────────────────────────────────
async function handleEmit(req, res) {
  const { state: rawState, plan: bodyPlan, frecuencia } = req.body || {};
  const state = withNexusMetadata(rawState, req.nexusMetadata);

  if (!state || !state.tomador) {
    // Si viene en el formato directo generalRisks (keys, tomador, bien_asegurado...)
    if (req.body?.keys && req.body?.tomador && req.body?.bien_asegurado) {
      try {
        const emitted = await patrimonialClient.createEmissionGeneralRisk(req.body);
        return res.status(201).json({
          success: true,
          status: true,
          message: emitted.message || 'Póliza generada exitosamente',
          cnpoliza: emitted.cnpoliza,
          urlpoliza: emitted.urlpoliza,
          lapso: emitted.lapso,
          mes: emitted.mes,
          cnrecibo: emitted.cnrecibo,
          ncuota: emitted.ncuota,
          policy: {
            number: emitted.cnpoliza,
            cnpoliza: emitted.cnpoliza,
            cnrecibo: emitted.cnrecibo,
            urlpoliza: emitted.urlpoliza,
            lapso: emitted.lapso,
            mes: emitted.mes,
            ncuota: emitted.ncuota,
            emittedAt: new Date().toISOString(),
          },
        });
      } catch (directErr) {
        return res.status(directErr.httpStatus || 502).json({
          success: false,
          status: false,
          code: directErr.code || 'PATRIMONIAL_EMIT_ERROR',
          message: directErr.message,
          stage: 'emit',
        });
      }
    }

    return res.status(400).json({
      success: false,
      status: false,
      code: 'MISSING_STATE',
      message: 'state.tomador o payload generalRisks (keys, tomador, bien_asegurado) requerido para emitir la póliza.',
    });
  }

  const cplan = bodyPlan || state.selectedPlan?.cplan || state.cplan || 'RCE9';
  const cramo = state.cramo != null ? Number(state.cramo) : DEFAULT_RAMO;
  const ifrecuencia = frecuencia || state.rcv?.frecuencia || state.frecuencia || 'A';
  const ptasamon = state.ptasamon != null ? Number(state.ptasamon) : 500;
  const cuotas = state.cuotas != null ? Number(state.cuotas) : 1;

  try {
    // 1. Cotiza para autorizar prima y tasa
    const cotizacion = await patrimonialClient.quoteGeneralRisks({
      cramo,
      cplan,
      ptasamon,
      cuotas,
      ifrecuencia,
      pdescuento: 0,
      precargo: 0,
    });

    // 2. Construye el payload generalRisks
    const { payload, metadata } = mapWizardToGeneralRisksEmitDto(state, cotizacion, {
      plan: cplan,
      frecuencia: ifrecuencia,
      cramo,
    });

    const meta = state.metadataCanal || {};
    console.log(
      `[patrimonial/emision] metadataCanal cproductor=${meta.cproductor ?? 'default'} ccanalalt=${meta.ccanalalt ?? 'default'} cusuario=${meta.cusuario ?? 'default'}`,
    );

    // 3. Emite contra nest-api generalRisks
    const emitted = await patrimonialClient.createEmissionGeneralRisk(payload);

    // 4. Archiva expediente OCR
    await archiveExpedienteAfterEmit({
      state,
      emission: emitted,
      empresaNombre: req.empresa?.nombre,
      authToken: req.nexusToken,
    });

    // 5. Genera recibo de caja si aplica
    const emitMetadata = { ...metadata };
    const url_ingreso_caja = await resolveIngresoCajaAfterPayment(state, {
      cnrecibo: emitted.cnrecibo,
      mpagoFallback: cotizacion.mprima,
      metadata: emitMetadata,
    });

    const emissionRecord = {
      cnpoliza: emitted.cnpoliza,
      cnrecibo: emitted.cnrecibo,
      urlpoliza: emitted.urlpoliza,
      url_ingreso_caja,
      lapso: emitted.lapso,
      mes: emitted.mes,
      ncuota: emitted.ncuota,
      emittedAt: new Date().toISOString(),
      quote: {
        mprima: cotizacion.mprima,
        mprimaext: cotizacion.mprimaext,
        ptasa: cotizacion.ptasa,
      },
    };

    // 6. Registra en Nexus historial
    const refs = resolveSubmissionRefs(state);
    try {
      await recordFuneralEmissionFlexible(refs, emissionRecord);
    } catch (saveErr) {
      console.warn('[patrimonial/emision] no se pudo registrar en historial Nexus:', saveErr?.message);
    }

    return res.status(201).json({
      success: true,
      status: true,
      message: emitted.message || 'Póliza generada exitosamente',
      cnpoliza: emitted.cnpoliza,
      urlpoliza: emitted.urlpoliza,
      lapso: emitted.lapso,
      mes: emitted.mes,
      cnrecibo: emitted.cnrecibo,
      ncuota: emitted.ncuota,
      policy: {
        number: emitted.cnpoliza,
        cnpoliza: emitted.cnpoliza,
        cnrecibo: emitted.cnrecibo,
        urlpoliza: emitted.urlpoliza,
        url_ingreso_caja,
        lapso: emitted.lapso,
        mes: emitted.mes,
        ncuota: emitted.ncuota,
        internalPolicyId: metadata.internalPolicyId,
        emittedAt: emissionRecord.emittedAt,
        quote: {
          mprima: cotizacion.mprima,
          mprimaext: cotizacion.mprimaext,
          ptasa: cotizacion.ptasa,
        },
        metadata: emitMetadata,
      },
      emission: emissionRecord,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const httpStatus = err.httpStatus || 502;
    console.error('[patrimonial/emision]', err.code || '', msg);
    return res.status(httpStatus).json({
      success: false,
      code: err.code || 'PATRIMONIAL_EMIT_ERROR',
      message: msg,
      ...(err.endpoint ? { endpoint: err.endpoint } : {}),
      stage: 'emit',
    });
  }
}

router.post('/emision', handleEmit);
router.post('/generalRisks', handleEmit);

module.exports = router;
