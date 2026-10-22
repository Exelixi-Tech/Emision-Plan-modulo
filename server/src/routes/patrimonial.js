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

const { resolveEntityContext } = require('../services/canalClient');
const { puedeElegirProductor, withNexusMetadata } = require('../lib/nexusMetadata');

const router = express.Router();
const DEFAULT_RAMO = patrimonialClient.DEFAULT_RAMO || 28;

function patrimonialCanalMeta(req) {
  const q = req.query || {};
  const b = req.body || {};
  const stateMeta = b.metadataCanal || b.state?.metadataCanal || {};
  const hasVerifiedAuth = Boolean(
    req.nexusMetadata && typeof req.nexusMetadata === 'object' && Object.keys(req.nexusMetadata).length > 0
  );

  const meta = { ...(req.nexusMetadata || {}) };

  // Contexto general (no sensible de actor)
  const generalKeys = [
    'cgestor', 'cgestor_in', 'cproducto',
    'cusuario', 'ccanalalt', 'ccanalalt_in', 'cscanalalt', 'cscanalalt_in',
  ];
  for (const key of generalKeys) {
    if (q[key] != null && String(q[key]).trim() !== '') {
      meta[key] = String(q[key]).trim();
    }
  }

  // Si viene selección de productor en body o en state.metadataCanal
  // GET /planes no tiene body: el frontend envia la seleccion por query (appendSsoCanalQuery).
  const rawProductor = b.cproductor ?? stateMeta.cproductor ?? q.cproductor;
  const isSelected = Boolean(
    stateMeta.productorSeleccionado === true
    || (b.cproductor != null && String(b.cproductor).trim() !== '')
    || (q.cproductor != null && String(q.cproductor).trim() !== '')
  );

  const canChoose = puedeElegirProductor(req.nexusMetadata || {});

  if (canChoose && isSelected && rawProductor != null && String(rawProductor).trim() !== '') {
    const prod = String(rawProductor).trim();
    // No enumerable: no viaja al spread de meta hacia los clientes de Nest.
    Object.defineProperty(meta, 'seleccionAplicada', { value: true, enumerable: false });
    meta.cproductor = prod;
    meta.centidad = String(b.centidad ?? stateMeta.centidad ?? q.centidad ?? 'P').trim();
    meta.citem = String(b.citem ?? stateMeta.citem ?? q.citem ?? prod).trim();
  } else if (!hasVerifiedAuth) {
    // Modo standalone local / sin autenticación JWT: fallback a query / body
    const prod = b.cproductor ?? stateMeta.cproductor ?? q.cproductor;
    if (prod != null && String(prod).trim() !== '') meta.cproductor = String(prod).trim();
    const ent = b.centidad ?? stateMeta.centidad ?? q.centidad;
    if (ent != null && String(ent).trim() !== '') meta.centidad = String(ent).trim();
    const item = b.citem ?? stateMeta.citem ?? q.citem;
    if (item != null && String(item).trim() !== '') meta.citem = String(item).trim();
  } else {
    // Con JWT verificado y sin permiso de elección: cproductor, centidad y citem se blindan estrictamente con el JWT
    if (req.nexusMetadata.cproductor) {
      meta.cproductor = String(req.nexusMetadata.cproductor).trim();
      meta.centidad = String(req.nexusMetadata.centidad || 'P').trim();
      meta.citem = String(req.nexusMetadata.citem || req.nexusMetadata.cproductor).trim();
    } else {
      delete meta.cproductor;
      delete meta.centidad;
      delete meta.citem;
    }
  }

  // El ramo del JWT SSO manda; la query/body solo cubre el caso sin metadata.
  if (meta.cramo == null || String(meta.cramo).trim() === '') {
    const cramo = parseInt(String(b.cramo ?? stateMeta.cramo ?? q.cramo ?? ''), 10);
    if (Number.isFinite(cramo)) meta.cramo = cramo;
  } else {
    meta.cramo = Number(meta.cramo);
  }
  return meta;
}

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

