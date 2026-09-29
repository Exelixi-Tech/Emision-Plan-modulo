import { getNexusToken, decodeNexusTokenMetadata } from './nexus-token-client';
import { useWizardStore } from '../store/wizardStore';

const CANDIDATE_TOKEN_KEYS = [
  'nexus_access_token_emision',
  'nexus_access_token_ocr',
  'nexus_access_token_formulario',
  'nexus_access_token_pagos',
  'nexus_access_token',
  'nexus_token',
];

/** Obtiene la metadata efectiva del SSO combinando tokens almacenados y store */
export function getEffectiveSsoMetadata(): Record<string, unknown> {
  let token: string | null = null;
  for (const k of CANDIDATE_TOKEN_KEYS) {
    token = getNexusToken(k);
    if (token) break;
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
  return origen === 'backoffice';
}

/**
 * En Backoffice de Sis2000:
 * - Rol Productor: NO ve el selector (toma su propio código de productor logueado).
 * - Otros roles (Admin, Suscripción, Técnica, etc.): SÍ ven el selector para asociar la emisión.
 */
export function shouldShowProductorSelector(meta: Record<string, unknown>): boolean {
  return isBackofficeSession(meta) && !isProductorRole(meta);
}
