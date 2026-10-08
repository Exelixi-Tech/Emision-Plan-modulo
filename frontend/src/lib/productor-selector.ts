import { decodeNexusTokenMetadata } from './nexus-token-client';
import { useWizardStore } from '../store/wizardStore';
import { isTarjetaRcvFlow } from './rcv-tarjeta-flow';

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
 * Ids de rol (serol.crol) de Sis2000 que corresponden a productor/corredor,
 * configurables por entorno con VITE_CROL_PRODUCTOR (lista separada por comas).
 */
const CROLES_PRODUCTOR: number[] = String(import.meta.env.VITE_CROL_PRODUCTOR ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter((v) => v !== '')
  .map(Number)
  .filter((n) => Number.isInteger(n));

/**
 * Determina si el usuario logueado en la sesión de Sis2000 tiene rol de Productor.
 * Solo el rol configurado en VITE_CROL_PRODUCTOR (corredores) es productor; cualquier
 * otro rol es personal interno de Sis2000 y NO es rol de productor.
 */
export function isProductorRole(meta: Record<string, unknown>): boolean {
  const rawRol = meta.crol;
  const crolNum = rawRol !== undefined && rawRol !== null && String(rawRol).trim() !== ''
    ? Number(rawRol)
    : NaN;

  if (!Number.isNaN(crolNum)) {
    return CROLES_PRODUCTOR.includes(crolNum);
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

/** crol interno de Sis2000 (técnico/administrativo): viene informado y no es productor. */
export function isTecnicoRole(meta: Record<string, unknown>): boolean {
  const raw = meta.crol;
  if (raw === undefined || raw === null || String(raw).trim() === '') return false;
  const crol = Number(raw);
  return Number.isFinite(crol) && !CROLES_PRODUCTOR.includes(crol);
}

/**
 * Selector de productor: solo el técnico (rol interno de Sis2000).
 * - Rol productor (VITE_CROL_PRODUCTOR): NO lo ve (toma su propio código).
 * - Sin crol (portal, canales, intermediarios): NO lo ve; usa el productor de la sesión.
 * - Cualquier otro rol interno informado: SÍ lo ve para asociar la emisión.
 */
export function shouldShowProductorSelector(meta: Record<string, unknown>): boolean {
  // Flujo tarjeta: el productor/canal viene fijo en la tarjeta (lote), aunque haya token de usuario.
  if (isTarjetaRcvFlow()) {
    return false;
  }

  // Si el usuario es un productor logueado, NUNCA se muestra el selector (toma su propio código)
  if (isProductorRole(meta)) {
    return false;
  }

  // Sin crol interno (portal / canal / intermediario) no se muestra
  if (!isTecnicoRole(meta)) {
    return false;
  }

  // Si es marketplace cerrado sin permiso de emisión pendiente
  const origen = String(meta.origen ?? meta.source ?? '').trim().toLowerCase();
  if (origen === 'marketplace' && String(meta.allowPendingEmission ?? '').trim().toLowerCase() !== 'true') {
    return false;
  }

  // Técnico interno de Sis2000: SÍ se muestra el selector
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
