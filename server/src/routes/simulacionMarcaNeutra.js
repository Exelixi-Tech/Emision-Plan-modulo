/**
 * Simulación del modo marca neutra (MarketPlace Exélixi de prueba) — RCV y Funerario.
 *
 * Se monta en /api ANTES de las rutas reales. Solo actúa si la petición trae
 * X-Exelixi-Marca: neutra (o ?marca=neutra); si no, sale del router sin tocar nada
 * y el comportamiento es el de siempre.
 *
 *   - Permitida (EMISION_SIMULADA_MARCA_NEUTRA=1 y fuera de producción): planes,
 *     cotización, frecuencias, validaciones y emisión responden datos de PRUEBA sin
 *     llamar a nest-api, Sis2000 ni SQL. Sin correo, sin pendientes, sin tarjetas,
 *     sin cobranza, sin feed/expediente.
 *   - Pedida pero NO permitida: las lecturas siguen por la ruta real; la emisión se
 *     rechaza con 403 SIMULACION_NO_PERMITIDA (en modo neutro jamás se emite real).
 *
 * Deja `req.simulacionMarcaNeutra = { pedida, permitido, motivo }` para las rutas reales
 * que necesitan saberlo (p. ej. /funeral/submissions).
 */
const express = require('express');
const { evaluarSimulacionMarcaNeutra, pideMarcaNeutra } = require('../services/simulacionMarcaNeutra');
const datos = require('../lib/datosPruebaMarcaNeutra');

const PATRIMONIAL_CPRODUCTOS = new Set(
  String(process.env.LAMUNDIAL_CPRODUCTO_PATRIMONIAL || '89')
    .split(',').map((c) => c.trim()).filter(Boolean),
);

/** Mismo criterio que routes/emision.js: patrimoniales entran por /policies/*. */
function esPatrimonial(req) {
  const { state } = req.body || {};
  const product = String(state?.product ?? req.body?.product ?? '').trim().toLowerCase();
  if (product === 'patrimoniales' || product === 'patrimonial') return true;
  const cproducto = String(
    req.nexusMetadata?.cproducto
      ?? state?.metadataCanal?.cproducto
      ?? state?.selectedPlan?.cproducto
      ?? req.body?.cproducto
      ?? '',
  ).trim();
  return PATRIMONIAL_CPRODUCTOS.has(cproducto);
}

function log(req, detalle = '') {
  console.log(`[simulacion-marca-neutra] ${req.method} ${req.originalUrl.split('?')[0]}${detalle ? ` ${detalle}` : ''}`);
}

function marcar(res) {
  res.set('X-Exelixi-Simulacion', 'marca-neutra');
  res.set('Cache-Control', 'no-store');
}

function noPermitida(req, res) {
  const motivo = req.simulacionMarcaNeutra?.motivo || 'desconocido';
  console.warn(`[simulacion-marca-neutra] emisión rechazada ${req.originalUrl.split('?')[0]} motivo=${motivo}`);
  return res.status(403).json({
    success: false,
    code: 'SIMULACION_NO_PERMITIDA',
    message:
      'Modo de prueba (marca neutra): la emisión de prueba no está habilitada en este entorno. No se emitió ninguna póliza.',
    motivo,
    stage: 'emit',
  });
}

function noSoportada(req, res) {
  log(req, 'producto sin simulación');
  return res.status(422).json({
    success: false,
    code: 'SIMULACION_PRODUCTO_NO_SOPORTADO',
    message:
      'Modo de prueba (marca neutra): este producto no tiene emisión de prueba. No se emitió ninguna póliza.',
    stage: 'emit',
  });
}

/**
 * @param {{ auth?: Function, env?: object }} [opts] `auth` = nexusAuth (inyectable en tests).
 */
