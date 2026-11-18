/**
 * Viajero por días: qué planes del canal aplican a los días del viaje.
 *
 * Sin días fijos en el código: cada plan dice qué días cubre.
 * - `ndiasMin`/`ndiasMax` de nest-api: rango del plan (p. ej. VIAJE5/VIAJE6 del ramo 25 por su regla
 *   de emisión, o frecuencias D «hasta N días»).
 * - `ndias` con `ndiasFijo` (maplanes_frec E con ndias > 0): plan de esos días exactos (VIAJE4 = 3 …).
 * - `ndias` solo del nombre del plan («por 15 días», VIAJ10 con ndias 0): plan abierto de su familia;
 *   cubre desde los días del plan fijo más corto de la familia hasta los suyos (regla SysIP: el plan de
 *   los días exactos; si no hay, el de más días).
 * - Familia = ramo + nombre del plan sin los días («Plan II 1.500$ Viajero»): al cliente se le muestra
 *   una sola opción por familia.
 * - Planes sin días (ni en la configuración ni en el nombre) no se ofrecen, salvo que ningún plan del
 *   canal tenga días: entonces se ofrecen todos, sin tope.
 */
import type { Plan } from '../types';

export interface RangoDiasViaje {
  min: number;
  /** null = sin tope configurado. */
  max: number | null;
}

export interface OpcionPlanViaje {
  /** Familia del plan (una opción por familia). */
  key: string;
  /** Plan a cotizar y emitir para los días del viaje (con `ndias` = días del viaje). */
  plan: Plan;
  /** Días que cubre la familia en conjunto. */
  rango: RangoDiasViaje;
  /** Suma asegurada que trae el nombre del plan («1.500$» → 1500), si la trae. */
  sumaNombre: number | null;
}

export interface FamiliaViaje {
  key: string;
  nombre: string;
  rango: RangoDiasViaje;
  sumaNombre: number | null;
}

interface TramoPlan {
  plan: Plan;
  familia: string;
  min: number;
  max: number | null;
  exacto: boolean;
}

