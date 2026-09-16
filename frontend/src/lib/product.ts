/**
 * Producto activo del flujo de suscripción.
 *
 * El producto se determina por el parámetro `?product=` de la URL (configurado
 * por el admin de Nexus en la URL de cada submódulo) y se conserva en
 * sessionStorage. Por defecto es `rcv` (comportamiento previo).
 */
import type { ProductId } from '../types';
import { getExelixiCatalogProductView, isExelixiCatalogFlow } from './exelixi-catalog';

export interface ProductConfig {
  id: ProductId;
  label: string;
  fullLabel: string;
  /** Ramo La Mundial asociado (RCV=18, Funerario=9). 0 en flujo Exélixi genérico. */
  cramo: number;
  /** True si el flujo incluye datos de vehículo (RCV). */
  hasVehicle: boolean;
  exelixiCatalog?: boolean;
  builderProductId?: string;
}

export const PRODUCTS: Record<ProductId, ProductConfig> = {
  rcv: { id: 'rcv', label: 'RCV', fullLabel: 'Suscripción RCV', cramo: 18, hasVehicle: true },
  funerario: { id: 'funerario', label: 'Funerario', fullLabel: 'Seguro Funerario', cramo: 9, hasVehicle: false },
  patrimoniales: { id: 'patrimoniales', label: 'Patrimoniales', fullLabel: 'Seguro Patrimonial', cramo: 20, hasVehicle: false },
};

/** Ramo externo maplanes para BINAC* (confirmado: cramo 28; también existe fila duplicada en 18). */
export const RCV_RAMO_BINACIONAL = parseInt(
  import.meta.env.VITE_LAMUNDIAL_RAMO_BINACIONAL || '28',
  10,
);

const VALID_PRODUCTS: ProductId[] = ['rcv', 'funerario', 'patrimoniales'];
const STORAGE_KEY = 'exelixi_product';

export interface ProductDetectHints {
  url?: string | null;
  nombre?: string | null;
  moduloNombre?: string | null;
  product?: string | null;
}

/**
 * Detecta rcv|funerario y lo persiste en sessionStorage (Nexus verify / bridge).
 */
export function persistProductFromHints(hints?: ProductDetectHints): ProductId | null {
  const raw = hints?.product != null ? String(hints.product).trim() : '';
  if (VALID_PRODUCTS.includes(raw as ProductId)) {
    try { sessionStorage.setItem(STORAGE_KEY, raw); } catch { /* ignore */ }
    return raw as ProductId;
  }
  if (hints?.url) {
    try {
      const fromUrl = new URL(hints.url, window.location.origin).searchParams.get('product');
      if (fromUrl && VALID_PRODUCTS.includes(fromUrl as ProductId)) {
        sessionStorage.setItem(STORAGE_KEY, fromUrl);
        return fromUrl as ProductId;
      }
    } catch { /* ignore */ }
  }
  const label = `${hints?.nombre ?? ''} ${hints?.moduloNombre ?? ''}`.toLowerCase();
  if (label.includes('funerar')) {
    try { sessionStorage.setItem(STORAGE_KEY, 'funerario'); } catch { /* ignore */ }
    return 'funerario';
  }
  if (label.includes('patrimonial')) {
    try { sessionStorage.setItem(STORAGE_KEY, 'patrimoniales'); } catch { /* ignore */ }
    return 'patrimoniales';
  }
  return null;
}

export function getProductId(): ProductId {
  try {
    const fromUrl = new URL(window.location.href).searchParams.get('product');
    if (fromUrl && VALID_PRODUCTS.includes(fromUrl as ProductId)) {
      sessionStorage.setItem(STORAGE_KEY, fromUrl);
      return fromUrl as ProductId;
    }
  } catch { /* ignore */ }
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored && VALID_PRODUCTS.includes(stored as ProductId)) return stored as ProductId;
  } catch { /* ignore */ }
  return 'rcv';
}

export function getProductConfig(): ProductConfig {
  if (isExelixiCatalogFlow()) {
    const catalog = getExelixiCatalogProductView();
    if (catalog) {
      return {
        id: 'rcv',
        label: catalog.label,
        fullLabel: catalog.fullLabel,
        cramo: 0,
        hasVehicle: catalog.hasVehicle,
        exelixiCatalog: true,
        builderProductId: catalog.builderProductId,
      };
    }
  }
  return PRODUCTS[getProductId()];
}

export function isFunerario(): boolean {
  return getProductId() === 'funerario';
}

export function isPatrimoniales(): boolean {
  return getProductId() === 'patrimoniales';
}

export function isRcv(): boolean {
  return getProductId() === 'rcv';
}
