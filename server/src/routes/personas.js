/**
 * Rutas del producto Funerario (personas) — ramo 9.
 *
 *   GET  /api/personas/planes?cramo=9   → planes del canal SSO (no lista fija)
 *   POST /api/personas/cotizacion       → cotización (getCotizacionPer)
 *   POST /api/personas/validacion       → póliza vigente (paso 4, antes del técnico)
 *   POST /api/personas/emision          → cotiza + valida + emite (pasos 4–6)
 *
 * Estas rutas hablan con nest-api (módulo personas, QA por defecto) vía
 * personasClient.js. Multi-tenant: protegidas por nexusAuth (montadas en index.js).
 */
const express = require('express');
const personasClient = require('../services/personasClient');
const personasMapper = require('../services/personasMapper');
const { resolveNedadAsegurado } = personasMapper;
const { assertPersonasCanEmit } = require('../services/assertPersonasCanEmit');
const { resolveIngresoCajaAfterPayment } = require('../services/collectionAfterPayment');
const {
  recordFuneralEmissionFlexible,
} = require('../services/nexusFuneralSubmission');
const { registerIssuedPolicy } = require('../services/nexusEmisionFeed');
const { archiveExpedienteAfterEmit } = require('../services/expedienteArchive');
const { resolveEntityContext } = require('../services/canalClient');
const { isPersonasCplan, resolvePersonasCramo } = require('../lib/funerarioPlan');
const { fetchPlanesV2 } = require('../services/planesClient');
const { resolveQuestionsForPlan } = require('../config/funeralHealthQuestions');
const { adjustPremiumByAnswers } = require('../lib/healthPremiumAdjust');
const { registerPolicyProveedorViaNestApi } = require('../services/nestApiClient');

function asRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

