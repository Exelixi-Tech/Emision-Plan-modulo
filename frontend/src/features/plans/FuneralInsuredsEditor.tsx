import { useState } from 'react';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { Field, Input } from '../../components/ui/FormField';
import { IdentityInput } from '../../components/ui/IdentityInput';
import { SearchSelect } from '../../components/ui/SearchSelect';
import {
  additionalParentescos,
  ageErrorForParentesco,
  isTitularOnlyPlan,
  type PlanParentesco,
} from '../../lib/funeralPlanParentescos';
import { useWizardStore } from '../../store/wizardStore';
import type { FuneralPerson } from '../../types';

function emptyExtra(): FuneralPerson {
  return {
    tipoDoc: 'V',
    identificacion: '',
    nombre: '',
    apellido: '',
    fechaNac: '',
    sexo: '',
    parentesco: '',
  };
}

function isExtraComplete(person: FuneralPerson): boolean {
  return Boolean(
    String(person.identificacion || '').trim()
    && String(person.nombre || '').trim()
    && String(person.apellido || '').trim()
    && String(person.fechaNac || '').trim()
    && String(person.parentesco || '').trim(),
  );
}

function formatFecha(iso?: string): string {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Resumen de asegurados que ya vinieron del formulario.
 * Solo abre el formulario si falta un dato, el plan rechaza parentesco/edad,
 * o el usuario pulsa Editar / Agregar.
 */
export function FuneralInsuredsEditor({
  parentescos,
}: {
  parentescos?: PlanParentesco[] | null;
}) {
  const funeral = useWizardStore((s) => s.funeral);
  const setFuneral = useWizardStore((s) => s.setFuneral);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const titularOnly = isTitularOnlyPlan(parentescos);
  const extras = additionalParentescos(parentescos);
  const canAdd = extras.length > 0 && !titularOnly;
  const parentescoOptions = extras.map((p) => ({
    value: String(p.cparen),
    label: p.xparentesco,
  }));

  const update = (idx: number, patch: Partial<FuneralPerson>) => {
    setFuneral({
      asegurados: funeral.asegurados.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    });
  };

  const add = () => {
    const nextIdx = funeral.asegurados.length;
    setFuneral({ asegurados: [...funeral.asegurados, emptyExtra()] });
    setEditingIdx(nextIdx);
  };

  const remove = (idx: number) => {
    if (idx === 0) return;
    setFuneral({ asegurados: funeral.asegurados.filter((_, i) => i !== idx) });
    setEditingIdx((cur) => {
      if (cur == null) return null;
      if (cur === idx) return null;
      return cur > idx ? cur - 1 : cur;
    });
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest inline-flex items-center gap-1.5">
            <Users size={11} className="text-indigo-500" />
            Asegurados del formulario
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Ya se cargaron en Personas. Aquí solo se validan contra el plan.
            {!parentescos?.length
              ? ' Elige un plan para revisar parentescos.'
              : titularOnly
                ? ' Este plan no admite adicionales.'
                : ''}
          </p>
        </div>
      </div>

      <ul className="space-y-3">
        {funeral.asegurados.map((aseg, idx) => {
          const ageErr = idx === 0
            ? undefined
            : ageErrorForParentesco(aseg.fechaNac, aseg.parentesco, parentescos);
          const showForm = idx > 0 && (
            editingIdx === idx
            || !isExtraComplete(aseg)
            || Boolean(ageErr)
          );
          const parentescoLabel = parentescoOptions.find(
            (o) => o.value === String(aseg.parentesco),
          )?.label || (idx === 0 ? 'Titular' : aseg.parentesco || '—');

          return (
            <li key={idx} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[0.7rem] font-black uppercase tracking-wider text-indigo-600">
                  {idx === 0 ? 'Titular' : `Asegurado ${idx + 1}`}
                </span>
                <div className="flex items-center gap-1">
                  {idx > 0 && !showForm && (
                    <button
                      type="button"
                      onClick={() => setEditingIdx(idx)}
                      className="inline-flex items-center gap-1 text-[0.7rem] font-bold text-indigo-600 hover:text-indigo-700 min-h-[40px] px-2"
                    >
                      <Pencil size={12} /> Editar
                    </button>
                  )}
                  {idx > 0 && showForm && isExtraComplete(aseg) && !ageErr && (
                    <button
                      type="button"
                      onClick={() => setEditingIdx(null)}
                      className="inline-flex items-center gap-1 text-[0.7rem] font-bold text-slate-500 hover:text-slate-700 min-h-[40px] px-2"
                    >
                      Cerrar
                    </button>
                  )}
                  {idx > 0 && (
                    <button
                      type="button"
                      onClick={() => remove(idx)}
                      className="inline-flex items-center gap-1 text-[0.7rem] font-bold text-rose-500 hover:text-rose-600 min-h-[40px] px-2"
                    >
                      <Trash2 size={12} /> Quitar
                    </button>
                  )}
                </div>
              </div>

              {idx === 0 || !showForm ? (
                <div>
                  <p className="text-sm text-slate-600">
                    <span className="font-semibold text-slate-800">
                      {aseg.nombre} {aseg.apellido}
                    </span>
                    {aseg.identificacion ? ` · ${aseg.tipoDoc || 'V'}-${aseg.identificacion}` : ''}
                  </p>
                  <p className="text-[0.78rem] text-slate-500 mt-1">
                    {parentescoLabel}
                    {aseg.fechaNac ? ` · Nac. ${formatFecha(aseg.fechaNac)}` : ''}
                  </p>
                  {ageErr && (
                    <p className="mt-2 text-xs font-semibold text-rose-700">{ageErr}</p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Identificación *">
                    <IdentityInput
                      tipoDoc={aseg.tipoDoc || 'V'}
                      identificacion={aseg.identificacion}
                      onTipoDocChange={(v) => update(idx, { tipoDoc: v })}
                      onIdentificacionChange={(v) => update(idx, { identificacion: v })}
                    />
                  </Field>
                  <Field label="Parentesco *" error={ageErr && !/edad|años/i.test(ageErr) ? ageErr : undefined}>
                    <SearchSelect
                      value={aseg.parentesco}
                      options={parentescoOptions}
                      onChange={(value) => update(idx, { parentesco: String(value) })}
                      placeholder="— Seleccionar —"
                      disabled={!parentescoOptions.length}
                    />
                  </Field>
                  <Field label="Nombre *">
                    <Input
                      value={aseg.nombre}
                      onChange={(e) => update(idx, { nombre: e.target.value })}
                      placeholder="Nombre"
                    />
                  </Field>
                  <Field label="Apellido *">
                    <Input
                      value={aseg.apellido}
                      onChange={(e) => update(idx, { apellido: e.target.value })}
                      placeholder="Apellido"
                    />
                  </Field>
                  <Field label="Fecha de nacimiento *" error={ageErr && /edad|años|mínima|máxima/i.test(ageErr) ? ageErr : undefined}>
                    <Input
                      type="date"
                      value={aseg.fechaNac}
                      max={new Date().toISOString().split('T')[0]}
                      onChange={(e) => update(idx, { fechaNac: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canAdd && (
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl border-2 border-dashed border-indigo-200 text-indigo-600 text-sm font-bold hover:border-indigo-400 hover:bg-indigo-50/50"
        >
          <Plus size={15} /> Agregar asegurado
        </button>
      )}
    </div>
  );
}
