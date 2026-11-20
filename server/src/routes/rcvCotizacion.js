/**
 * Rutas del flujo "Emitir RCV desde cotización" (SysIP → SSO con cotizacionID en la metadata del token).
 *
 *   GET  /api/rcv-cotizacion/actual   → cotización del token, si se puede emitir, opciones y frecuencias
 *   POST /api/rcv-cotizacion/checkout → { opcion, frecuencia, vehicle } → monto del 1er recibo + comprobante
 *   POST /api/policies/emit           → SOLO si el token trae cotizacionID o el state trae el comprobante
 *                                       (rcv.cotizacionRcv); si no, next() y sigue la emisión RCV de siempre.
 *
 * El número de cotización sale solo de req.nexusMetadata (token validado por nexusAuth), nunca de la URL.
 */
const express = require('express');
const service = require('../services/rcvCotizacionService');
const { readCotizacionId } = require('../lib/rcvCotizacion');
const { withNexusMetadata } = require('./emision');
const { archiveExpedienteAfterEmit } = require('../services/expedienteArchive');
const { registerIssuedPolicy } = require('../services/nexusEmisionFeed');

function send(res, err, stage) {
  const known = err?.name === 'CotizacionFlowError' || /^COTIZACION_|^TASA_/.test(String(err?.code || ''));
  if (!known) {
    console.error(`[rcv-cotizacion/${stage}] uncaught:`, err);
    return res.status(500).json({ success: false, code: 'INTERNAL', message: 'Error interno en la emisión desde cotización.', stage });
  }
  const status = err.httpStatus || 502;
  console.warn(`[rcv-cotizacion/${stage}] ${err.code} ${status} ${err.message}`);
  return res.status(status).json({
    success: false,
    code: err.code,
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
    ...(err.internalPolicyId ? { internalPolicyId: err.internalPolicyId } : {}),
    stage,
  });
}

function requireCotizacionId(req, res) {
  const cproces = readCotizacionId(req.nexusMetadata);
  if (!cproces) {
    res.status(403).json({
      success: false,
      code: 'COTIZACION_SIN_TOKEN',
      message: 'La sesión no trae una cotización. Abre la cotización desde SysIP.',
    });
    return null;
  }
  return cproces;
}

/** Router montado en /api/rcv-cotizacion. */
const router = express.Router();

router.get('/actual', async (req, res) => {
  const cproces = requireCotizacionId(req, res);
  if (!cproces) return undefined;
  try {
    const vista = await service.getVista(cproces);
    return res.json({ success: true, ...vista });
  } catch (err) {
    return send(res, err, 'actual');
  }
});

router.post('/checkout', async (req, res) => {
  const cproces = requireCotizacionId(req, res);
  if (!cproces) return undefined;
  try {
    const { opcion, frecuencia, vehicle, tomador } = req.body || {};
    const out = await service.prepararPago(cproces, { opcion, frecuencia, vehicle, tomador });
    return res.json({ success: true, ...out });
  } catch (err) {
    return send(res, err, 'checkout');
  }
});

/**
 * Router montado en /api ANTES del de emisión RCV: intercepta POST /policies/emit solo para este flujo.
 * Sin cotizacionID en el token y sin comprobante en el state → next() (comportamiento de siempre).
 */
const emitGuard = express.Router();

emitGuard.post('/policies/emit', async (req, res, next) => {
  const tokenCproces = readCotizacionId(req.nexusMetadata);
  const state = req.body?.state;
  const marker = state?.rcv?.cotizacionRcv;
  if (!tokenCproces && !marker) return next();

  try {
    if (!marker || !state?.vehicle || !state?.tomador) {
      return res.status(400).json({
        success: false,
        code: 'COTIZACION_DATOS_INCOMPLETOS',
        message: 'Faltan los datos de la emisión desde cotización. Completa los pasos de Emisión antes de pagar.',
        stage: 'emit',
      });
    }
    const mergedState = withNexusMetadata(state, req.nexusMetadata);
    const result = await service.emitirDesdeCotizacion({ tokenCproces, state: mergedState });

    const expediente = await archiveExpedienteAfterEmit({
      state: mergedState,
      emission: result,
      empresaNombre: req.empresa?.nombre,
      empresaId: req.empresa?.id,
      authToken: req.nexusToken,
    });
    try {
      await registerIssuedPolicy({
        empresaId: req.empresa?.id,
        producto: 'rcv',
        emission: result,
        state: mergedState,
        planNombre: mergedState?.selectedPlan?.name,
        frecuencia: mergedState?.rcv?.frecuencia,
        expedienteCtx: { producto: 'rcv', nexusMetadata: req.nexusMetadata, empresaNombre: req.empresa?.nombre },
      });
    } catch (feedErr) {
      console.warn('[rcv-cotizacion/emit] feed Nexus:', feedErr?.message || feedErr);
    }

    return res.status(201).json({
      success: true,
      message: 'Poliza emitida exitosamente.',
      policy: {
        number: result.cnpoliza,
        cnpoliza: result.cnpoliza,
        cnrecibo: result.cnrecibo,
        urlpoliza: result.urlpoliza,
        url_conductor_habitual: result.url_conductor_habitual,
        url_club_arys: result.url_club_arys,
        url_ingreso_caja: result.url_ingreso_caja,
        ncuota: result.ncuota,
        internalPolicyId: result.internalPolicyId,
        emittedAt: result.emittedAt,
        quote: result.quote,
        metadata: result.metadata,
        expediente,
      },
    });
  } catch (err) {
    return send(res, err, 'emit');
  }
});

module.exports = router;
module.exports.emitGuard = emitGuard;
