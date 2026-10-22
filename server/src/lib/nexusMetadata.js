/**
 * Utilidades para decodificación y fusión de metadata SSO del JWT (nexusAuth)
 * y persistencia de productor seleccionado por el usuario en el wizard.
 */

const DEFAULT_PRODUCTOR = String(process.env.LAMUNDIAL_PRODUCTOR || '80080').trim();

/** Ids de rol (serol.crol) de productor/corredor, configurables con CROL_PRODUCTOR (lista separada por comas). */
const CROLES_PRODUCTOR = String(process.env.CROL_PRODUCTOR ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter((v) => v !== '')
  .map(Number)
  .filter((n) => Number.isInteger(n));

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

/**
 * Misma regla que el selector del frontend: backoffice solo si el usuario es interno, no productor y
 * con productor de sesión genérico (80080 o vacío); marketplace solo si el productor de la sesión es 80080.
 * `meta.cproductor` debe ser el del token, no el que el cliente eligió.
 */
function puedeElegirProductor(meta) {
  const origen = String(meta?.origen ?? meta?.source ?? '').trim().toLowerCase();
  if (origen === 'marketplace') {
    const productor = String(meta?.cproductor ?? '').trim();
    return productor === '' || productor === DEFAULT_PRODUCTOR || productor === '80080';
  }

  if (origen === 'backoffice') {
    const productor = String(meta?.cproductor ?? '').trim();
    if (productor !== '' && productor !== DEFAULT_PRODUCTOR && productor !== '80080') return false;
    const crol = meta?.crol != null && String(meta.crol).trim() !== '' ? Number(meta.crol) : NaN;
    return Number.isFinite(crol) && !CROLES_PRODUCTOR.includes(crol);
  }
  return false;
}

/** Fusiona metadata SSO del JWT (nexusAuth) + tokens del state respetando la elección de productor si aplica. */
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
  // Técnico que eligió productor en el selector: se emite con ese productor, no con el del token.
  const yaEligioProductor =
    state.metadataCanal?.productorSeleccionado === true ||
    state.metadataCanal?.productorSeleccionado === 'true' ||
    mergedMeta.productorSeleccionado === true ||
    mergedMeta.productorSeleccionado === 'true';

  const usaSeleccion = puedeElegirProductor({ ...mergedMeta, cproductor: nexusMetadata?.cproductor }) && yaEligioProductor;
  const seleccionKeys = new Set(['cproductor', 'centidad', 'citem']);
  for (const key of actorKeys) {
    if (usaSeleccion && seleccionKeys.has(key) && state.metadataCanal?.[key]) {
      mergedMeta[key] = state.metadataCanal[key];
      continue;
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

module.exports = {
  DEFAULT_PRODUCTOR,
  CROLES_PRODUCTOR,
  decodeJwtMetadata,
  preferGestorCode,
  puedeElegirProductor,
  withNexusMetadata,
};