function enteroPositivo(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Nombre del plan sin los días («Plan II 1.500$ Viajero por 3 días» → «plan ii 1.500$ viajero»). */
export function nombreSinDias(name: string): string {
  return String(name || '')
    .replace(/\s*[·•|-]?\s*(?:por\s+)?\d+\s*d[ií]as?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Familia del plan: ramo + nombre sin días. */
export function familiaViajeKey(p: Plan): string {
  return `${p.cramo ?? ''}|${nombreSinDias(p.name || p.cplan)}`;
}

/** Suma asegurada del nombre del plan: «1.500$», «3.000 $», «5000$». */
export function sumaDelNombre(name: string): number | null {
  const m = String(name || '').match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?\s*\$/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Días que cubre cada plan, según lo que dice el plan. */
function tramosViaje(plans: Plan[]): TramoPlan[] {
  const tramos: TramoPlan[] = [];
  const porFamilia = new Map<string, Plan[]>();

  for (const p of plans) {
    const familia = familiaViajeKey(p);
    const max = enteroPositivo(p.ndiasMax);
    if (max != null) {
      const min = Math.min(enteroPositivo(p.ndiasMin) ?? 1, max);
      tramos.push({ plan: p, familia, min, max, exacto: false });
      continue;
    }
    if (enteroPositivo(p.ndias) == null) continue;
    const lista = porFamilia.get(familia) ?? [];
    lista.push(p);
    porFamilia.set(familia, lista);
  }

  for (const [familia, miembros] of porFamilia) {
    const orden = [...miembros].sort((a, b) => Number(a.ndias) - Number(b.ndias));
    let fijos = orden.filter((p) => p.ndiasFijo);
    let abiertos = orden.filter((p) => !p.ndiasFijo);
    // Sin datos de maplanes_frec (solo el nombre): el de más días es el abierto, como SysIP.
    if (!fijos.length && orden.length > 1) {
      fijos = orden.slice(0, -1);
      abiertos = orden.slice(-1);
    }
    const desde = fijos.length ? Number(fijos[0].ndias) : 1;
    for (const p of fijos) {
      tramos.push({ plan: p, familia, min: Number(p.ndias), max: Number(p.ndias), exacto: true });
    }
    for (const p of abiertos) {
      tramos.push({ plan: p, familia, min: Math.min(desde, Number(p.ndias)), max: Number(p.ndias), exacto: false });
    }
  }

  if (tramos.length) return tramos;
  // Ningún plan dice sus días: se ofrecen todos, sin tope.
  return plans.map((p) => ({ plan: p, familia: familiaViajeKey(p), min: 1, max: null, exacto: false }));
}

function cubre(t: TramoPlan, ndias: number): boolean {
  return ndias >= t.min && (t.max == null || ndias <= t.max);
}

function unirRango(a: RangoDiasViaje | null, t: { min: number; max: number | null }): RangoDiasViaje {
  if (!a) return { min: t.min, max: t.max };
  return {
    min: Math.min(a.min, t.min),
    max: a.max == null || t.max == null ? null : Math.max(a.max, t.max),
  };
}

/** Plan de la familia con los días del viaje (nombre real de Sis2000; vigencia = días del viaje). */
export function planConDiasViaje(plan: Plan, ndias: number): Plan {
  const dias = `${ndias} día${ndias === 1 ? '' : 's'}`;
  return {
    ...plan,
    ndias,
    tag: `Viajero · ${dias}`,
    desc: `Cobertura por ${dias} para las personas aseguradas.`,
    benefits: (plan.benefits ?? []).map((b) => (/^Vigencia de \d+ d/.test(b) ? `Vigencia de ${dias}` : b)),
  };
}

function ordenarOpciones(a: OpcionPlanViaje, b: OpcionPlanViaje): number {
  const sa = a.sumaNombre ?? Number.POSITIVE_INFINITY;
  const sb = b.sumaNombre ?? Number.POSITIVE_INFINITY;
  if (sa !== sb) return sa - sb;
  return String(a.plan.name).localeCompare(String(b.plan.name));
}

/** Familias del canal con los días que cubre cada una (para explicar cuando no hay planes). */
export function familiasViaje(plans: Plan[]): FamiliaViaje[] {
  const rangos = new Map<string, { rango: RangoDiasViaje; nombre: string; suma: number | null }>();
  for (const t of tramosViaje(plans)) {
    const prev = rangos.get(t.familia);
    rangos.set(t.familia, {
      rango: unirRango(prev?.rango ?? null, t),
      nombre: prev?.nombre ?? t.plan.name,
      suma: prev?.suma ?? sumaDelNombre(t.plan.name),
    });
  }
  return [...rangos.entries()]
    .map(([key, v]) => ({ key, rango: v.rango, sumaNombre: v.suma, nombre: v.nombre }))
    .sort((a, b) => (a.sumaNombre ?? Number.POSITIVE_INFINITY) - (b.sumaNombre ?? Number.POSITIVE_INFINITY));
}

/** Días mínimos y máximos del viaje entre todos los planes (límites de las fechas). */
export function limitesDiasViaje(plans: Plan[]): RangoDiasViaje | null {
  let rango: RangoDiasViaje | null = null;
  for (const t of tramosViaje(plans)) rango = unirRango(rango, t);
  return rango;
}

/**
 * Planes que aplican a un viaje de `ndias` días: uno por familia (el de los días exactos; si no hay,
 * el abierto de menos días que los cubra), ordenados por suma asegurada.
 */
export function opcionesViajeParaDias(plans: Plan[], ndias: number): OpcionPlanViaje[] {
  if (!Number.isInteger(ndias) || ndias < 1) return [];
  const tramos = tramosViaje(plans);
  const rangoFamilia = new Map<string, RangoDiasViaje>();
  for (const t of tramos) rangoFamilia.set(t.familia, unirRango(rangoFamilia.get(t.familia) ?? null, t));

  const elegido = new Map<string, TramoPlan>();
  for (const t of tramos) {
    if (!cubre(t, ndias)) continue;
    const prev = elegido.get(t.familia);
    if (!prev) {
      elegido.set(t.familia, t);
      continue;
    }
    if (prev.exacto) continue;
    const prevMax = prev.max ?? Number.POSITIVE_INFINITY;
    const max = t.max ?? Number.POSITIVE_INFINITY;
    if (t.exacto || max < prevMax) elegido.set(t.familia, t);
  }

  return [...elegido.values()]
    .map((t) => ({
      key: t.familia,
      plan: planConDiasViaje(t.plan, ndias),
      rango: rangoFamilia.get(t.familia)!,
      sumaNombre: sumaDelNombre(t.plan.name),
    }))
    .sort(ordenarOpciones);
}
