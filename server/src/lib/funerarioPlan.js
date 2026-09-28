/**
 * Planes producto personas (valrep/planes/producto).
 * Ramo 9 (funerario): planes numéricos 2–12.
 * Ramo 1 (vida, cproducto 76): planes numéricos positivos.
 * Ramo 5 (AP, cproducto 78/79): planes numéricos positivos.
 */

/** Productos personas La Mundial por código */
const PERSONAS_CPRODUCTOS = new Set(['57', '76', '78', '79']);

/**
 * Valida que el cplan corresponde a un plan funerario La Mundial (ramo 9).
 * Solo son válidos planes numéricos entre 2 y 12 (inclusive).
 * @param {string} cplan
 * @returns {boolean}
 */
function isFunerarioCplan(cplan) {
  const code = String(cplan || '').trim();
  if (!code) return false;
  if (!/^\d+$/.test(code)) return false;
  const n = parseInt(code, 10);
  return Number.isFinite(n) && n >= 2 && n <= 12;
}

/**
 * Valida que el cplan es válido para el flujo de personas (funerario, vida, AP).
 * - Funerario (cproducto 57): numérico 2–12.
 * - Vida (76) / AP (78, 79): cualquier numérico positivo.
 * - Si no se conoce el cproducto, aplica la regla funeraria por retrocompatibilidad.
 * @param {string} cplan
 * @param {string} [cproducto]
 * @returns {boolean}
 */
function isPersonasCplan(cplan, cproducto) {
  const code = String(cplan || '').trim();
  if (!code) return false;
  if (!/^\d+$/.test(code)) return false;
  const n = parseInt(code, 10);
  if (!Number.isFinite(n) || n <= 0) return false;
  const prod = String(cproducto || '57').trim();
  // Para vida y AP: cualquier numérico positivo es válido
  if (prod === '76' || prod === '78' || prod === '79') return true;
  // Funerario (57): solo 2–12
  return n >= 2 && n <= 12;
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
  // Vida (76) → ramo 1; AP (78, 79) → ramo 5
  if (prod === '76') return 1;
  if (prod === '78' || prod === '79') return 5;

  if (meta.cramo != null && String(meta.cramo).trim() !== '') {
    const m = parseInt(String(meta.cramo), 10);
    if (Number.isFinite(m) && m > 0) return m;
  }

  return parseInt(process.env.LAMUNDIAL_RAMO_PERSON, 10) || 9;
}

module.exports = { isFunerarioCplan, isPersonasCplan, resolvePersonasCramo, PERSONAS_CPRODUCTOS };
