export interface PlanParentesco {
  cparen: number;
  xparentesco: string;
  min_edad: number;
  max_edad: number;
}

export function isTitularOnlyPlan(parentescos?: PlanParentesco[] | null): boolean {
  if (!parentescos?.length) return false;
  return parentescos.length === 1 && Number(parentescos[0].cparen) === 1;
}

/** Tope de personas del plan: 1 titular + nmax_dep, o 1 si solo admite titular. */
export function maxAseguradosDelPlan(opts: {
  maxAsegurados?: number | null;
  nmax_dep?: number | null;
  parentescos?: PlanParentesco[] | null;
}): number | null {
  const fromApi = Number(opts.maxAsegurados);
  if (Number.isFinite(fromApi) && fromApi > 0) return fromApi;
  const nmax = Number(opts.nmax_dep);
  if (Number.isFinite(nmax)) return Math.max(1, 1 + nmax);
  if (isTitularOnlyPlan(opts.parentescos)) return 1;
  return null;
}

export function additionalParentescos(parentescos?: PlanParentesco[] | null): PlanParentesco[] {
  return (parentescos ?? []).filter((p) => Number(p.cparen) !== 1);
}

export function ageFromFechaNac(fechaNac?: string): number | null {
  const raw = String(fechaNac || '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
  return age < 0 ? null : age;
}

export function ageErrorForParentesco(
  fechaNac: string | undefined,
  parentesco: string | undefined,
  parentescos?: PlanParentesco[] | null,
): string | undefined {
  if (!parentescos?.length || !parentesco) return undefined;
  const found = parentescos.find((p) => String(p.cparen) === String(parentesco));
  if (!found) return 'Este parentesco no aplica al plan seleccionado';
  const age = ageFromFechaNac(fechaNac);
  if (age == null) return undefined;
  const min = Number(found.min_edad);
  const max = Number(found.max_edad);
  if (Number.isFinite(min) && age < min) {
    return `Edad mínima para ${found.xparentesco}: ${min} años`;
  }
  if (Number.isFinite(max) && age > max) {
    return `Edad máxima para ${found.xparentesco}: ${max} años`;
  }
  return undefined;
}
