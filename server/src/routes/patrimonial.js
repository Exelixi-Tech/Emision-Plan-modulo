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

const router = express.Router();
const DEFAULT_RAMO = patrimonialClient.DEFAULT_RAMO || 28;

function decodeJwtMetadata(token) {
  if (!token || typeof token !== 'string') return {};
  try {
    const part = token.replace(/^Bearer\s+/i, '').split('.')[1];
    if (!part) return {};
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  } catch {
    return {};
  }
}

function preferGestorCode(...vals) {
  const codes = vals
    .map((v) => (v != null ? String(v).trim() : ''))
    .filter(Boolean);
  if (!codes.length) return '';
  return codes.find((c) => c.includes('-')) || codes[0];
}

/** Ids de rol (serol.crol) de productor/corredor, configurables con CROL_PRODUCTOR (lista separada por comas). */
const CROLES_PRODUCTOR = String(process.env.CROL_PRODUCTOR ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter((v) => v !== '')
  .map(Number)
  .filter((n) => Number.isInteger(n));

function puedeElegirProductor(meta) {
  const origen = String(meta?.origen ?? meta?.source ?? '').trim().toLowerCase();
  // 1- Si entra con origen = 'marketplace' o que no sea origen = 'backoffice', debe devolver falso
  if (origen === 'marketplace' || origen !== 'backoffice') {
    return false;
  }

  const productor = String(meta?.cproductor ?? '').trim();
  const crol = meta?.crol != null && String(meta.crol).trim() !== '' ? Number(meta.crol) : NaN;

  // Si tiene un rol explícito de productor/corredor configurado, no puede elegir otro
  if (Number.isFinite(crol) && CROLES_PRODUCTOR.includes(crol)) {
    return false;
  }

  // Si viene con un productor específico asignado (distinto de 80080):
  if (productor !== '' && productor !== '80080') {
    // En backoffice solo usuarios internos (no productores) pueden elegir
    if (origen === 'backoffice') {
      return Number.isFinite(crol) && !CROLES_PRODUCTOR.includes(crol);
    }
    return false;
  }

  // Productor de sesión genérico (80080) o vacío:
  return true;
}

function patrimonialCanalMeta(req) {
  const meta = { ...(req.nexusMetadata || {}) };
  const q = req.query || {};
  const b = req.body || {};
  const stateMeta = b.state?.metadataCanal || {};

  const keys = [
    'centidad', 'citem', 'cgestor', 'cgestor_in', 'cproducto', 'cproductor',
    'cusuario', 'ccanalalt', 'ccanalalt_in', 'cscanalalt', 'cscanalalt_in',
  ];
  for (const key of keys) {
    if (q[key] != null && String(q[key]).trim() !== '') {
      meta[key] = String(q[key]).trim();
    }
  }

  // Si viene selección de productor en body o en state.metadataCanal
  const rawProductor = b.cproductor ?? stateMeta.cproductor;
  const isSelected = Boolean(
    stateMeta.productorSeleccionado === true
    || (b.cproductor != null && String(b.cproductor).trim() !== '')
  );

  const canChoose = puedeElegirProductor({ ...meta, cproductor: req.nexusMetadata?.cproductor });
  const allowSelection = !req.nexusMetadata?.cproductor || req.nexusMetadata?.cproductor === '80080' || canChoose;

  if (allowSelection && isSelected && rawProductor != null && String(rawProductor).trim() !== '') {
    const prod = String(rawProductor).trim();
    meta.cproductor = prod;
    meta.centidad = String(b.centidad ?? stateMeta.centidad ?? 'P').trim();
    meta.citem = String(b.citem ?? stateMeta.citem ?? prod).trim();
  } else {
    if (b.centidad != null && String(b.centidad).trim() !== '') meta.centidad = String(b.centidad).trim();
    if (b.citem != null && String(b.citem).trim() !== '') meta.citem = String(b.citem).trim();
    if (b.cproductor != null && String(b.cproductor).trim() !== '' && !meta.cproductor) {
      meta.cproductor = String(b.cproductor).trim();
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

/** Fusiona metadata SSO del JWT (nexusAuth) + tokens del state, respetando la selección del productor. */
function withNexusMetadata(state, nexusMetadata) {
  if (!state || typeof state !== 'object') return state;
  const actorKeys = ['cgestor', 'cgestor_in', 'centidad', 'citem', 'cproductor', 'ccanalalt_in', 'cscanalalt_in', 'ccanalalt', 'cscanalalt'];
  const sources = [];
  if (nexusMetadata && typeof nexusMetadata === 'object') sources.push(nexusMetadata);
  if (state.metadataCanal && typeof state.metadataCanal === 'object') sources.push(state.metadataCanal);
  sources.push(state);
  for (const key of ['nexus_token', 'nexusToken']) {
    if (typeof state[key] === 'string') sources.push(decodeJwtMetadata(state[key]));
  }

  const mergedMeta = { ...(state.metadataCanal || {}), ...(nexusMetadata || {}) };
  // Si el usuario eligió productor en el selector, se emite con ese productor (no con el del token).
  const usaSeleccion = puedeElegirProductor({ ...mergedMeta, cproductor: nexusMetadata?.cproductor })
    && state.metadataCanal?.productorSeleccionado === true;
  const seleccionKeys = new Set(['cproductor', 'centidad', 'citem']);
  for (const key of actorKeys) {
    if (usaSeleccion && seleccionKeys.has(key)) {
      if (key === 'cproductor' && state.metadataCanal?.cproductor) {
        mergedMeta.cproductor = String(state.metadataCanal.cproductor).trim();
        continue;
      }
      if (key === 'centidad') {
        mergedMeta.centidad = String(state.metadataCanal?.centidad ?? 'P').trim();
        continue;
      }
      if (key === 'citem') {
        mergedMeta.citem = String(state.metadataCanal?.citem ?? state.metadataCanal?.cproductor ?? '').trim();
        continue;
      }
    }
    const vals = sources.map((src) => src?.[key]);
    const val = (key === 'cgestor' || key === 'cgestor_in')
      ? preferGestorCode(...vals)
      : (vals.find((v) => v != null && String(v).trim() !== '') ?? '');
    if (val) mergedMeta[key] = val;
  }

  const gestor = mergedMeta.cgestor != null ? String(mergedMeta.cgestor).trim() : '';
  return { ...state, metadataCanal: mergedMeta, ...(gestor ? { cgestor: gestor } : {}) };
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

  try {
    const quote = await patrimonialClient.quoteGeneralRisks({
      cramo,
      cplan,
      ptasamon,
      cuotas,
      ifrecuencia,
      pdescuento,
      precargo,
      cproductor,
      centidad,
      citem,
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
  const entity = resolveEntityContext(metaCanal);
  const cproductor = metaCanal.cproductor;
  const centidad = entity?.centidad || metaCanal.centidad || (cproductor ? 'P' : undefined);
  const citem = entity?.citem || metaCanal.citem || (cproductor ? String(cproductor) : undefined);

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
      cproductor,
      centidad,
      citem,
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
