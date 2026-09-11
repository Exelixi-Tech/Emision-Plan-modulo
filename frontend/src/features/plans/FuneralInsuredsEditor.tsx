import { Users } from 'lucide-react';
import {
  ageErrorForParentesco,
  isTitularOnlyPlan,
  type PlanParentesco,
} from '../../lib/funeralPlanParentescos';
import { useWizardStore } from '../../store/wizardStore';
import type { FuneralPerson } from '../../types';

function formatFecha(iso?: string): string {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function parentescoLabelOf(
  person: FuneralPerson,
  idx: number,
  parentescos?: PlanParentesco[] | null,
): string {
  if (idx === 0) return 'Titular';
  const hit = (parentescos || []).find((p) => String(p.cparen) === String(person.parentesco));
  return hit?.xparentesco || person.parentesco || '—';
}

/**
 * Solo lectura: el alta de asegurados es el paso Personas del formulario.
 * Aquí se muestra el grupo y se avisa si el plan no admite a alguien.
 */
export function FuneralInsuredsEditor({
  parentescos,
}: {
  parentescos?: PlanParentesco[] | null;
}) {
  const funeral = useWizardStore((s) => s.funeral);
  const titularOnly = isTitularOnlyPlan(parentescos);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
      <div>
        <p className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest inline-flex items-center gap-1.5">
          <Users size={11} className="text-indigo-500" />
          Asegurados del formulario
        </p>
        <p className="text-xs text-slate-500 mt-1">
          El alta se hace en Personas. Aquí solo se valida el grupo contra el plan.
          {titularOnly ? ' Este plan cubre solo al titular.' : ''}
        </p>
      </div>

      <ul className="space-y-3">
        {funeral.asegurados.map((aseg, idx) => {
          const ageErr = idx === 0
            ? undefined
            : ageErrorForParentesco(aseg.fechaNac, aseg.parentesco, parentescos);
          const planRejectsExtra = titularOnly && idx > 0;

          return (
            <li key={idx} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
              <span className="text-[0.7rem] font-black uppercase tracking-wider text-indigo-600">
                {idx === 0 ? 'Titular' : `Asegurado ${idx + 1}`}
              </span>
              <p className="text-sm text-slate-600 mt-2">
                <span className="font-semibold text-slate-800">
                  {aseg.nombre} {aseg.apellido}
                </span>
                {aseg.identificacion ? ` · ${aseg.tipoDoc || 'V'}-${aseg.identificacion}` : ''}
              </p>
              <p className="text-[0.78rem] text-slate-500 mt-1">
                {parentescoLabelOf(aseg, idx, parentescos)}
                {aseg.fechaNac ? ` · Nac. ${formatFecha(aseg.fechaNac)}` : ''}
              </p>
              {(ageErr || planRejectsExtra) && (
                <p className="mt-2 text-xs font-semibold text-rose-700">
                  {planRejectsExtra
                    ? 'Este plan no cubre adicionales. Vuelve al formulario o elige otro plan.'
                    : ageErr}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
