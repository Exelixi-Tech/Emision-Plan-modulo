/**
 * Bootstrap token mesa técnica / parametrizador (iframe SysIP).
 * No exige nexus_token: el iframe a menudo trae un JWT viejo o de otro scope.
 */
const express = require('express');
const { fetchPanelToken } = require('../services/nexusRevisionToken');

const router = express.Router();

router.get('/panel-token', async (req, res) => {
  try {
    const panelRaw = String(req.query.panel || 'revision').toLowerCase();
    const panel =
      panelRaw === 'config' || panelRaw === 'preguntas' ? panelRaw : 'revision';
    const data = await fetchPanelToken({
      empresaId: Number(req.query.empresaId) || 1,
      producto: String(req.query.producto || 'funerario'),
      modulo: String(req.query.modulo || 'emision'),
      panel,
    });
    res.json({ success: true, ...data });
  } catch (err) {
    const code = err?.code || 'NEXUS_PANEL_TOKEN_FAILED';
    const status = code === 'NEXUS_API_KEY_MISSING' ? 503 : 502;
    res.status(status).json({
      success: false,
      code,
      message: err?.message || 'No se pudo obtener token de panel',
    });
  }
});

module.exports = router;
