/**
 * Utilidades compartidas de metadata Nexus y permisos de selección de productor.
 * Compartido entre /api/policies (emision.js) y /api/patrimonial (patrimonial.js).
 */

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

/** Ids de rol (serol.crol) de productor/corredor, configurables con CROL_PRODUCTOR (lista separada por comas). */
function getCrolesProductor() {
  return String(process.env.CROL_PRODUCTOR ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n));
}

/**
 * Regla de permiso para selección dinámica de productor:
 * 1. Si entra con origen = 'marketplace' o no es origen = 'backoffice', devuelve false.
 * 2. Si tiene un rol explícito de productor/corredor (CROLES_PRODUCTOR), devuelve false.
 * 3. En backoffice: si tiene productor específico asignado (distinto de 80080), solo rol interno puede elegir.
 * 4. En backoffice con productor genérico (80080) o vacío: devuelve true.
 * @param {Record<string, unknown>} meta
 * @returns {boolean}
 */
function puedeElegirProductor(meta) {
  const origen = String(meta?.origen ?? meta?.source ?? '').trim().toLowerCase();
  if (origen === 'marketplace' || origen !== 'backoffice') {
    return false;
  }

  const productor = String(meta?.cproductor ?? '').trim();
  const crol = meta?.crol != null && String(meta.crol).trim() !== '' ? Number(meta.crol) : NaN;
  const crolesProductor = getCrolesProductor();

  if (Number.isFinite(crol) && crolesProductor.includes(crol)) {
    return false;
  }

  if (productor !== '' && productor !== '80080') {
    if (origen === 'backoffice') {
      return Number.isFinite(crol) && !crolesProductor.includes(crol);
    }
    return false;
  }

  return true;
}

/**
 * Fusiona metadata SSO del JWT verificado (nexusAuth) con el state del cliente.
 * - Si el usuario tiene permiso (usaSeleccion), respeta cproductor, centidad y citem del cliente.
 * - Si no tiene permiso de selección, cproductor, centidad y citem SOLO pueden provenir del token verificado.
 *   El cliente no puede inyectar estas claves si no vienen en el JWT (evita falsificación sin firma).
 * @param {object} state
 * @param {object} [nexusMetadata]
 * @returns {object}
 */
function withNexusMetadata(state, nexusMetadata) {
  if (!state || typeof state !== 'object') return state;

  const hasVerifiedAuth = Boolean(nexusMetadata && typeof nexusMetadata === 'object' && Object.keys(nexusMetadata).length > 0);
  const tokenMeta = hasVerifiedAuth ? nexusMetadata : {};

  // decodeJwtMetadata solo como fallback en desarrollo local si NO hay nexusMetadata verificado
  const unverifiedTokenMeta = !hasVerifiedAuth
    ? (['nexus_token', 'nexusToken']
        .map((k) => (typeof state[k] === 'string' ? decodeJwtMetadata(state[k]) : null))
        .find(Boolean) || {})
    : {};

  const baseMeta = hasVerifiedAuth ? tokenMeta : unverifiedTokenMeta;
  const clientMeta = state.metadataCanal && typeof state.metadataCanal === 'object' ? state.metadataCanal : {};

  const mergedMeta = { ...clientMeta, ...baseMeta };

  // El permiso se evalúa estrictamente sobre la metadata autenticada (baseMeta),
  // evitando que el cliente falsifique origen, crol o cproductor en metadataCanal.
  const canChoose = puedeElegirProductor(baseMeta);
  const usaSeleccion = canChoose && (
    clientMeta.productorSeleccionado === true ||
    clientMeta.productorSeleccionado === 'true'
  );

  const actorKeys = ['cgestor', 'cgestor_in', 'centidad', 'citem', 'cproductor', 'ccanalalt_in', 'cscanalalt_in', 'ccanalalt', 'cscanalalt'];
  const seleccionKeys = new Set(['cproductor', 'centidad', 'citem']);

  for (const key of actorKeys) {
    if (seleccionKeys.has(key)) {
      if (usaSeleccion) {
        if (key === 'cproductor' && clientMeta.cproductor) {
          mergedMeta.cproductor = String(clientMeta.cproductor).trim();
        } else if (key === 'centidad') {
          mergedMeta.centidad = String(clientMeta.centidad || 'P').trim();
        } else if (key === 'citem') {
          mergedMeta.citem = String(clientMeta.citem || clientMeta.cproductor || '').trim();
        }
      } else {
        // Sin permiso de selección: SOLO toma del token autenticado (baseMeta).
        // Si el token no lo trae, se previene inyección de cliente (se remueve o se asigna default del token).
        if (baseMeta[key] != null && String(baseMeta[key]).trim() !== '') {
          mergedMeta[key] = String(baseMeta[key]).trim();
        } else if (key === 'centidad' && baseMeta.cproductor) {
          mergedMeta.centidad = 'P';
        } else if (key === 'citem' && baseMeta.cproductor) {
          mergedMeta.citem = String(baseMeta.cproductor).trim();
        } else {
          delete mergedMeta[key];
        }
      }
      continue;
    }

    const val = baseMeta[key] ?? clientMeta[key] ?? state[key];
    if (val != null && String(val).trim() !== '') {
      mergedMeta[key] = (key === 'cgestor' || key === 'cgestor_in')
        ? preferGestorCode(baseMeta[key], clientMeta[key], state[key])
        : String(val).trim();
    }
  }

  const gestor = mergedMeta.cgestor != null ? String(mergedMeta.cgestor).trim() : '';
  return { ...state, metadataCanal: mergedMeta, ...(gestor ? { cgestor: gestor } : {}) };
}

module.exports = {
  decodeJwtMetadata,
  preferGestorCode,
  getCrolesProductor,
  get CROLES_PRODUCTOR() {
    return getCrolesProductor();
  },
  puedeElegirProductor,
  withNexusMetadata,
};
