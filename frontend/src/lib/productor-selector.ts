import { decodeNexusTokenMetadata } from './nexus-token-client';
import { useWizardStore } from '../store/wizardStore';

const CANDIDATE_TOKEN_KEYS = [
  'nexus_access_token_emision',
  'nexus_access_token_ocr',
  'nexus_access_token_formulario',
  'nexus_access_token_pagos',
  'nexus_access_token',
  'nexus_token',
];

/** Obtiene la metadata efectiva del SSO buscando en URL, sessionStorage, localStorage (incluyendo 'user' de Sis2000) y store */
export function getEffectiveSsoMetadata(): Record<string, unknown> {
  let token: string | null = null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('nexus_token');
    if (fromUrl && fromUrl.trim().length > 0) {
      token = fromUrl.trim();
    }
  } catch { /* ignore */ }

  if (!token) {
    for (const k of CANDIDATE_TOKEN_KEYS) {
      try {
        const val = sessionStorage.getItem(k) || localStorage.getItem(k);
        if (val && val.trim().length > 0) {
          token = val.trim();
          break;
        }
      } catch { /* ignore */ }
    }
  }

  const tokenMeta = token ? decodeNexusTokenMetadata(token) : null;
  const storeMeta = (useWizardStore.getState().metadataCanal as Record<string, unknown> | null) ?? {};

  // Soporte directo para sesión de Sis2000 (key 'user' en sessionStorage / localStorage)
  let sis2000UserMeta: Record<string, unknown> = {};
  try {
    const rawUser = sessionStorage.getItem('user') || localStorage.getItem('user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      const userData = (parsed?.data && typeof parsed.data === 'object') ? parsed.data : parsed;
      if (userData && typeof userData === 'object') {
        sis2000UserMeta = {
          crol: userData.crol,
          cdepartamento: userData.cdepartamento,
          ccorredor: userData.ccorredor,
          citem: userData.citem,
          centidad: userData.centidad,
          cproductor: userData.ccorredor,
          origen: 'backoffice',
        };
      }
    }
  } catch { /* ignore */ }

  return {
    ...sis2000UserMeta,
    ...(tokenMeta || {}),
    ...storeMeta,
  };
}

/**
 * Determina si el usuario logueado en la sesión de Sis2000 tiene rol de Productor.
 * En Sis2000 los roles son numéricos:
 * - Rol 5: Corredor / Productor
 * - Rol 8: Intermediario / Agente
 *
 * Cualquier otro rol (crol 1 = Admin/Root, crol 2 = Técnica, crol 3 = Suscripción,
 * crol 4 = Cobranzas, etc.) corresponde a personal administrativo/interno de Sis2000
 * y NO es rol de productor.
 */
export function isProductorRole(meta: Record<string, unknown>): boolean {
  const rawRol = meta.crol;
  const crolNum = rawRol !== undefined && rawRol !== null && String(rawRol).trim() !== ''
    ? Number(rawRol)
    : NaN;

  // Si tiene crol definido en Sis2000:
  if (!Number.isNaN(crolNum)) {
    // Solo roles 5 y 8 son Productores en Sis2000
    if (crolNum === 5 || crolNum === 8) {
      return true;
    }
    // Todos los demás roles (1, 2, 3, 4, 6, 7, etc.) son roles internos/administrativos
    return false;
  }

  // Fallback si no viene crol: verificar si tiene código de corredor asignado
  // y no pertenece a un departamento interno de la empresa
  const hasCorredor = meta.ccorredor != null && String(meta.ccorredor).trim() !== '' && String(meta.ccorredor).trim() !== '80080';
  const hasDepartamento = meta.cdepartamento != null && String(meta.cdepartamento).trim() !== '';

  return hasCorredor && !hasDepartamento;
}

/** Determina si la sesión se originó desde el Backoffice de Sis2000 */
export function isBackofficeSession(meta: Record<string, unknown>): boolean {
  const origen = String(meta.origen ?? meta.source ?? '').trim().toLowerCase();
  const allowPending = String(meta.allowPendingEmission ?? '').trim().toLowerCase() === 'true';
  return origen === 'backoffice' || allowPending;
}

/**
 * En Sis2000:
 * - Rol Productor (crol 5 u 8): NO ve el selector (toma su propio código de productor logueado).
 * - Otros roles (crol 1, 2, 3, etc.): SÍ ven el selector para asociar la emisión.
 */
export function shouldShowProductorSelector(meta: Record<string, unknown>): boolean {
  // Si el usuario es un productor logueado, NUNCA se muestra el selector (toma su propio código)
  if (isProductorRole(meta)) {
    return false;
  }

  // Si es marketplace cerrado sin permiso de emisión pendiente
  const origen = String(meta.origen ?? meta.source ?? '').trim().toLowerCase();
  if (origen === 'marketplace' && String(meta.allowPendingEmission ?? '').trim().toLowerCase() !== 'true') {
    return false;
  }

  // Para todos los demás roles en Sis2000, SÍ se muestra el selector
  return true;
}

export function initialProductorId(meta: Record<string, unknown>, currentProductor?: string | number): string {
  if (isProductorRole(meta)) {
    return String(meta.ccorredor ?? meta.cproductor ?? meta.citem ?? '').trim();
  }
  const cand = currentProductor ?? meta.cproductor;
  if (!cand || String(cand).trim() === '80080') return '';
  return String(cand).trim();
}
