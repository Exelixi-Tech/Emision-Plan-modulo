/**
 * Renovar = póliza nueva enlazada. El estado `renovacion` lo arma Formulario y llega por la
 * sesión del flujo; el server de Emisión lo usa al emitir (cnpoliza_rel, itipoEmi NU, fdesde).
 * Sin `renovacion` en el store nada cambia.
 */
import { useWizardStore } from '../store/wizardStore';

export interface RenovacionFlujo {
  flujo: 'renovacion';
  cnpoliza_rel: string;
  estado?: string;
  precargada?: boolean;
  xplan_anterior?: string | null;
  fhasta_anterior?: string | null;
  fdesde_sugerida?: string | null;
  fhasta_sugerida?: string | null;
  plan_actual?: { cplan?: string | null; xplan?: string | null; activo?: boolean; disponible_en_canal?: boolean } | null;
  advertencias?: string[];
}

function leer(s: unknown): RenovacionFlujo | null {
  const st = s as { renovacion?: RenovacionFlujo | null; metadataCanal?: { renovacion?: RenovacionFlujo | null } | null };
  const r = st.renovacion ?? st.metadataCanal?.renovacion ?? null;
  return r && r.flujo === 'renovacion' && r.cnpoliza_rel && r.precargada ? r : null;
}

export function getRenovacion(): RenovacionFlujo | null {
  return leer(useWizardStore.getState());
}

export function useRenovacion(): RenovacionFlujo | null {
  return useWizardStore((s) => leer(s));
}

/** Plan de la póliza anterior, si sigue activo; si no está en la lista de hoy el cliente elige. */
export function planPreferidoRenovacion(): string | null {
  const r = getRenovacion();
  const cplan = String(r?.plan_actual?.cplan ?? '').trim().toUpperCase();
  if (!cplan || r?.plan_actual?.activo === false) return null;
  return cplan;
}
