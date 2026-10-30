/**
 * useProductConfig.ts
 *
 * Hook compartido para leer y guardar la configuración paramétrica
 * de un módulo desde el servidor Nexus.
 *
 * Escritura: usa el JWT ?token= que abre Nexus Admin (scope config-panel),
 * con fallback a VITE_NEXUS_API_KEY si existe.
 */
import { useEffect, useState, useCallback } from 'react';
import { resolveNexusApiUrl } from '../nexus/nexus-core';
import { bootstrapPanelToken } from '../config/panelTokenBootstrap';

const NEXUS_URL = resolveNexusApiUrl(import.meta.env.VITE_NEXUS_API_URL);
const NEXUS_KEY = import.meta.env.VITE_NEXUS_API_KEY ?? '';

export type LoadState = 'loading' | 'ready' | 'error';

const REFRESH_MS = 10 * 60 * 1000;

function readConfigPanelToken(): string {
  try {
    return new URL(window.location.href).searchParams.get('token')?.trim() || '';
  } catch {
    return '';
  }
}

function replaceConfigPanelToken(next: string) {
  const token = String(next || '').trim();
  if (!token) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('token', token);
    window.history.replaceState({}, '', url.toString());
  } catch {
    /* ignore */
  }
}

/** Refresh Nexus; si el JWT de SysIP es inválido, mint fresco vía emision-api. */
async function ensureConfigPanelToken(empresaId = 1): Promise<boolean> {
  const current = readConfigPanelToken();
  if (current) {
    try {
      const res = await fetch(`${NEXUS_URL}/api/config/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${current}`,
          'x-config-token': current,
        },
        body: JSON.stringify({ token: current }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        replaceConfigPanelToken(String(data.token));
        return true;
      }
    } catch {
      /* caer a bootstrap */
    }
  }
  const minted = await bootstrapPanelToken({ panel: 'preguntas', empresaId });
  return Boolean(minted);
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const panelToken = readConfigPanelToken();
  if (panelToken) {
    headers.Authorization = `Bearer ${panelToken}`;
    headers['x-config-token'] = panelToken;
  }
  if (NEXUS_KEY) {
    headers['x-api-key'] = NEXUS_KEY;
  }
  return headers;
}

export function useProductConfig(empresaId: number, producto: string, modulo: string) {
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [empresaNombre, setEmpresaNombre] = useState<string>('');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const fetchConfig = useCallback(async () => {
    setLoadState('loading');
    try {
      const res = await fetch(`${NEXUS_URL}/api/config/${empresaId}/${producto}/${modulo}`);
      const data = await res.json();
      if (data.success) {
        setConfig(data.data);
        const nombre = typeof data.empresaNombre === 'string' ? data.empresaNombre.trim() : '';
        setEmpresaNombre(nombre);
        setLoadState('ready');
      } else {
        setLoadState('error');
      }
    } catch {
      setLoadState('error');
    }
  }, [empresaId, producto, modulo]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  useEffect(() => {
    void ensureConfigPanelToken(empresaId);
    const id = window.setInterval(() => {
      void ensureConfigPanelToken(empresaId);
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [empresaId]);

  const saveConfig = useCallback(async (newConfig: Record<string, any>) => {
    setSaving(true);
    setSaveError('');
    try {
      await ensureConfigPanelToken(empresaId);
      if (!readConfigPanelToken() && !NEXUS_KEY) {
        setSaveError(
          'Sin token de acceso. Abre el parametrizador desde Nexus Admin (Configurar módulo).',
        );
        return null;
      }
      // Merge con lo cargado: un PUT parcial no debe borrar otras claves
      const payload = { ...(config ?? {}), ...newConfig };
      // Si el panel envía canales de preguntas pero no el array legacy, no reenviar
      // el catálogo viejo (hacía reaparecer preguntas eliminadas).
      if (
        newConfig.healthQuestionsByCanal &&
        !Object.prototype.hasOwnProperty.call(newConfig, 'healthQuestions')
      ) {
        delete payload.healthQuestions;
      }
      let res = await fetch(`${NEXUS_URL}/api/config/${empresaId}/${producto}/${modulo}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      let data = await res.json().catch(() => ({}));
      if (res.status === 403 && (await ensureConfigPanelToken(empresaId))) {
        res = await fetch(`${NEXUS_URL}/api/config/${empresaId}/${producto}/${modulo}`, {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        });
        data = await res.json().catch(() => ({}));
      }
      if (res.ok && data.success) {
        setConfig(data.data);
        return data.data as Record<string, any>;
      }
      setSaveError(
        data.message
          || (res.status === 403
            ? 'Token expirado o inválido. Abre de nuevo el iframe (SysIP) o desde Nexus Admin.'
            : `Error al guardar (HTTP ${res.status}).`),
      );
      return null;
    } catch {
      setSaveError('No se pudo conectar al servidor Nexus.');
      return null;
    } finally {
      setSaving(false);
    }
  }, [empresaId, producto, modulo, config]);

  const resetConfig = useCallback(async () => {
    setSaving(true);
    setSaveError('');
    try {
      await ensureConfigPanelToken(empresaId);
      if (!readConfigPanelToken() && !NEXUS_KEY) {
        setSaveError(
          'Sin token de acceso. Abre el parametrizador desde Nexus Admin (Configurar módulo).',
        );
        return;
      }
      let res = await fetch(`${NEXUS_URL}/api/config/${empresaId}/${producto}/${modulo}/reset`, {
        method: 'POST',
        headers: authHeaders(),
      });
      let data = await res.json().catch(() => ({}));
      if (res.status === 403 && (await ensureConfigPanelToken(empresaId))) {
        res = await fetch(`${NEXUS_URL}/api/config/${empresaId}/${producto}/${modulo}/reset`, {
          method: 'POST',
          headers: authHeaders(),
        });
        data = await res.json().catch(() => ({}));
      }
      if (res.ok && data.success) {
        setConfig(data.data);
      } else {
        setSaveError(
          data.message
            || (res.status === 403
              ? 'Token expirado o inválido. Abre de nuevo el iframe (SysIP) o desde Nexus Admin.'
              : `Error al resetear (HTTP ${res.status}).`),
        );
      }
    } catch {
      setSaveError('No se pudo conectar al servidor Nexus.');
    } finally {
      setSaving(false);
    }
  }, [empresaId, producto, modulo]);

  return {
    config,
    empresaNombre,
    loadState,
    saving,
    saveError,
    saveConfig,
    resetConfig,
    refetch: fetchConfig,
  };
}