// ── GET /planes ─────────────────────────────────────────────────────────────
router.get('/planes', async (req, res) => {
  const meta = patrimonialCanalMeta(req);
  const entity = resolveEntityContext(meta);
  const cramo = Number.isFinite(Number(meta.cramo)) ? Number(meta.cramo) : DEFAULT_RAMO;
  try {
    const { planes } = await patrimonialClient.getPlanesPatrimonial(cramo, {
      ...meta,
      centidad: entity?.centidad || meta.centidad,
      citem: entity?.citem || meta.citem,
    });
    res.json({ success: true, planes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err.httpStatus === 400 ? 400 : 502;
    console.error('[patrimonial/planes]', msg);
    res.status(status).json({
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

  const meta = patrimonialCanalMeta(req);
  const entity = resolveEntityContext(meta);

  const cramo = [body.cramo, body.state?.cramo, body.state?.metadataCanal?.cramo, meta.cramo, DEFAULT_RAMO]
    .map((v) => Number(v))
    .find((v) => Number.isFinite(v) && v > 0);

  const ifrecuencia = String(
    body.ifrecuencia ||
    body.frecuencia ||
    body.state?.rcv?.frecuencia ||
    body.state?.frecuencia ||
    'A',
  ).trim();

  const ptasamon = body.ptasamon != null
    ? Number(body.ptasamon)
    : (body.ptasa != null ? Number(body.ptasa) : (body.state?.quote?.ptasa != null
      ? Number(body.state.quote.ptasa)
      : (body.state?.ptasamon != null ? Number(body.state.ptasamon) : undefined)));

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

  const cproductor = meta.cproductor;
  const centidad = entity?.centidad || meta.centidad || (cproductor ? 'P' : undefined);
  const citem = entity?.citem || meta.citem || (cproductor ? String(cproductor) : undefined);
  // El canal solo se envia a la cotizacion si hubo un productor elegido y autorizado; sin
  // seleccion, el payload queda igual que antes (no depende de que Nest acepte estos campos).
  const canalCotizacion = meta.seleccionAplicada ? { cproductor, centidad, citem } : {};

  try {
    const quote = await patrimonialClient.quoteGeneralRisks({
      cramo,
      cplan,
      ptasamon,
      cuotas,
      ifrecuencia,
      pdescuento,
      precargo,
      ...canalCotizacion,
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
        cproductor,
        centidad,
        citem,
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

  const cplan = bodyPlan || state.selectedPlan?.cplan || state.cplan;
  if (!cplan) {
    return res.status(400).json({
      success: false,
      status: false,
      code: 'MISSING_PLAN',
      message: 'cplan es obligatorio para emitir. Debe venir del plan elegido (SSO/catálogo), no de un valor fijo de laboratorio.',
    });
  }
  const cramo = [state.cramo, state.metadataCanal?.cramo, patrimonialCanalMeta(req).cramo, DEFAULT_RAMO]
    .map((v) => Number(v))
    .find((v) => Number.isFinite(v) && v > 0);
  const ifrecuencia = frecuencia || state.rcv?.frecuencia || state.frecuencia || 'A';
  const ptasamon = state.quote?.ptasa != null
    ? Number(state.quote.ptasa)
    : (state.ptasamon != null ? Number(state.ptasamon) : undefined);
  const cuotas = state.cuotas != null ? Number(state.cuotas) : 1;

  const metaCanal = state.metadataCanal || {};
  const seleccionAplicada = puedeElegirProductor(req.nexusMetadata || {})
    && (rawState?.metadataCanal?.productorSeleccionado === true || rawState?.metadataCanal?.productorSeleccionado === 'true');
  const entity = resolveEntityContext(metaCanal);
  const cproductor = metaCanal.cproductor;
  const centidad = entity?.centidad || metaCanal.centidad || (cproductor ? 'P' : undefined);
  const citem = entity?.citem || metaCanal.citem || (cproductor ? String(cproductor) : undefined);
  const canalCotizacion = seleccionAplicada ? { cproductor, centidad, citem } : {};

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
      ...canalCotizacion,
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
module.exports.handleEmit = handleEmit;
module.exports.handleQuote = handleQuote;
// Expuesto solo para pruebas.
module.exports.patrimonialCanalMeta = patrimonialCanalMeta;
