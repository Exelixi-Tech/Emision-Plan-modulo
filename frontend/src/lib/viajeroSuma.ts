/**
 * Viajero Local por días (producto 25): elegir la suma asegurada.
 *
 * - 1.500 $: planes VIAJ* por días (VIAJE4 = 3 … VIAJ10 = 15), el plan sale de los días del viaje.
 * - 3.000 $ (VIAJE5) y 5.000 $ (VIAJE6) del ramo 25 (R-095117): un solo plan, de 1 a 10 días;
 *   nest-api cotiza prima anual del plan ÷ 365 × días del viaje.
 *
 * Solo se ofrecen las sumas cuyos planes llegaron en la lista del canal (mausuplan).
 */
import type { Plan } from '../types';

/** Ramo de VIAJE5/VIAJE6 por días con prorrata de la prima anual (no el VIAJE5/6 del ramo 5). */
const RAMO_VIAJE_LOCAL = 25;

const SUMA_MAYOR_POR_PLAN: Record<string, { label: string; monto: number }> = {
  VIAJE5: { label: '3.000 $', monto: 3000 },
  VIAJE6: { label: '5.000 $', monto: 5000 },
};

export const VIAJE_SUMA_BASE_KEY = 'base';
export const VIAJE_SUMA_MAYOR_MIN_DIAS = 1;
export const VIAJE_SUMA_MAYOR_MAX_DIAS = 10;

export interface OpcionSumaViaje {
  key: string;
  label: string;
  /** Plan fijo de la suma (VIAJE5/VIAJE6); null = 1.500 $, el plan sale de los días. */
  plan: Plan | null;
  minDias: number;
  maxDias: number;
}

function cplanDe(p: Plan): string {
  return String(p.cplan ?? '').trim().toUpperCase();
}

/** VIAJE5/VIAJE6 del ramo 25. */
export function isViajeSumaMayor(p: Plan | null | undefined): boolean {
  if (!p) return false;
  return Number(p.cramo) === RAMO_VIAJE_LOCAL && cplanDe(p) in SUMA_MAYOR_POR_PLAN;
}

export function sumaViajeKey(p: Plan): string {
  return `${RAMO_VIAJE_LOCAL}:${cplanDe(p)}`;
}

/** Opciones de suma con sus días permitidos, en orden de suma. */
export function opcionesSumaViaje(
  plans: Plan[],
  base: { minDias: number; maxDias: number },
): OpcionSumaViaje[] {
  const out: OpcionSumaViaje[] = [];
  if (plans.some((p) => !isViajeSumaMayor(p))) {
    out.push({ key: VIAJE_SUMA_BASE_KEY, label: '1.500 $', plan: null, ...base });
  }
  const mayores = new Map<string, Plan>();
  for (const p of plans) {
    if (isViajeSumaMayor(p) && !mayores.has(sumaViajeKey(p))) mayores.set(sumaViajeKey(p), p);
  }
  [...mayores.values()]
    .sort((a, b) => SUMA_MAYOR_POR_PLAN[cplanDe(a)].monto - SUMA_MAYOR_POR_PLAN[cplanDe(b)].monto)
    .forEach((p) => {
      out.push({
        key: sumaViajeKey(p),
        label: SUMA_MAYOR_POR_PLAN[cplanDe(p)].label,
        plan: p,
        minDias: VIAJE_SUMA_MAYOR_MIN_DIAS,
        maxDias: VIAJE_SUMA_MAYOR_MAX_DIAS,
      });
    });
  return out;
}

/**
 * VIAJE5/VIAJE6 con los días del viaje. Como VIAJE, cubre solo al titular (nest-api rechaza
 * dependientes en estos planes aunque maplanes_per traiga nmax_dep).
 */
export function planSumaMayorPorDias(plan: Plan, ndias: number): Plan {
  return {
    ...plan,
    ndias,
    nmax_dep: 0,
    maxAsegurados: 1,
    tag: `Viajero · ${ndias} día${ndias === 1 ? '' : 's'}`,
    desc: `Cobertura por ${ndias} día${ndias === 1 ? '' : 's'} para el titular.`,
    benefits: [
      `Vigencia de ${ndias} día${ndias === 1 ? '' : 's'}`,
      'Prima proporcional a los días del viaje',
      'Asistencia en viaje',
    ],
  };
}
