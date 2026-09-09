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

export type TarjetaPlanCurrencyKind = 'usd' | 'ves';

export function resolveTarjetaPlanCurrency(cmoneda?: unknown): TarjetaPlanCurrencyKind {
  const code = String(cmoneda ?? '$').trim().toUpperCase();
  if (code === 'BS' || code === 'B' || code === 'BOLIVAR' || code === 'BOLÍVAR' || code === 'VES') {
    return 'ves';
  }
  return 'usd';
}

export function getTarjetaPlanCmoneda(metadataCanal?: Record<string, unknown> | null): string {
  const meta = metadataCanal ?? readTarjetaMetadataCanal();
  const raw = meta?.cmoneda;
  return raw != null && String(raw).trim() ? String(raw).trim() : '$';
}

export function tarjetaQuoteShowsVes(cmoneda?: unknown): boolean {
  return resolveTarjetaPlanCurrency(cmoneda) === 'ves';
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
    sessionStorage.setItem('exelixi_product', 'rcv');
  } catch {
    /* ignore */
  }
}

export function withTarjetaFlowQuery(url: string): string {
  if (!isTarjetaRcvFlow()) return url;
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set('flujo', 'tarjeta');
    if (!u.searchParams.get('product')) u.searchParams.set('product', 'rcv');
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
  out.product = 'rcv';
  return out;
}

export function getPagosContinueUrlForTarjeta(): string {
  const configured = import.meta.env.VITE_PAGOS_CONTINUE_BASE as string | undefined;
  const base = (configured?.replace(/\/$/, '') || '/pagos').replace(/\/$/, '');
  const params = new URLSearchParams({ product: 'rcv', flujo: 'tarjeta', wizardStep: '5' });
  return `${base}/?${params.toString()}`;
}

/** Emisión → Pagos sin bridge ni nexus_token. */
export function continueTarjetaToPagos(): void {
  persistFlowHandoff(collectWizardSnapshot());
  markTarjetaPublicSession();
  window.location.href = getPagosContinueUrlForTarjeta();
}
