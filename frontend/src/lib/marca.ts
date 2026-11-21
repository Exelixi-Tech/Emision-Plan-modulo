/**
 * Modo «marca neutra» (flujo de prueba del MarketPlace Exélixi).
 *
 * Contrato común portal + módulos:
 *   - `?marca=neutra` → sessionStorage['exelixi_marca'] = 'neutra'
 *   - `?marca=lm`     → se borra la clave (vuelve La Mundial)
 *   - sin parámetro   → lo guardado (OCR/Formulario/Emisión/Pagos comparten origen)
 *
 * Con el modo activo no se muestra nada de La Mundial: wordmark tipográfico «Exélixi».
 * Sin el modo, todo queda exactamente igual.
 */
import { publicAsset } from './app-base';

export const MARCA_STORAGE_KEY = 'exelixi_marca';
export const MARCA_QUERY_KEY = 'marca';
export const MARCA_NEUTRA = 'neutra';
export const MARCA_NEUTRA_WORDMARK = 'Exélixi';

const TITULO_NEUTRO = 'Exélixi · Emisión';

let cached: boolean | null = null;

function resolveMarcaNeutra(): boolean {
  if (typeof window === 'undefined') return false;
  let fromUrl: string | null = null;
  try {
    fromUrl = new URLSearchParams(window.location.search).get(MARCA_QUERY_KEY);
  } catch {
    fromUrl = null;
  }
  const value = String(fromUrl ?? '').trim().toLowerCase();
  try {
    if (value === MARCA_NEUTRA) {
      sessionStorage.setItem(MARCA_STORAGE_KEY, MARCA_NEUTRA);
      return true;
    }
    if (value === 'lm') {
      sessionStorage.removeItem(MARCA_STORAGE_KEY);
      return false;
    }
    return sessionStorage.getItem(MARCA_STORAGE_KEY) === MARCA_NEUTRA;
  } catch {
    return value === MARCA_NEUTRA;
  }
}

/** true si el modo marca neutra está activo (se evalúa una vez al cargar). */
export function esMarcaNeutra(): boolean {
  if (cached === null) cached = resolveMarcaNeutra();
  return cached;
}

/** Agrega `marca=neutra` a una URL (relativa o absoluta) si el modo está activo. */
export function withMarcaQuery(url: string): string {
  if (!esMarcaNeutra()) return url;
  try {
    const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
    const u = new URL(url, window.location.origin);
    u.searchParams.set(MARCA_QUERY_KEY, MARCA_NEUTRA);
    return isAbsolute ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url;
  }
}

/** Etiqueta de tarifa del plan: «Tarifa La Mundial» o, en neutra, «Tarifa oficial». */
export function etiquetaTarifa(): string {
  return esMarcaNeutra() ? 'Tarifa oficial' : 'Tarifa La Mundial';
}

/** En marca neutra cambia «La Mundial (de Seguros)» por «la aseguradora» en textos dinámicos. */
export function textoSinMarca<T extends string | undefined | null>(text: T): T {
  if (!text || !esMarcaNeutra()) return text;
  return String(text)
    .replace(/la\s+mundial(\s+de\s+seguros)?/gi, 'la aseguradora')
    .replace(/lamundialdeseguros\.com/gi, 'aseguradora.com') as T;
}

function setMeta(name: string, content: string): void {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (meta) meta.content = content;
}

/** Fija dataset, título, metas y favicon neutros. Llamar antes del primer render. */
export function applyMarcaNeutra(): void {
  if (!esMarcaNeutra() || typeof document === 'undefined') return;
  try {
    document.documentElement.dataset.marca = MARCA_NEUTRA;
    document.title = TITULO_NEUTRO;
    setMeta('description', 'Emisión digital de pólizas — Exélixi.');
    setMeta('apple-mobile-web-app-title', MARCA_NEUTRA_WORDMARK);
    setMeta('application-name', MARCA_NEUTRA_WORDMARK);
    document
      .querySelectorAll<HTMLLinkElement>(
        'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="manifest"]',
      )
      .forEach((link) => link.remove());
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    link.href = publicAsset('exelixi-favicon.svg');
    document.head.appendChild(link);
  } catch {
    /* ignore */
  }
}