function crearRouterSimulacionMarcaNeutra({ auth, env = process.env } = {}) {
  const requireAuth = auth || require('../middleware/nexusAuth');
  const router = express.Router();

  router.use((req, _res, next) => {
    if (!pideMarcaNeutra({ headers: req.headers, query: req.query })) {
      req.simulacionMarcaNeutra = { pedida: false, permitido: false, motivo: 'sin_marca_neutra' };
      return next('router');
    }
    const { permitido, motivo } = evaluarSimulacionMarcaNeutra({ env, headers: req.headers, query: req.query });
    req.simulacionMarcaNeutra = { pedida: true, permitido, motivo };
    return next();
  });

  /** Lecturas: si no está permitida, siguen por la ruta real (sin pasar dos veces por nexusAuth). */
  const soloPermitida = (req, _res, next) => (req.simulacionMarcaNeutra?.permitido ? next() : next('route'));

  // ── RCV: planes, vigencias, canal, tasa, frecuencias, cotización ──────────
  router.get('/catalogo/planes', soloPermitida, requireAuth, (req, res) => {
    log(req);
    marcar(res);
    res.json({ success: true, planes: datos.planesRcvPrueba(), source: 'simulacion-marca-neutra', simulacion: true });
  });

  router.get('/catalogo/vigencias', soloPermitida, requireAuth, (req, res) => {
    log(req);
    marcar(res);
    res.json({ success: true, data: datos.VIGENCIAS_PRUEBA, simulacion: true });
  });

  router.get('/catalogo/canal-visibility', soloPermitida, requireAuth, (req, res) => {
    log(req);
    marcar(res);
    res.json({ success: true, canalVisibility: null, simulacion: true });
  });

  router.get('/catalogo/tasa-bcv', soloPermitida, requireAuth, (req, res) => {
    log(req);
    marcar(res);
    const fecha = String(req.query.fecha ?? req.query.fmoneda ?? '').trim() || new Date().toISOString().slice(0, 10);
    res.json({ success: true, ptasa: datos.TASA_PRUEBA, fecha, source: 'simulacion-marca-neutra' });
  });

  router.post('/valrep/frecuencia', soloPermitida, requireAuth, (req, res) => {
    log(req, `cplan=${req.body?.cplan ?? ''}`);
    marcar(res);
    res.json({ ok: true, items: datos.FRECUENCIAS_PRUEBA, simulacion: true });
  });

  router.post('/policies/quote', soloPermitida, requireAuth, (req, res, next) => {
    if (esPatrimonial(req)) return next(); // fuera del alcance de la simulación (RCV y Funerario)
    const { state, plan } = req.body || {};
    if (!state || !state.vehicle) {
      return res.status(400).json({ success: false, code: 'MISSING_STATE', message: 'state.vehicle requerido.' });
    }
    const q = datos.cotizacionRcvPrueba(state, plan);
    log(req, `plan=${plan ?? state?.selectedPlan?.cplan ?? ''} usd=${q.mprimaext}`);
    marcar(res);
    return res.json({ success: true, ...q });
  });

  // ── RCV: emisión ──────────────────────────────────────────────────────────
  router.post('/policies/emit', requireAuth, (req, res) => {
    if (!req.simulacionMarcaNeutra?.permitido) return noPermitida(req, res);
    if (esPatrimonial(req)) return noSoportada(req, res);
    const { state, plan } = req.body || {};
    if (!state || !state.vehicle || !state.tomador) {
      return res.status(400).json({ success: false, code: 'MISSING_STATE', message: 'Datos incompletos. Envia { state }.' });
    }
    const cotizada = datos.cotizacionRcvPrueba(state, plan);
    const policy = datos.polizaPrueba('RCV', datos.quoteDesdeState(state, cotizada), new Date(), state.rcv?.frecuencia);
    policy.metadata = { ...cotizada.metadata, ...policy.metadata };
    log(req, `cnpoliza=${policy.cnpoliza}`);
    marcar(res);
    return res.status(201).json({
      success: true,
      simulacion: true,
      message: 'Póliza de prueba emitida (marca neutra). No se emitió en la aseguradora.',
      policy,
    });
  });

  // ── Funerario (personas) ──────────────────────────────────────────────────
  router.get('/personas/planes', soloPermitida, requireAuth, (req, res) => {
    const cramo = req.query.cramo != null ? parseInt(String(req.query.cramo), 10) : 9;
    log(req, `cramo=${cramo}`);
    marcar(res);
    res.json({ success: true, planes: datos.planesPersonasPrueba(cramo), simulacion: true });
  });

  router.post('/personas/cotizacion', soloPermitida, requireAuth, (req, res) => {
    const { cplan } = req.body || {};
    const asegurados = Array.isArray(req.body?.asegurados) ? req.body.asegurados : [];
    if (!cplan) {
      return res.status(400).json({ success: false, code: 'MISSING_PLAN', message: 'cplan es obligatorio' });
    }
    if (asegurados.length === 0) {
      return res.status(400).json({ success: false, code: 'MISSING_INSURED', message: 'Debe enviar al menos un asegurado' });
    }
    const q = datos.cotizacionPersonasPrueba(asegurados.length);
    log(req, `cplan=${cplan} asegurados=${asegurados.length} usd=${q.mprimaext}`);
    marcar(res);
    return res.json({ success: true, ...q, simulacion: true });
  });

  router.post('/personas/poliza-vigente', soloPermitida, requireAuth, (req, res) => {
    log(req);
    marcar(res);
    res.json({
      success: true,
      blocked: false,
      simulacion: true,
      message: 'Modo de prueba: no se consultan pólizas vigentes.',
    });
  });

  router.post('/personas/validacion', soloPermitida, requireAuth, (req, res) => {
    const { state } = req.body || {};
    if (!state || !state.tomador) {
      return res.status(400).json({ success: false, code: 'MISSING_STATE', message: 'state.tomador requerido.', stage: 'validate' });
    }
    log(req);
    marcar(res);
    return res.json({ success: true, validation: { status: true, simulacion: true } });
  });

  router.post('/personas/emision', requireAuth, (req, res) => {
    if (!req.simulacionMarcaNeutra?.permitido) return noPermitida(req, res);
    const { state } = req.body || {};
    if (!state || !state.tomador) {
      return res.status(400).json({ success: false, code: 'MISSING_STATE', message: 'state.tomador requerido.' });
    }
    if (!state.selectedPlan?.cplan) {
      return res.status(400).json({ success: false, code: 'MISSING_PLAN', message: 'Debe seleccionar un plan (selectedPlan.cplan).' });
    }
    const n = Array.isArray(state.funeral?.asegurados) && state.funeral.asegurados.length
      ? state.funeral.asegurados.length
      : 1;
    const policy = datos.polizaPrueba('FUN', datos.quoteDesdeState(state, datos.cotizacionPersonasPrueba(n)), new Date(), state.funeral?.frecuencia);
    log(req, `cnpoliza=${policy.cnpoliza}`);
    marcar(res);
    return res.status(201).json({
      success: true,
      simulacion: true,
      message: 'Póliza de prueba emitida (marca neutra). No se emitió en la aseguradora.',
      policy,
    });
  });

  // ── Otras emisiones: en modo neutro nunca se emite real ───────────────────
  router.post(['/exelixi/emit', '/patrimonial/emision', '/patrimonial/generalRisks'], requireAuth, (req, res) => {
    if (!req.simulacionMarcaNeutra?.permitido) return noPermitida(req, res);
    return noSoportada(req, res);
  });

  return router;
}

module.exports = { crearRouterSimulacionMarcaNeutra };
