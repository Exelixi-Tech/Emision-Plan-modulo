/**
 * Frecuencia de pago La Mundial (ifrecuencia).
 *
 * Cotización nacional: mprimaext anual; el código divide USD por cuotas.
 * Bs del recibo = ROUND((ROUND(mprimaext,2)/cuotas)×ptasa, 2) — paridad Sis2000.
 * Binacional A/M/T/S: igual que nacional — prima anual en API, UI divide cuotas.
 * Solo D/B (Hasta 3 días): la API recotiza con vigencia corta (ndias).
 * Emisión: prima cotizada + ifrecuencia (Sis2000 genera los recibos).
 * UI: solo PaymentStep usa esta utilidad para mostrar el monto del 1er recibo.
 */
import type { PolicyQuote } from '../types';
import { computeQuoteVes, formatQuoteUsdMoney, normalizeQuoteUsd, resolveQuotePtasa, roundQuoteAmount } from './money';

/** Cuotas por vigencia anual — paridad adrecibos / sp_genera_coberturas_recibos_auto_rcv_nexus */
const CUOTAS_BY_FREC: Record<string, number> = {
  A: 1,
  S: 2,
  T: 4,
  C: 3,
  M: 12,
  E: 1,
  D: 1,
  B: 1,
};

export function normalizeFrecuenciaCode(code?: string | null): string {
  const c = String(code ?? 'A').trim().toUpperCase();
  return c.charAt(0) || 'A';
}

const FREQ_FRACCIONADA = new Set(['M', 'T', 'S']);

/** M/T/S → pago fraccionado (domiciliación SyPago en Pagos). */
export function isFrecuenciaFraccionada(code?: string | null): boolean {
  return FREQ_FRACCIONADA.has(normalizeFrecuenciaCode(code));
}

/**
 * Personas: A/S/T/M como RCV (Pagos cobra la 1ª cuota y domicilia el resto).
 * C (cuatrimestral) no se ofrece. Si no queda ninguna, se usa `fallback` (Anual).
 */
export function frecuenciasPersonas<T extends { code: number | string }>(items: T[], fallback: T[]): T[] {
  const list = items.filter((i) => normalizeFrecuenciaCode(String(i.code)) !== 'C');
  return list.length ? list : fallback;
}

export function getCuotasByFrecuencia(code?: string | null): number {
  const n = CUOTAS_BY_FREC[normalizeFrecuenciaCode(code)];
  return n != null && n > 0 ? n : 1;
}

export function getFrecuenciaPeriodSuffix(code?: string | null): string {
  const map: Record<string, string> = {
    M: '/ mes',
    T: '/ trimestre',
    C: '/ cuatrimestre',
    S: '/ semestre',
    A: '/ año',
    E: '/ pago',
  };
  return map[normalizeFrecuenciaCode(code)] ?? '/ cuota';
}

export function getFrecuenciaPaySummary(
  code?: string | null,
  label?: string,
): string {
  const c = normalizeFrecuenciaCode(code);
  const cuotas = getCuotasByFrecuencia(c);
  if (label?.trim()) {
    if (cuotas === 1) return `Pagas ${label.toLowerCase()}`;
    return `${cuotas} cuotas · ${label}`;
  }
  const defaults: Record<string, string> = {
    M: 'Pagas mensualmente · 12 cuotas',
    T: 'Pagas trimestralmente · 4 cuotas',
    C: 'Pagas cuatrimestralmente · 3 cuotas',
    S: 'Pagas semestralmente · 2 cuotas',
    A: 'Pagas anualmente',
  };
  return defaults[c] ?? `Pagas en ${cuotas} cuota${cuotas === 1 ? '' : 's'}`;
}

/** Texto aclaratorio según tipo de cotización. */
export function getFrecuenciaQuoteNote(
  amounts: FrecuenciaAmounts,
  quoteBasis: 'annual-total' | 'per-installment' = 'annual-total',
): string | null {
  if (quoteBasis === 'per-installment') {
    if (amounts.installmentUsd <= 0) return null;
    return `Prima cotizada ${formatQuoteUsdMoney(amounts.installmentUsd)}${amounts.periodSuffix}`;
  }
  if (amounts.cuotas <= 1 || amounts.annualUsd <= 0) return null;
  if (amounts.rcvCuotaInicialUsd > 0) {
    return `Prima anual cotizada ${formatQuoteUsdMoney(amounts.annualUsd)}: RCV ${formatQuoteUsdMoney(amounts.rcvCuotaInicialUsd)} completa en la cuota inicial + ${formatQuoteUsdMoney(amounts.nextInstallmentUsd)} por cuota (${amounts.cuotas} cuotas)`;
  }
  return `Prima anual cotizada ${formatQuoteUsdMoney(amounts.annualUsd)} ÷ ${amounts.cuotas} cuotas`;
}

