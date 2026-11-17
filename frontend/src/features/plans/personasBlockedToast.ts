import { PolicyEmitError } from '../../lib/api';
import { toast } from '../../store/toastStore';

/** Aviso cuando la validación o la solicitud de personas no deja continuar (póliza vigente, rechazo del cuestionario…). */
export function toastPersonasBlocked(err: unknown) {
  const code = err instanceof PolicyEmitError ? err.code : '';
  const msg =
    err instanceof Error
      ? err.message
      : 'Ya existe una póliza activa para este asegurado.';
  if (code === 'PERSONAS_DUPLICATE' || /póliza vigente|mismo asegurado/i.test(msg)) {
    toast.warning(
      'Póliza vigente',
      'Este asegurado ya tiene una póliza activa. No se envía al técnico ni se continúa al pago.',
      8000,
    );
    return;
  }
  if (code === 'HEALTH_BLOCKED') {
    toast.warning(
      'Cuestionario de salud',
      msg || 'Según tus respuestas, la solicitud no puede continuar en línea.',
      9000,
    );
    return;
  }
  toast.error('No se puede continuar', msg);
}
