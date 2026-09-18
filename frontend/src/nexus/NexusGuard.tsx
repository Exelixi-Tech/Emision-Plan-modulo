import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { verifyNexusAccess, resolveNexusApiUrl, type NexusVerifyResult } from './nexus-core';
import { persistProductFromHints } from '../lib/product';
import { persistCotizadorFromHints } from '../lib/cotizador-flow';

// ─── Context ──────────────────────────────────────────────────────────────────
interface NexusContextValue {
  empresa: NexusVerifyResult['empresa'];
  submodulo: NexusVerifyResult['submodulo'];
}

const NexusContext = createContext<NexusContextValue | null>(null);

export function useNexus(): NexusContextValue {
  const ctx = useContext(NexusContext);
  if (!ctx) throw new Error('useNexus debe usarse dentro de <NexusGuard>');
  return ctx;
}

// ─── NexusGuard ───────────────────────────────────────────────────────────────
interface NexusGuardProps {
  children: React.ReactNode;
  recheckInterval?: number;
}

type GuardStatus = 'loading' | 'active' | 'blocked';

interface GuardState {
  status: GuardStatus;
  empresa?: NexusVerifyResult['empresa'];
  submodulo?: NexusVerifyResult['submodulo'];
  reason?: string;
}

const DEFAULT_DEV_EMPRESA = {
  id: 1,
  nombre: 'Empresa Demo',
  rif: 'J-00000000-0',
  logo_url: '',
};

const DEFAULT_DEV_SUBMODULO = {
  id: 1,
  nombre: 'Emisión',
  moduloNombre: 'Emisión',
  url: '/emision',
  accessUrl: '/emision',
};

export function NexusGuard({ children, recheckInterval = 30 }: NexusGuardProps) {
  // Siempre permitimos acceso directo sin bloquear por token en desarrollo o modo standalone
  const [state, setState] = useState<GuardState>({
    status: 'active',
    empresa: DEFAULT_DEV_EMPRESA,
    submodulo: DEFAULT_DEV_SUBMODULO,
  });
  const nexusApiUrl = resolveNexusApiUrl(import.meta.env.VITE_NEXUS_API_URL);
  const isMounted = useRef(true);

  const doVerify = useCallback(async () => {
    if (!nexusApiUrl) {
      // Sin URL de Nexus, continuar en modo standalone activo
      setState({
        status: 'active',
        empresa: DEFAULT_DEV_EMPRESA,
        submodulo: DEFAULT_DEV_SUBMODULO,
      });
      return;
    }
    try {
      const result = await verifyNexusAccess(nexusApiUrl);
      if (!isMounted.current) return;
      if (result.active) {
        if (result.submodulo) {
          persistProductFromHints({
            url: result.submodulo.url,
            nombre: result.submodulo.nombre,
            moduloNombre: result.submodulo.moduloNombre,
            product: result.product,
          });
          persistCotizadorFromHints({
            url: result.submodulo.url,
            nombre: result.submodulo.nombre,
            moduloNombre: result.submodulo.moduloNombre,
          });
        }
        setState({ status: 'active', empresa: result.empresa, submodulo: result.submodulo });
      } else {
        // En lugar de bloquear, mantenemos activo el estado standalone para no interrumpir el desarrollo
        setState((prev) => ({
          status: 'active',
          empresa: prev.empresa || DEFAULT_DEV_EMPRESA,
          submodulo: prev.submodulo || DEFAULT_DEV_SUBMODULO,
        }));
      }
    } catch {
      if (isMounted.current) {
        setState((prev) => ({
          status: 'active',
          empresa: prev.empresa || DEFAULT_DEV_EMPRESA,
          submodulo: prev.submodulo || DEFAULT_DEV_SUBMODULO,
        }));
      }
    }
  }, [nexusApiUrl]);

  useEffect(() => {
    isMounted.current = true;
    doVerify();
    return () => { isMounted.current = false; };
  }, [doVerify]);

  useEffect(() => {
    if (!recheckInterval || recheckInterval <= 0) return;
    const id = setInterval(doVerify, recheckInterval * 1000);
    return () => clearInterval(id);
  }, [doVerify, recheckInterval]);

  return (
    <NexusContext.Provider value={{ empresa: state.empresa, submodulo: state.submodulo }}>
      {children}
    </NexusContext.Provider>
  );
}