/** Montos coherentes para hero (planes/pagos) y 1er recibo. */
export function resolveQuoteDisplayAmounts(
  amounts: FrecuenciaAmounts,
  quoteBasis: 'annual-total' | 'per-installment' = 'annual-total',
): {
  heroUsd: number;
  heroVes: number;
  heroUsdSuffix: string;
  heroVesSuffix: string;
  paymentUsd: number;
  paymentVes: number;
  totalLabel: string;
} {
  const periodQuote = quoteBasis === 'per-installment';
  const multiReceipt = amounts.cuotas > 1;

  if (periodQuote && !multiReceipt) {
    const suffix = amounts.periodSuffix || '';
    return {
      heroUsd: amounts.installmentUsd,
      heroVes: amounts.installmentVes,
      heroUsdSuffix: suffix,
      heroVesSuffix: suffix,
      paymentUsd: amounts.installmentUsd,
      paymentVes: amounts.installmentVes,
      totalLabel: `Total a pagar${suffix ? ` (${suffix.trim()})` : ''}`,
    };
  }

  if (multiReceipt) {
    return {
      heroUsd: amounts.annualUsd,
      heroVes: amounts.annualVes,
      heroUsdSuffix: '/ año',
      heroVesSuffix: '/ año',
      paymentUsd: amounts.installmentUsd,
      paymentVes: amounts.installmentVes,
      totalLabel: amounts.rcvCuotaInicialUsd > 0
        ? 'Total a pagar (1er recibo, incluye RCV completa)'
        : 'Total a pagar (1er recibo)',
    };
  }

  return {
    heroUsd: amounts.annualUsd,
    heroVes: amounts.annualVes,
    heroUsdSuffix: '/ año',
    heroVesSuffix: '/ año',
    paymentUsd: amounts.installmentUsd,
    paymentVes: amounts.installmentVes,
    totalLabel: 'Total a pagar (prima anual)',
  };
}

export interface FrecuenciaAmounts {
  cuotas: number;
  /** Prima anual USD (valor de cotización). */
  annualUsd: number;
  /** Prima anual Bs. */
  annualVes: number;
  /** Monto por cuota USD. */
  installmentUsd: number;
  /** Monto por cuota Bs. */
  installmentVes: number;
  /** Cuotas 2..n en USD (sin la RCV obligatoria); igual a installmentUsd si no aplica la regla. */
  nextInstallmentUsd: number;
  /** Cuotas 2..n en Bs. */
  nextInstallmentVes: number;
  /** Parte de la cuota inicial que es RCV obligatoria completa (USD); 0 si no aplica. */
  rcvCuotaInicialUsd: number;
  periodSuffix: string;
  paySummary: string;
}

function divideByCuotas(amount: number, cuotas: number): number {
  return cuotas > 0 ? amount / cuotas : amount;
}

/** ROUND((mprimaext/cuotas)×ptasa, 2) o ROUND(mprimaext×ptasa, 2) si ya es cuota. */
function roundInstallmentVes(ves: number): number {
  return roundQuoteAmount(ves, 2);
}

/**
 * @param quoteBasis
 *   - `annual-total`: mprimaext es prima anual (RCV auto vía spCalculoAuto).
 *   - `per-installment`: mprimaext ya es el monto del periodo (p. ej. spCalculoPer).
 */
