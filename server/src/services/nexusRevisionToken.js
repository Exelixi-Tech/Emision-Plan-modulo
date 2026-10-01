/**
 * Obtiene JWT revision-panel / config-panel desde Nexus (API key de servicio).
 * Usado para rehidratar la mesa técnica cuando el iframe trae un token inválido.
 */

function nexusBases() {
  const primary = (process.env.NEXUS_API_URL || 'http://127.0.0.1:3092').replace(/\/$/, '');
  const bases = [primary];
  if (!primary.includes('127.0.0.1') && !primary.includes('localhost')) {
    bases.push('http://127.0.0.1:3092');
  }
  return bases;
}

function getApiKey() {
  return (
    process.env.NEXUS_API_KEY ||
    process.env.NEXUS_SERVICE_API_KEY ||
    // Mismo valor que API_KEY de nexus-api (GCIA)
    process.env.API_KEY ||
    ''
  ).trim();
}

/**
 * @param {{ empresaId?: number, panel?: 'revision' | 'config' | 'preguntas', producto?: string, modulo?: string }} opts
 * @returns {Promise<{ token: string, expiresIn?: number, empresaId: number, scope?: string }>}
 */
async function fetchPanelToken(opts = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('NEXUS_API_KEY no configurada en emision-api');
    err.code = 'NEXUS_API_KEY_MISSING';
    throw err;
  }

  const empresaId = Number(opts.empresaId) > 0 ? Number(opts.empresaId) : 1;
  const producto = opts.producto || 'funerario';
  const modulo = opts.modulo || 'emision';
  const panel = opts.panel || 'revision';
  const qs = new URLSearchParams({ panel });

  let lastErr = '';
  for (const base of nexusBases()) {
    const url = `${base}/api/config/token/${empresaId}/${producto}/${modulo}?${qs}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastErr = body.message || `HTTP ${res.status}`;
        continue;
      }
      const token = body.token || body.data?.token;
      if (!token) {
        lastErr = 'Nexus no devolvió token';
        continue;
      }
      return {
        token: String(token),
        expiresIn: body.expiresIn ?? body.data?.expiresIn,
        empresaId,
        scope: panel === 'revision' ? 'revision-panel' : 'config-panel',
      };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }

  const err = new Error(lastErr || 'No se pudo obtener token de revisión');
  err.code = 'NEXUS_PANEL_TOKEN_FAILED';
  throw err;
}

module.exports = { fetchPanelToken, getApiKey };
