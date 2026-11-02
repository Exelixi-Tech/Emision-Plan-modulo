import { useRenovacion } from '../lib/renovacion';

function fechaCorta(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** "Renovación de la póliza X" en la elección de plan. Sin renovación no pinta nada. */
export function RenovacionBanner({ planEncontrado }: { planEncontrado?: boolean | null }) {
  const r = useRenovacion();
  if (!r) return null;
  const desde = fechaCorta(r.fdesde_sugerida);
  const hasta = fechaCorta(r.fhasta_sugerida);
  const planAnterior = r.plan_actual?.xplan || r.xplan_anterior || r.plan_actual?.cplan;
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-emerald-900">
      <p className="font-bold">Renovación de la póliza {r.cnpoliza_rel}</p>
      <p className="mt-1 text-emerald-800">
        {planAnterior ? `Plan anterior: ${planAnterior}. ` : ''}
        {desde && hasta ? `Nueva vigencia: ${desde} al ${hasta}. ` : ''}
        Se cotiza con la tarifa y la tasa de hoy.
      </p>
      {planEncontrado === false && (
        <p className="mt-1 font-semibold text-amber-800">
          El plan anterior ya no está disponible: elige uno de los planes de hoy.
        </p>
      )}
    </div>
  );
}
