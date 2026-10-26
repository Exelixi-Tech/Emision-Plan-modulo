import { useWizardStore } from '../store/wizardStore';
import { persistFlowHandoff, readFlowHandoff } from './flow-handoff';

export const TARJETA_FLOW_HEADER = 'X-Rcv-Tarjeta-Flow';

const TARJETA_SESSION_KEY = 'rcv_tarjeta_public_flow';
const TARJETA_METADATA_KEY = 'rcv_tarjeta_metadata_canal';

export function readTarjetaMetadataCanal(): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem(TARJETA_METADATA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function hydrateTarjetaMetadataCanal(): void {
  if (!shouldUseTarjetaPublicApi()) return;
  const stored = readTarjetaMetadataCanal();
  if (!stored?.cplan) return;
  const store = useWizardStore.getState();
  store.setMetadataCanal({ ...(store.metadataCanal || {}), ...stored });
}

export type TarjetaPlanCurrencyKind = 'usd' | 'ves' | 'eur';

export function resolveTarjetaPlanCurrency(cmoneda?: unknown): TarjetaPlanCurrencyKind {
  const code = String(cmoneda ?? '$').trim().toUpperCase();
  if (code === 'BS' || code === 'B' || code === 'BOLIVAR' || code === 'BOLÍVAR' || code === 'VES') {
    return 'ves';
  }
  if (code === 'EUR' || code === 'EU' || code === '€' || code === 'EURO') return 'eur';
  return 'usd';
}

/** Símbolo de la moneda del plan (sin tarjeta = $). */
export function tarjetaCurrencySymbol(kind?: TarjetaPlanCurrencyKind | null): string {
  if (kind === 'eur') return '€';
  if (kind === 'ves') return 'Bs';
  return '$';
}

/** Código junto al monto: USD / EUR (Bs no lleva sufijo). */
export function tarjetaCurrencyCode(kind?: TarjetaPlanCurrencyKind | null): string {
  if (kind === 'eur') return 'EUR';
  if (kind === 'ves') return '';
  return 'USD';
}

export function getTarjetaPlanCmoneda(metadataCanal?: Record<string, unknown> | null): string {
  const meta = metadataCanal ?? readTarjetaMetadataCanal();
  const raw = meta?.cmoneda;
  return raw != null && String(raw).trim() ? String(raw).trim() : '$';
}

export function tarjetaQuoteShowsVes(cmoneda?: unknown): boolean {
  return resolveTarjetaPlanCurrency(cmoneda) === 'ves';
}

/**
 * Producto del flujo tarjeta, que define OCR según la tarjeta validada: RCV o personas
 * (`funerario`: Vida, AP, Funerario, Viajero…). URL → metadata de la tarjeta → sesión.
 */
export function getTarjetaProductId(): 'rcv' | 'funerario' {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('product');
    if (fromUrl === 'rcv' || fromUrl === 'funerario') return fromUrl;
  } catch {
    /* ignore */
  }
  const fromMeta = String(readTarjetaMetadataCanal()?.product ?? '').trim();
  if (fromMeta === 'rcv' || fromMeta === 'funerario') return fromMeta;
  try {
    if (sessionStorage.getItem('exelixi_product') === 'funerario') return 'funerario';
  } catch {
    /* ignore */
  }
  return 'rcv';
}

export function isTarjetaRcvFlow(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const flujo = (params.get('flujo') || params.get('entrada') || '').trim().toLowerCase();
    if (flujo === 'tarjeta') return true;
    return sessionStorage.getItem(TARJETA_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function shouldUseTarjetaPublicApi(): boolean {
  return isTarjetaRcvFlow();
}

export function markTarjetaPublicSession(): void {
  try {
    sessionStorage.setItem(TARJETA_SESSION_KEY, '1');
    sessionStorage.setItem('exelixi_product', getTarjetaProductId());
  } catch {
    /* ignore */
  }
}

export function withTarjetaFlowQuery(url: string): string {
  if (!isTarjetaRcvFlow()) return url;
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set('flujo', 'tarjeta');
    if (!u.searchParams.get('product')) u.searchParams.set('product', getTarjetaProductId());
    return u.toString();
  } catch {
    return url;
  }
}

export function hydrateTarjetaHandoff(): void {
  if (!shouldUseTarjetaPublicApi()) return;
  const local = readFlowHandoff();
  if (!local) return;
  const set = (useWizardStore as unknown as { setState: (p: Record<string, unknown>) => void }).setState;
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(local)) {
    if (k !== 'step' && typeof v !== 'function') filtered[k] = v;
  }
  set(filtered);
}

function collectWizardSnapshot(): Record<string, unknown> {
  const s = useWizardStore.getState() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== 'function') out[k] = v;
  }
  out.product = getTarjetaProductId();
  return out;
}

export function getPagosContinueUrlForTarjeta(): string {
  const configured = import.meta.env.VITE_PAGOS_CONTINUE_BASE as string | undefined;
  const base = (configured?.replace(/\/$/, '') || '/pagos').replace(/\/$/, '');
  const params = new URLSearchParams({ product: getTarjetaProductId(), flujo: 'tarjeta', wizardStep: '5' });
  return `${base}/?${params.toString()}`;
}

/** Módulo dueño de cada paso del flujo tarjeta (sin bridge): 1 OCR · 2-3 Formulario · 4 Emisión · 5 Pagos. */
function tarjetaStepModulePath(step: number): string {
  if (step <= 1) return '/ocr';
  if (step <= 3) return '/formulario';
  if (step === 4) return '/emision';
  return '/pagos';
}

/** Este módulo (Emisión) solo pinta el paso 4. */
export function isTarjetaLocalStep(step: number): boolean {
  return step === 4;
}

/**
 * Paso a paso en flujo tarjeta (sin bridge): ir a un paso de otro módulo guardando el estado.
 * `volver=1` indica al módulo destino que hidrate desde el handoff y no desde el OCR.
 */
export function navigateTarjetaToStep(step: number): void {
  persistFlowHandoff(collectWizardSnapshot());
  markTarjetaPublicSession();
  const params = new URLSearchParams({
    product: getTarjetaProductId(),
    flujo: 'tarjeta',
    wizardStep: String(step),
    volver: '1',
  });
  window.location.href = `${tarjetaStepModulePath(step)}/?${params.toString()}`;
}

/** Emisión → Pagos sin bridge ni nexus_token. */
export function continueTarjetaToPagos(): void {
  persistFlowHandoff(collectWizardSnapshot());
  markTarjetaPublicSession();
  window.location.href = getPagosContinueUrlForTarjeta();
}

/** Tarjeta pagada en caja (Farmatodo, bfactura=1): el flujo no pasa por el paso de Pago. */
export function tarjetaYaPagada(metadataCanal?: Record<string, unknown> | null): boolean {
  if (!metadataCanal) return false;
  if (String(metadataCanal.flujo ?? '').trim().toLowerCase() !== 'tarjeta') return false;
  const v = (x: unknown) => x === true || x === 1 || x === '1' || x === 'true';
  return v(metadataCanal.skipPayment) || v(metadataCanal.bfactura);
}
