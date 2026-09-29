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
  /** Ramo La Mundial asociado (RCV=18, Funerario=9, Vida=1, AP=5). 0 en flujo Exélixi genérico. */
  cramo: number;
  /** Código de producto La Mundial (57=Funerario, 76=Vida, 78=AP, 79=AP). */
  cproducto?: string;
  /** True si el flujo incluye datos de vehículo (RCV). */
  hasVehicle: boolean;
  exelixiCatalog?: boolean;
  builderProductId?: string;
}

/** Ramo patrimonial por defecto. Solo aplica si el SSO no envía `cramo`. */
export const PATRIMONIAL_RAMO_DEFAULT = parseInt(
  import.meta.env.VITE_LAMUNDIAL_RAMO_PATRIMONIAL || '20',
  10,
);

export const PRODUCTS: Record<ProductId, ProductConfig> = {
  rcv:          { id: 'rcv',          label: 'RCV',          fullLabel: 'Suscripción RCV',               cramo: 18, hasVehicle: true  },
  funerario:    { id: 'funerario',    label: 'Funerario',    fullLabel: 'Seguro Funerario',              cramo: 9,  cproducto: '57', hasVehicle: false },
  patrimoniales:{ id: 'patrimoniales',label: 'Patrimoniales',fullLabel: 'Seguro Patrimonial',           cramo: PATRIMONIAL_RAMO_DEFAULT, hasVehicle: false },
  /** Vida Individual La Mundial — cproducto 76, ramo 1 */
  vida:         { id: 'vida',         label: 'Vida',         fullLabel: 'Seguro de Vida',                cramo: 1,  cproducto: '76', hasVehicle: false },
  /** Accidentes Personales cproducto 78, ramo 5 */
  ap:           { id: 'ap',           label: 'AP',           fullLabel: 'Accidentes Personales',         cramo: 5,  cproducto: '78', hasVehicle: false },
  /** Accidentes Personales cproducto 79, ramo 5 */
  ap79:         { id: 'ap79',         label: 'AP79',         fullLabel: 'Accidentes Personales (79)',    cramo: 5,  cproducto: '79', hasVehicle: false },
  'com-fam': { id: 'com-fam', label: 'Combinado Familiar', fullLabel: 'Seguro Combinado Familiar', cramo: 28, hasVehicle: false },
  combinado_familiar: { id: 'combinado_familiar', label: 'Combinado Familiar', fullLabel: 'Seguro Combinado Familiar', cramo: 28, hasVehicle: false },
  proveedor: { id: 'proveedor', label: 'Plan Proveedor', fullLabel: 'Planes con Proveedor', cramo: 28, hasVehicle: false },
};

/** Ramo externo maplanes para BINAC* (confirmado: cramo 28; también existe fila duplicada en 18). */
export const RCV_RAMO_BINACIONAL = parseInt(
  import.meta.env.VITE_LAMUNDIAL_RAMO_BINACIONAL || '28',
  10,
);

const VALID_PRODUCTS: ProductId[] = ['rcv', 'funerario', 'patrimoniales', 'vida', 'ap', 'ap79', 'com-fam', 'combinado_familiar', 'proveedor'];
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
  if (label.includes('vida')) {
    try { sessionStorage.setItem(STORAGE_KEY, 'vida'); } catch { /* ignore */ }
    return 'vida';
  }
  if (label.includes('accidente') || label.includes(' ap ') || label.includes('ap79')) {
    try { sessionStorage.setItem(STORAGE_KEY, 'ap'); } catch { /* ignore */ }
    return 'ap';
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

/** True si el producto usa el wizard de personas (funerario, vida, AP). */
export function isFunerarioLike(): boolean {
  const id = getProductId();
  return id === 'funerario' || id === 'vida' || id === 'ap' || id === 'ap79';
}

export function isPatrimoniales(): boolean {
  return getProductId() === 'patrimoniales';
}

export function isRcv(): boolean {
  return getProductId() === 'rcv';
}

export function isCombinadoFamiliar(): boolean {
  const p = getProductId();
  return p === 'com-fam' || p === 'combinado_familiar' || p === 'proveedor';
}

