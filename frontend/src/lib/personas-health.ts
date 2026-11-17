/**
 * Cuestionario de salud de personas: helpers compartidos por el flujo de personas
 * (FuneralPlansApp: Vida/AP/Salud/Funerario) y Plan Proveedor / Combinado Familiar
 * (ProveedorPlansApp). Sin dependencias de runtime para poder probarlo con `node --test`.
 */
import type { HealthQuestion } from './api';
import type { FuneralData, Plan, ProveedorItem } from '../types';

/** Texto de la frecuencia en el resumen del cuestionario. */
export const FREC_LABELS: Record<string, string> = {
  M: 'Pago mensual',
  T: 'Pago trimestral',
  C: 'Pago cuatrimestral',
  S: 'Pago semestral',
  A: 'Pago anual',
};

export function getSessionId(): string {
  try {
    return new URLSearchParams(window.location.search).get('sid') || 'standalone';
  } catch {
    return 'standalone';
  }
}

/** Misma llave que el servidor (funeralHealthScoring.insuredKey). */
export function insuredKey(person: { tipoDoc?: string; identificacion?: string }, idx: number) {
  const id = String(person.identificacion ?? '').replace(/\D/g, '');
  if (id) return `${String(person.tipoDoc || 'V').trim()}-${id}`;
  return `aseg-${idx}`;
}

export function insuredLabel(person: { nombre?: string; apellido?: string; identificacion?: string }, idx: number) {
  const name = [person.nombre, person.apellido].filter(Boolean).join(' ').trim();
  return name || String(person.identificacion || '').trim() || `Asegurado ${idx + 1}`;
}

/**
 * Como SysIP: los términos solo se exigen si el cuestionario del producto los pregunta.
 * Producto sin pregunta `aceptaTerminos` (ej. Salud Individual) no bloquea en Pagos.
 */
export function mapHealthToFuneral(
  byInsured: Record<string, Record<string, unknown>>,
  questions: HealthQuestion[],
) {
  const first = Object.values(byInsured)[0] ?? {};
  const pideTerminos = questions.some((q) => q.id === 'aceptaTerminos');
  return {
    diagnosticoEnfermedad: first.diagnosticoEnfermedad === true,
    descripcionEnfermedad: String(first.descripcionEnfermedad ?? ''),
    aceptaTerminos: pideTerminos ? first.aceptaTerminos === true : true,
    healthAnswers: first,
    healthAnswersByInsured: byInsured,
    healthQuestionnaireDone: true,
  };
}

// ── Plan Proveedor / Combinado Familiar ─────────────────────────────────────

/** Combinado Familiar (único producto que abre Plan Proveedor hoy). */
export const CPRODUCTO_PROVEEDOR_DEFAULT = '51';

/**
 * Producto y ramo con que se pide el cuestionario del Plan Proveedor: el cproducto del SSO
 * (51 = Combinado Familiar → ramo 51 en el servidor); sin SSO, el del producto o 51.
 */
export function proveedorQuestionnaireRequest(
  meta: { cproducto?: unknown; cramo?: unknown } | null | undefined,
  product: { cproducto?: string; cramo: number },
): { cproducto: string; cramo: number } {
  const cproducto =
    String(meta?.cproducto ?? '').trim() ||
    String(product.cproducto ?? '').trim() ||
    CPRODUCTO_PROVEEDOR_DEFAULT;
  const sso = Number(meta?.cramo);
  const cramo = Number.isFinite(sso) && sso > 0 ? sso : product.cramo;
  return { cproducto, cramo };
}

/**
 * Estado del cuestionario al elegir plan. Sin preguntas: se da por resuelto (como siempre en
 * Plan Proveedor). Con preguntas: queda pendiente hasta responderlas al confirmar.
 * Los términos no se tocan aquí: se aceptan con la casilla del proveedor.
 */
export function proveedorHealthPatch(hasQuestions: boolean): Partial<FuneralData> {
  return {
    healthQuestionnaireDone: !hasQuestions,
    healthAnswers: {},
    healthAnswersByInsured: {},
    diagnosticoEnfermedad: false,
    descripcionEnfermedad: '',
  };
}

/**
 * Plan con el proveedor elegido adentro (`selectedPlan.proveedor`) y el cproducto. Así la
 * solicitud que queda en mesa técnica conserva el proveedor: el link de pago de Nexus copia
 * `selectedPlan` y Pagos lo lee de ahí para registrarlo en adproveedor al emitir.
 */
export function planConProveedor(
  plan: Plan,
  proveedor: ProveedorItem | null | undefined,
  cproducto: string,
): Plan & { proveedor?: ProveedorItem } {
  return {
    ...plan,
    cproducto: plan.cproducto || cproducto,
    ...(proveedor ? { proveedor: { ...proveedor } } : {}),
  };
}
