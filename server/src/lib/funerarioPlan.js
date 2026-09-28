/**
 * Planes producto personas (valrep/planes/producto) — códigos numéricos del ramo funerario (ramo 9).
 */

/**
 * Valida que el cplan corresponde a un plan funerario La Mundial (ramo 9).
 * Los planes funerarios son numéricos entre 2 y 12 (inclusive).
 * Planes alfanuméricos o con espacios (ej. UUID, nombre comercial Exélixi) NO son funerarios.
 * @param {string} cplan
 * @returns {boolean}
 */
function isFunerarioCplan(cplan) {
  const code = String(cplan || '').trim();
  if (!code) return false;
  // Solo planes numéricos son válidos para ramo funerario (2–12)
  if (!/^\d+$/.test(code)) return false;
  const n = parseInt(code, 10);
  return Number.isFinite(n) && n >= 2 && n <= 12;
}

/**
 * Ramo Sis2000 para cotizar/emitir (producto 57 → 45; si no, plan o metadata SSO).
 * @param {{ selectedPlan?: { cramo?: number }, metadataCanal?: object, bodyCramo?: unknown, cproducto?: string }} [opts]
 * @returns {number}
 */
function resolvePersonasCramo(opts = {}) {
  const selectedPlan = opts.selectedPlan;
  const fromPlan = selectedPlan?.cramo != null ? Number(selectedPlan.cramo) : NaN;
  if (Number.isFinite(fromPlan) && fromPlan > 0) return fromPlan;

  if (opts.bodyCramo != null && String(opts.bodyCramo).trim() !== '') {
    const b = parseInt(String(opts.bodyCramo), 10);
    if (Number.isFinite(b) && b > 0) return b;
  }

  const meta = opts.metadataCanal && typeof opts.metadataCanal === 'object' ? opts.metadataCanal : {};
  const prod = String(
    opts.cproducto ?? meta.cproducto ?? process.env.LAMUNDIAL_PRODUCTO_FUNERARIO ?? '57',
  ).trim();
  if (prod === '57') return 45;

  if (meta.cramo != null && String(meta.cramo).trim() !== '') {
    const m = parseInt(String(meta.cramo), 10);
    if (Number.isFinite(m) && m > 0) return m;
  }

  return parseInt(process.env.LAMUNDIAL_RAMO_PERSON, 10) || 9;
}

module.exports = { isFunerarioCplan, resolvePersonasCramo };
