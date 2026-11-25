/**
 * Observaciones de la póliza RCV (adpoliza.xobserva, VARCHAR(255)).
 * Viajan en state.rcv.observaciones: Pagos reenvía state.rcv completo al emitir.
 */
export const OBSERVACIONES_MAX = 255;

/** Lo que se deja escribir en el campo: corta en 255 (pegar un texto largo no rompe la emisión). */
export function limitarObservaciones(raw: unknown): string {
  return typeof raw === 'string' ? raw.slice(0, OBSERVACIONES_MAX) : '';
}

/** Caracteres que le quedan al usuario para el contador. */
export function observacionesRestantes(raw: unknown): number {
  return OBSERVACIONES_MAX - limitarObservaciones(raw).length;
}