/** Refs para persistir la póliza en Nexus (cualquier empresa). */
function resolveFuneralRefs(state) {
  const payload = asRecord(state?.checkoutPayload);
  const canal = asRecord(state?.metadataCanal);
  return {
    submissionId: String(
      state?.funeralSubmissionId
      || payload.funeralSubmissionId
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

/** Fusiona metadata SSO del JWT (nexusAuth) en state.metadataCanal — igual que RCV. */
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

const router = express.Router();

const DEFAULT_RAMO = parseInt(process.env.LAMUNDIAL_RAMO_PERSON, 10) || 9;

/** Ramos con prima por días (viajero ramo 5 y viaje local ramo 25). */
const VIAJERO_RAMOS = new Set([5, 25]);

/** Productos Viajero (25) y Viajero Local (26): planes por producto con ndias (maplanes_frec). */
const VIAJERO_PRODUCTOS = new Set(['25', '26']);

/** Fraccionadas: Pagos aún cobra la prima anual en personas, así que se emite Anual. */
const FRECUENCIAS_FRACCIONADAS = new Set(['M', 'T', 'S', 'C']);

function personasIfrecuencia(code) {
  const c = String(code || 'A').trim().toUpperCase().charAt(0) || 'A';
  return FRECUENCIAS_FRACCIONADAS.has(c) ? 'A' : c;
}

/** Viajero: vigencia desde hoy por los días del plan (igual que la cotización del wizard). */
function resolveViajeroVigencia(selectedPlan, cramo) {
  if (!VIAJERO_RAMOS.has(Number(cramo))) return null;
  let ndias = Number(selectedPlan?.ndias);
  if (!Number.isFinite(ndias) || ndias <= 0) {
    const m = String(selectedPlan?.name ?? selectedPlan?.tag ?? '').match(/(\d+)\s*d[ií]as?/i);
    ndias = m ? Number(m[1]) : NaN;
  }
  if (!Number.isFinite(ndias) || ndias <= 0) return null;
  const fdesde = personasMapper._internal.todayYmd();
  const hasta = new Date(`${fdesde}T00:00:00Z`);
  hasta.setUTCDate(hasta.getUTCDate() + ndias - 1);
  return { ndias, fdesde, fhasta: hasta.toISOString().slice(0, 10) };
}

/** Fusiona metadata JWT con query (mismo criterio que RCV /catalogo/planes). */
function funeralCanalMeta(req) {
  const meta = { ...(req.nexusMetadata || {}) };
  const q = req.query || {};
  const keys = [
    'centidad', 'citem', 'cgestor', 'cgestor_in', 'cproducto', 'cproductor',
    'cusuario', 'ccanalalt', 'ccanalalt_in', 'cscanalalt', 'cscanalalt_in',
  ];
  for (const key of keys) {
    if (q[key] != null && String(q[key]).trim() !== '') {
      meta[key] = String(q[key]).trim();
    }
  }
  if (q.cramo != null && String(q.cramo).trim() !== '') {
    const cramo = parseInt(String(q.cramo), 10);
    if (Number.isFinite(cramo)) meta.cramo = cramo;
  }
  return meta;
}

/**
 * Normaliza un asegurado del front al formato de la API:
 *   { cparen, xrif_asegurado, nedad_asegurado }
 * Acepta tanto el formato API como el formato amigable del wizard.
 */
function mapAsegurado(a) {
  const cparen = Number(a.cparen ?? a.parentesco ?? 0) || 0;
  const xrif = String(a.xrif_asegurado ?? a.identificacion ?? '').replace(/\D/g, '');
  return { cparen, xrif_asegurado: xrif, nedad_asegurado: resolveNedadAsegurado(a) };
}

// ── GET /planes ─────────────────────────────────────────────────────────────
router.get('/planes', async (req, res) => {
  const meta = funeralCanalMeta(req);
  const askedRamo = req.query.cramo != null ? parseInt(String(req.query.cramo), 10) : NaN;
  // Scoring de Vida (1) y Accidentes personales (5): el catálogo del ramo,
  // sin el producto funerario 57 que siempre consulta el ramo 45.
  // Viajero (25/26) también es ramo 5, pero sus planes van por producto (ndias).
  const viajeroProducto = VIAJERO_PRODUCTOS.has(String(meta.cproducto ?? '').trim());
  if (req.query.catalogo === 'ramo' || (!viajeroProducto && (askedRamo === 1 || askedRamo === 5))) {
    try {
      const targetRamo = Number.isFinite(askedRamo) ? askedRamo : 1;
      const result = await fetchPlanesV2({ ...meta, cramo: targetRamo });
      const planes = (result.planes || []).filter((p) => Number(p.cramo) === targetRamo);
      res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache',
        Expires: '0',
      });
      return res.json({
        success: true,
        planes,
        canal: { cramo: targetRamo, catalogo: 'ramo' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[personas/planes] catalogo ramo', askedRamo, msg);
      return res.status(502).json({
        success: false,
        code: 'PLANES_RAMO_ERROR',
        message: `No se pudieron obtener los planes del ramo ${askedRamo}: ${msg}`,
      });
    }
  }

  const rawEntity = resolveEntityContext(meta);
  const sisOk = rawEntity
    && (rawEntity.centidad === 'P' || rawEntity.centidad === 'C' || rawEntity.centidad === 'G');
  const entity = sisOk ? rawEntity : null;
  const productorRaw = meta.cproductor != null ? String(meta.cproductor).trim() : '';
  const cproductor = productorRaw && productorRaw !== '80080' ? productorRaw : null;
  const metaCproducto = meta.cproducto != null && String(meta.cproducto).trim() !== '' ? String(meta.cproducto).trim() : null;
  const cproducto = metaCproducto || req.query.cproducto || (process.env.LAMUNDIAL_PRODUCTO_FUNERARIO || '57');
  const cramo = cproducto === '57'
    ? 45
    : (meta.cramo ? parseInt(meta.cramo, 10) : (req.query.cramo ? parseInt(req.query.cramo, 10) : DEFAULT_RAMO));
  try {
    const { planes: raw } = await personasClient.getPlanesPer({
      cramo,
      citem: entity?.citem || meta.citem,
      centidad: entity?.centidad || meta.centidad,
      cproducto,
      cproductor,
      cusuario: meta.cusuario,
      cgestor_in: meta.cgestor_in,
      cgestor: meta.cgestor,
    });
    const planes = Array.isArray(raw) ? raw : [];
    console.log(
      `[personas/planes] valrep/planes/producto cproducto=${cproducto} centidad=${entity?.centidad || meta.centidad || '?'} citem=${entity?.citem || meta.citem || '?'} cproductor=${cproductor || 'null'} cusuario=${meta.cusuario || 'none'} n=${planes.length}`,
    );

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      Expires: '0',
    });
    return res.json({
      success: true,
      planes,
      canal: {
        centidad: entity?.centidad || meta.centidad || null,
        citem: entity?.citem || meta.citem || null,
        cproductor: cproductor,
        cusuario: meta.cusuario || null,
        cramo,
        cproducto,
        ccanalalt: meta.ccanalalt_in || meta.ccanalalt || null,
        cscanalalt: meta.cscanalalt_in || meta.cscanalalt || null,
        cgestor_in: meta.cgestor_in || null,
        cgestor: meta.cgestor || null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[personas/planes]', msg);
    return res.status(err.httpStatus || 502).json({
      success: false,
      code: err.code || 'LAMUNDIAL_PERSON_ERROR',
      message: `No se pudieron obtener los planes de personas: ${msg}`,
    });
  }
});

// ── POST /cotizacion ──────────────────────────────────────────────────────────
router.post('/cotizacion', async (req, res) => {
  const { cplan, ifrecuencia, ndias, fdesde, fhasta } = req.body || {};
  const quoteProducto = String(req.nexusMetadata?.cproducto ?? '').trim();
  const cramo = resolvePersonasCramo({
    // Otro producto que no es funerario: manda el ramo del plan (body), no el del producto SSO.
    ...(quoteProducto && quoteProducto !== '57' ? { selectedPlan: { cramo: req.body?.cramo } } : {}),
    bodyCramo: req.body?.cramo,
    metadataCanal: req.nexusMetadata,
    cproducto: req.nexusMetadata?.cproducto,
  });
  const asegurados = Array.isArray(req.body?.asegurados) ? req.body.asegurados.map(mapAsegurado) : [];

  if (!cplan) {
    return res.status(400).json({ success: false, code: 'MISSING_PLAN', message: 'cplan es obligatorio' });
  }
  if (!isPersonasCplan(cplan, req.nexusMetadata?.cproducto)) {
    return res.status(400).json({
      success: false,
      code: 'PLAN_NOT_PERSONAS',
      message: `El plan ${cplan} no es válido para el producto personas.`,
    });
  }
  if (asegurados.length === 0) {
    return res.status(400).json({ success: false, code: 'MISSING_INSURED', message: 'Debe enviar al menos un asegurado' });
  }
  const invalid = asegurados.find((a) => !a.xrif_asegurado || a.nedad_asegurado == null);
  if (invalid) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_INSURED',
      message: 'Cada asegurado requiere identificación y fecha de nacimiento válidas',
    });
  }

  try {
    const quote = await personasClient.getCotizacionPer({
      cramo,
      cplan,
      asegurados,
      ifrecuencia,
      ...(ndias != null && Number(ndias) > 0 ? { ndias: Number(ndias) } : {}),
      ...(fdesde ? { fdesde: String(fdesde).trim() } : {}),
      ...(fhasta ? { fhasta: String(fhasta).trim() } : {}),
    });
    res.json({
      success: true,
      mprima: quote.mprima,
      mprimaext: quote.mprimaext,
      ptasa: quote.ptasa,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const edades = asegurados
      .map((a) => `${a.xrif_asegurado || '?'} (${a.nedad_asegurado} años, parentesco ${a.cparen})`)
      .join('; ');
    console.error('[personas/cotizacion]', msg, edades);
    const isAge = /criterios de edad/i.test(msg);
    res.status(isAge ? 422 : 502).json({
      success: false,
      code: err.code || (isAge ? 'PERSONAS_AGE' : 'LAMUNDIAL_PERSON_ERROR'),
      message: `No se pudo cotizar: ${msg}${edades ? ` Edad calculada: ${edades}.` : ''}`,
    });
  }
});

// ── POST /poliza-vigente ──────────────────────────────────────────────────────
router.post('/poliza-vigente', async (req, res) => {
  const rif = String(req.body?.rif ?? req.body?.identificacion ?? '').replace(/\D/g, '');
  const cramo = req.body?.cramo != null ? Number(req.body.cramo) : DEFAULT_RAMO;
  if (rif.length < 6) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_CEDULA',
      message: 'La cédula debe tener al menos 6 dígitos.',
    });
  }
  try {
    const result = await personasClient.checkPolizaVigente({ rif, cramo });
    if (result.hasVigente) {
      return res.json({
        success: true,
        blocked: true,
        code: 'PERSONAS_DUPLICATE',
        cnpoliza: result.cnpoliza,
        message: 'Ya existe una póliza funeraria vigente para esta cédula.',
      });
    }
    return res.json({
      success: true,
      blocked: false,
      message: 'No hay póliza funeraria vigente para esta cédula.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[personas/poliza-vigente]', msg);
    return res.status(err.httpStatus || 502).json({
      success: false,
      code: err.code || 'PERSONAS_POLIZA_CHECK_ERROR',
      message: msg,
    });
  }
});

// ── POST /validacion ──────────────────────────────────────────────────────────
router.post('/validacion', async (req, res) => {
  const { state, plan: bodyPlan } = req.body || {};
  const mergedState = withNexusMetadata(state, req.nexusMetadata);
  const cplan = bodyPlan || mergedState?.selectedPlan?.cplan;

  try {
    const validation = await assertPersonasCanEmit(mergedState, { plan: cplan });
    res.json({ success: true, validation: validation.result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const httpStatus = err.httpStatus || 502;
    console.error('[personas/validacion]', msg);
    res.status(httpStatus).json({
      success: false,
      code: err.code || 'PERSONAS_VALIDATION_ERROR',
      message: msg,
      stage: 'validate',
    });
  }
});

// ── POST /emision ─────────────────────────────────────────────────────────────
// Flujo completo: cotiza (spCalculoPer) → valida (speeValidatePersonGeneral) →
// emite la póliza (vista eePoliza_Personas_General) vía nest-api.
// Recibe el estado del wizard: { state: { tomador, funeral, selectedPlan }, frecuencia? }
router.post('/emision', async (req, res) => {
  const { state: rawState, frecuencia } = req.body || {};
  const state = withNexusMetadata(rawState, req.nexusMetadata);
  const funeral = state?.funeral || {};
  const cplan = state?.selectedPlan?.cplan;
  const cramo = resolvePersonasCramo({
    selectedPlan: state?.selectedPlan,
    metadataCanal: state?.metadataCanal,
    cproducto: state?.metadataCanal?.cproducto,
  });

  if (!state || !state.tomador) {
    return res.status(400).json({ success: false, code: 'MISSING_STATE', message: 'state.tomador requerido.' });
  }
  if (!cplan) {
    return res.status(400).json({ success: false, code: 'MISSING_PLAN', message: 'Debe seleccionar un plan funerario (selectedPlan.cplan).' });
  }
  if (!isPersonasCplan(cplan, state?.metadataCanal?.cproducto)) {
    return res.status(400).json({
      success: false,
      code: 'PLAN_NOT_PERSONAS',
      message: `El plan ${cplan} no es válido para el producto personas.`,
    });
  }

  const ifrecuencia = personasIfrecuencia(frecuencia || funeral.frecuencia);
  const vigencia = resolveViajeroVigencia(state.selectedPlan, cramo);
  const asegurados = personasMapper.buildAseguradosForQuote(funeral, {
    tomador: state.tomador,
    asegurado: state.asegurado,
    sameInsured: state.sameInsured,
  });

  if (asegurados.length === 0) {
    return res.status(400).json({ success: false, code: 'MISSING_INSURED', message: 'Debe registrar al menos un asegurado.' });
  }
  const invalid = asegurados.find((a) => !a.xrif_asegurado || a.nedad_asegurado == null);
  if (invalid) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_INSURED',
      message: 'Cada asegurado requiere identificación y fecha de nacimiento válidas.',
    });
  }

  try {
    // 1. Cotiza para obtener la prima autoritativa.
    let cotizacion = await personasClient.getCotizacionPer({ cramo, cplan, asegurados, ifrecuencia, ...(vigencia ?? {}) });

    // 1b. Recargos/descuentos del cuestionario (mismo cálculo que la solicitud).
    //     La prima ajustada es la que se cobra (ingreso de caja / registro). A Sis2000 va la
    //     prima base y el % de cada asegurado: el SP v3 aplica el % por tarifa en pepoltar_ind.
    const cotizacionBase = cotizacion;
    const meta0 = state.metadataCanal || {};
    const { questions } = await resolveQuestionsForPlan(cplan, {
      empresaId: Number(req.empresa?.id ?? process.env.EMPRESA_ID ?? 1) || 1,
      metadata: meta0,
      cramo,
      cproducto: meta0.cproducto,
      selectedPlan: state.selectedPlan,
    });
    const premiumAdjust = await adjustPremiumByAnswers({
      questions,
      persons: funeral.asegurados,
      asegurados,
      byInsured: funeral.healthAnswersByInsured,
      quoteOne: (aseg) =>
        personasClient.getCotizacionPer({ cramo, cplan, asegurados: [aseg], ifrecuencia, ...(vigencia ?? {}) }),
    });
    if (premiumAdjust) {
      console.log(
        `[personas/emision] prima ajustada por cuestionario base=${premiumAdjust.base.mprimaext} final=${premiumAdjust.quote.mprimaext}`,
      );
      cotizacion = { ...cotizacion, ...premiumAdjust.quote, ptasa: premiumAdjust.quote.ptasa || cotizacion.ptasa };
    }

    // 2. Valida titular/plan (paso 5 — speeValidatePersonGeneral).
    const validatePayload = personasMapper.buildValidateEmissionPersonRequest(state, {
      plan: cplan,
      frecuencia: ifrecuencia,
    });
    if (!validatePayload.rif_titular || !validatePayload.fnac_titular) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TITULAR',
        message: 'Titular requiere identificación y fecha de nacimiento válidas.',
        stage: 'validate',
      });
    }
    await personasClient.validateEmissionPerson(validatePayload);

    // 3. Construye el payload de emisión y emite.
    const { payload, metadata } = personasMapper.buildEmissionPersonRequest(
      state,
      cotizacionBase,
      { plan: cplan, frecuencia: ifrecuencia },
    );
    if (vigencia) {
      payload.fdesde = vigencia.fdesde;
      payload.fhasta = vigencia.fhasta;
    }
    // % de recargo/descuento por asegurado (mismo orden que funeral.asegurados; el 0 es el titular).
    if (premiumAdjust && Array.isArray(payload.asegurados)) {
      premiumAdjust.porAsegurado.forEach((row, idx) => {
        const aseg = payload.asegurados[idx];
        if (!aseg) return;
        if (row.recargoPct > 0) aseg.precargo = row.recargoPct;
        if (row.descuentoPct > 0) aseg.pdescuento = row.descuentoPct;
      });
      const titular = premiumAdjust.porAsegurado[0];
      if (titular?.recargoPct > 0) payload.precargo_titular = titular.recargoPct;
      if (titular?.descuentoPct > 0) payload.pdescuento_titular = titular.descuentoPct;
    }

    const meta = state.metadataCanal || {};
    console.log(
      `[personas/emision] metadataCanal cproductor=${meta.cproductor ?? 'default'} cusuario=${meta.cusuario ?? 'default'} canal=${meta.canal ?? 'default'} cgestor_in=${meta.cgestor_in ?? 'none'} jwtKeys=${Object.keys(req.nexusMetadata || {}).join(',') || 'none'}`,
    );

    const emitted = await personasClient.createEmissionPerson(payload);

    // Registro de proveedor en póliza si vino en el estado
    let proveedorResult = null;
    if (state?.selectedProveedor || state?.cproveedor) {
      const proveedorPayload = personasMapper.buildRegisterPolicyProveedorRequest(
        state,
        emitted,
        cotizacionBase,
        {
          plan: cplan,
          ...(vigencia ? { fdesde: vigencia.fdesde, fhasta: vigencia.fhasta } : {}),
        },
      );
      if (proveedorPayload && proveedorPayload.cci_rif) {
        try {
          proveedorResult = await registerPolicyProveedorViaNestApi(proveedorPayload);
          console.log(
            `[personas/emision] Proveedor registrado en póliza ${emitted.cnpoliza}:`,
            proveedorResult,
          );
        } catch (provErr) {
          console.warn(
            '[personas/emision] Error al registrar proveedor en póliza:',
            provErr?.message || provErr,
          );
        }
      }
    }

    await archiveExpedienteAfterEmit({
      state,
      emission: emitted,
      empresaNombre: req.empresa?.nombre,
      authToken: req.nexusToken,
    });

    const emitMetadata = { ...metadata };
    const url_ingreso_caja = await resolveIngresoCajaAfterPayment(state, {
      cnrecibo: emitted.cnrecibo,
      mpagoFallback: cotizacion.mprima,
      metadata: emitMetadata,
    });
    if (url_ingreso_caja) {
      console.log(`[personas/emision] URL ingreso caja: ${url_ingreso_caja}`);
    }

    const emissionRecord = {
      cnpoliza: emitted.cnpoliza,
      cnrecibo: emitted.cnrecibo,
      urlpoliza: emitted.urlpoliza,
      url_ingreso_caja,
      emittedAt: new Date().toISOString(),
      quote: {
        mprima: cotizacion.mprima,
        mprimaext: cotizacion.mprimaext,
        ptasa: cotizacion.ptasa,
      },
      ...(proveedorResult ? { proveedor: proveedorResult } : {}),
      /** Detalle interno: prima base, % por asegurado y preguntas que lo generaron. */
      ...(premiumAdjust ? { premiumAdjust } : {}),
    };
    const funeralRefs = resolveFuneralRefs(state);
    try {
      await registerIssuedPolicy({
        empresaId: req.empresa?.id,
        producto: 'funerario',
        emission: emissionRecord,
        state,
        planNombre: cplan,
        frecuencia: ifrecuencia,
      });
    } catch (feedErr) {
      console.warn('[personas/emision] feed Nexus:', feedErr?.message || feedErr);
    }
    try {
      const saved = await recordFuneralEmissionFlexible(funeralRefs, emissionRecord);
      if (!saved) {
        console.warn(
          `[personas/emision] póliza ${emissionRecord.cnpoliza} sin historial`
          + ` (id=${funeralRefs.submissionId || '-'} sid=${funeralRefs.paymentSid || '-'}`
          + ` session=${funeralRefs.sessionId || '-'})`,
        );
      } else {
        console.log(
          `[personas/emision] historial funerario id=${saved.id} empresa=${saved.empresaId}`
          + ` cnpoliza=${saved.cnpoliza}`,
        );
      }
    } catch (err) {
      console.warn('[personas/emision] no se pudo guardar URL en historial:', err?.message || err);
    }

    return res.status(201).json({
      success: true,
      message: 'Póliza funeraria emitida exitosamente.',
      policy: {
        number: emitted.cnpoliza,
        cnpoliza: emitted.cnpoliza,
        cnrecibo: emitted.cnrecibo,
        urlpoliza: emitted.urlpoliza,
        url_ingreso_caja,
        ncuota: emitted.ncuota,
        internalPolicyId: metadata.internalPolicyId,
        emittedAt: new Date().toISOString(),
        quote: {
          mprima: cotizacion.mprima,
          mprimaext: cotizacion.mprimaext,
          ptasa: cotizacion.ptasa,
        },
        ...(proveedorResult ? { proveedor: proveedorResult } : {}),
        metadata: emitMetadata,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const httpStatus = err.httpStatus || 502;
    console.error('[personas/emision]', err.code || '', msg);
    return res.status(httpStatus).json({
      success: false,
      code: err.code || 'LAMUNDIAL_PERSON_ERROR',
      message: msg,
      ...(err.endpoint ? { endpoint: err.endpoint } : {}),
      stage: 'emit',
    });
  }
});

module.exports = router;