export function resolveFrecuenciaAmounts(
  quote: PolicyQuote | null,
  frecuenciaCode?: string | null,
  options?: { frecuenciaLabel?: string; quoteBasis?: 'annual-total' | 'per-installment' },
): FrecuenciaAmounts {
  let cuotas = getCuotasByFrecuencia(frecuenciaCode);
  const basis = options?.quoteBasis ?? 'annual-total';
  const rawUsd = quote?.mprimaext ?? 0;
  const rawVes = quote?.mprima ?? 0;
  const ptasa = resolveQuotePtasa(quote?.ptasa);

  let annualUsd: number;
  let annualVes: number;
  let installmentUsd: number;
  let installmentVes: number;
  let nextInstallmentUsd: number;
  let nextInstallmentVes: number;
  let rcvCuotaInicialUsd = 0;

  if (basis === 'per-installment') {
    installmentUsd = normalizeQuoteUsd(rawUsd);
    installmentVes = roundInstallmentVes(
      ptasa > 0 ? computeQuoteVes(installmentUsd, ptasa) : rawVes,
    );
    annualUsd = roundQuoteAmount(installmentUsd * cuotas, 2);
    annualVes = ptasa > 0
      ? roundQuoteAmount(computeQuoteVes(annualUsd, ptasa), 2)
      : rawVes * cuotas;
    nextInstallmentUsd = installmentUsd;
    nextInstallmentVes = installmentVes;
  } else {
    annualUsd = normalizeQuoteUsd(rawUsd);
    annualVes = ptasa > 0
      ? roundQuoteAmount(computeQuoteVes(annualUsd, ptasa), 2)
      : rawVes;
    // RCV obligatoria (Daños a personas y a cosas) completa en la cuota inicial; el resto se divide.
    // Misma regla que sp_genera_coberturas_recibos_auto_rcv_nexus al generar los recibos en Sis2000.
    const rcvUsd = cuotas > 1 ? Math.max(0, Number(quote?.primaCuotaInicial ?? 0)) : 0;
    if (rcvUsd > 0 && rcvUsd >= annualUsd) {
      // Solo hay RCV: nada que fraccionar, Sis2000 emite un único recibo.
      cuotas = 1;
    }
    rcvCuotaInicialUsd = cuotas > 1 && rcvUsd > 0 ? roundQuoteAmount(rcvUsd, 2) : 0;
    const restoUsd = annualUsd - rcvCuotaInicialUsd;
    nextInstallmentUsd = divideByCuotas(restoUsd, cuotas);
    installmentUsd = rcvCuotaInicialUsd + nextInstallmentUsd;
    const vesShare = (usd: number) => (annualUsd > 0 ? rawVes * (usd / annualUsd) : 0);
    installmentVes = roundInstallmentVes(
      ptasa > 0
        ? computeQuoteVes(installmentUsd, ptasa)
        : (rcvCuotaInicialUsd > 0 ? vesShare(installmentUsd) : divideByCuotas(rawVes, cuotas)),
    );
    nextInstallmentVes = roundInstallmentVes(
      ptasa > 0
        ? computeQuoteVes(nextInstallmentUsd, ptasa)
        : (rcvCuotaInicialUsd > 0 ? vesShare(nextInstallmentUsd) : divideByCuotas(rawVes, cuotas)),
    );
  }

  return {
    cuotas,
    annualUsd,
    annualVes,
    installmentUsd,
    installmentVes,
    nextInstallmentUsd,
    nextInstallmentVes,
    rcvCuotaInicialUsd,
    periodSuffix: getFrecuenciaPeriodSuffix(frecuenciaCode),
    paySummary: getFrecuenciaPaySummary(frecuenciaCode, options?.frecuenciaLabel),
  };
}

/** Código de frecuencia activo según producto del wizard. */
export function resolveWizardFrecuenciaCode(
  hasVehicle: boolean,
  rcvFrecuencia?: string,
  funeralFrecuencia?: string,
): string {
  return normalizeFrecuenciaCode(hasVehicle ? rcvFrecuencia : funeralFrecuencia);
}

/** Vigencia corta (D/B): el SP cotiza el periodo (ndias), no la prima anual. Binacional A/M/T/S: anual como RCV nacional. */
export function rcvQuoteUsesPeriodPremium(
  _tipoPlaca?: string | null,
  frecuenciaCode?: string | null,
  _tipoCarnet?: string | null,
): boolean {
  const freq = normalizeFrecuenciaCode(frecuenciaCode);
  return freq === 'D' || freq === 'B';
}

export function resolveRcvQuoteBasis(
  tipoPlaca?: string | null,
  frecuenciaCode?: string | null,
  tipoCarnet?: string | null,
): 'annual-total' | 'per-installment' {
  return rcvQuoteUsesPeriodPremium(tipoPlaca, frecuenciaCode, tipoCarnet)
    ? 'per-installment'
    : 'annual-total';
}

/** Solo recotizar al cambiar frecuencia cuando la vigencia del SP cambia. */
export function rcvQuoteIncludesFrecuenciaSig(
  tipoPlaca?: string | null,
  frecuenciaCode?: string | null,
  tipoCarnet?: string | null,
): boolean {
  return rcvQuoteUsesPeriodPremium(tipoPlaca, frecuenciaCode, tipoCarnet);
}
