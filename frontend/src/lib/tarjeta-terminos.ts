/**
 * PDF de Términos y Condiciones del flujo de tarjeta (RCV y personas).
 * Antes dependía solo de VITE_TARJETA_TERMINOS_URL en el build: si se omitía, el enlace desaparecía.
 * Ahora cae al PDF que sirve el módulo Formulario en el mismo origen (/formulario/legal/…).
 */
const TERMINOS_PATH = '/formulario/legal/terminos-y-condiciones-lms.pdf';

export function getTarjetaTerminosUrl(): string {
  const env = (import.meta.env.VITE_TARJETA_TERMINOS_URL as string | undefined)?.trim();
  if (env) return env;
  try {
    return new URL(TERMINOS_PATH, window.location.origin).toString();
  } catch {
    return TERMINOS_PATH;
  }
}
