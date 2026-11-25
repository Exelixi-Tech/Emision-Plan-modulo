import { useId } from 'react';
import { MessageSquareText } from 'lucide-react';
import { useWizardStore } from '../../store/wizardStore';
import { Textarea } from '../../components/ui/FormField';
import { OBSERVACIONES_MAX, limitarObservaciones, observacionesRestantes } from '../../lib/observaciones';

/**
 * Observaciones de la póliza RCV (opcional, máx. 255). Vive en state.rcv.observaciones:
 * el bridge lo guarda en la sesión del flujo (se conserva al volver) y Pagos lo reenvía al emitir.
 */
export function RcvObservacionesField() {
  const id = useId();
  const observaciones = useWizardStore((s) => s.rcv.observaciones ?? '');
  const setRcv = useWizardStore((s) => s.setRcv);
  const restantes = observacionesRestantes(observaciones);

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest inline-flex items-center gap-1.5"
      >
        <MessageSquareText size={11} className="text-indigo-500" />
        Observaciones (opcional)
      </label>
      <Textarea
        id={id}
        rows={3}
        maxLength={OBSERVACIONES_MAX}
        value={observaciones}
        onChange={(e) => setRcv({ observaciones: limitarObservaciones(e.target.value) }, { keepQuote: true })}
        placeholder="Ej.: datos adicionales que deban quedar registrados en la póliza"
        aria-describedby={`${id}-ayuda`}
      />
      <div id={`${id}-ayuda`} className="flex items-center justify-between gap-3 text-[0.72rem] text-slate-500">
        <span>Se guarda en la póliza.</span>
        <span className={restantes <= 20 ? 'font-semibold text-amber-700' : undefined}>
          {observaciones.length}/{OBSERVACIONES_MAX}
        </span>
      </div>
    </div>
  );
}
