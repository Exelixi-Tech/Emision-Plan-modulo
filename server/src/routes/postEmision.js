/**
 * Consulta de "post-emisión pendiente" para operadores (solo lectura).
 *
 *   GET /api/internal/post-emision?desde=YYYY-MM-DD&limite=200
 *
 * Protección: header `x-post-emision-token: <POST_EMISION_TOKEN>` (o
 * `Authorization: Bearer <token>`). No usa nexus_token porque el operador
 * consulta con curl, sin sesión de tenant. Sin POST_EMISION_TOKEN en .env
 * el endpoint responde 503 (deshabilitado).
 */
const crypto = require('crypto');
const express = require('express');
const { listarPendientes, getDir, REINTENTO_FLAG } = require('../services/postEmisionPendiente');
const { runReintentoSweep, reintentoHabilitado } = require('../services/postEmisionReintento');

const router = express.Router();

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function requireToken(req, res, next) {
  const expected = String(process.env.POST_EMISION_TOKEN || '').trim();
  if (!expected) {
    return res.status(503).json({ success: false, code: 'POST_EMISION_DISABLED', message: 'POST_EMISION_TOKEN no configurado.' });
  }
  const header = req.headers['x-post-emision-token'] || req.headers.authorization || '';
  const given = String(header).replace(/^Bearer\s+/i, '').trim();
  if (!given || !safeEqual(given, expected)) {
    return res.status(401).json({ success: false, code: 'POST_EMISION_UNAUTHORIZED', message: 'Token inválido.' });
  }
  return next();
}

router.get('/', requireToken, (req, res) => {
  try {
    const desde = String(req.query.desde || '').trim() || undefined;
    const limite = parseInt(req.query.limite, 10) || 200;
    const items = listarPendientes({ desde, limite });
    res.json({
      success: true,
      dir: getDir(),
      desde: desde || null,
      total: items.length,
      reintentoAutomatico: reintentoHabilitado(),
      reintentoFlag: REINTENTO_FLAG,
      items,
    });
  } catch (err) {
    res.status(500).json({ success: false, code: 'POST_EMISION_READ_ERROR', message: err.message });
  }
});

/**
 * POST /api/internal/post-emision/reintento?desde=YYYY-MM-DD&limite=500
 * Dispara un barrido de reintento de cobro bajo demanda (mismo token).
 * Requiere POST_EMISION_REINTENTO habilitado; si no, responde enabled:false.
 */
router.post('/reintento', requireToken, async (req, res) => {
  try {
    const desde = String(req.query.desde || '').trim() || undefined;
    const limite = parseInt(req.query.limite, 10) || 500;
    const resumen = await runReintentoSweep({ desde, limite });
    res.json({ success: true, ...resumen });
  } catch (err) {
    res.status(500).json({ success: false, code: 'POST_EMISION_REINTENTO_ERROR', message: err.message });
  }
});

module.exports = router;
