/**
 * Planes producto personas (valrep/planes/producto) — códigos numéricos y alfanuméricos (FUNESP, ACH*, …).
 */

/**
 * @param {string} cplan
 * @returns {boolean}
 */
function isFunerarioCplan(cplan) {
  return String(cplan || '').trim().length > 0;
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
