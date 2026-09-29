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

/** Obtiene la metadata efectiva del SSO buscando en URL, sessionStorage, localStorage y store */
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
  return {
    ...(tokenMeta || {}),
    ...storeMeta,
  };
}

/** Determina si el usuario logueado en la sesión de Sis2000 tiene rol de Productor */
export function isProductorRole(meta: Record<string, unknown>): boolean {
  const crol = String(meta.crol ?? '').trim();
  const centidad = String(meta.centidad ?? '').trim().toUpperCase();
  // Rol 5 o rol 8 en Sis2000 es Productor / Corredor, o centidad === 'P'
  return crol === '5' || crol === '8' || centidad === 'P';
}

/** Determina si la sesión se originó desde el Backoffice de Sis2000 */
export function isBackofficeSession(meta: Record<string, unknown>): boolean {
  const origen = String(meta.origen ?? meta.source ?? '').trim().toLowerCase();
  const allowPending = String(meta.allowPendingEmission ?? '').trim().toLowerCase() === 'true';
  return origen === 'backoffice' || allowPending;
}

/**
 * En Sis2000:
 * - Rol Productor: NO ve el selector (toma su propio código de productor logueado).
 * - Otros roles (Root, Admin, Suscripción, Técnica, etc.): SÍ ven el selector para asociar la emisión.
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

  // Para todos los demás roles (root, admin, suscripción, etc.), SÍ se muestra el selector
  return true;
}
