import { useState } from 'react';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { Field, Input, Textarea } from '../../components/ui/FormField';
import { IdentityInput } from '../../components/ui/IdentityInput';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { PersonLocationFields } from '../../components/PersonLocationFields';
import { useCatalogs, useCiudades } from '../../hooks/useCatalogs';
import { formatTelefono } from '../../lib/phone';
import {
  additionalParentescos,
  ageErrorForParentesco,
  isTitularOnlyPlan,
  maxAseguradosDelPlan,
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
    telefono: '',
    email: '',
    estadoCivil: '',
    estado: '',
    ciudad: '',
    direccion: '',
    peso: '',
    estatura: '',
  };
}

function hasText(v: unknown): boolean {
  return String(v ?? '').trim().length > 0;
}

function parseMetric(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function isFuneralInsuredComplete(person: FuneralPerson, isTitular: boolean): boolean {
  const est = parseMetric(person.estatura);
  const peso = parseMetric(person.peso);
  const phoneDigits = String(person.telefono || '').replace(/\D/g, '');
  return Boolean(
    hasText(person.identificacion)
    && hasText(person.nombre)
    && hasText(person.apellido)
    && hasText(person.fechaNac)
    && hasText(person.sexo)
    && phoneDigits.length === 11
    && hasText(person.email)
    && (person.cestado != null || hasText(person.estado))
    && (person.cciudad != null || hasText(person.ciudad))
    && hasText(person.direccion)
    && hasText(person.estadoCivil)
    && est != null && est >= 0.5 && est <= 2.5
    && peso != null && peso >= 2 && peso <= 400
    && (isTitular || hasText(person.parentesco)),
  );
}

function formatFecha(iso?: string): string {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function FuneralExtraPersonForm({
  person,
  onChange,
  parentescoOptions,
  lockParentesco,
  ageErr,
}: {
  person: FuneralPerson;
  onChange: (patch: Partial<FuneralPerson>) => void;
  parentescoOptions: { value: string; label: string }[];
  lockParentesco: boolean;
  ageErr?: string;
}) {
  const catalogs = useCatalogs();
  const ciuState = useCiudades(person.cestado);
  const errors: Record<string, string | undefined> = {};
  if (ageErr && /edad|años|mínima|máxima/i.test(ageErr)) errors.fechaNac = ageErr;
  if (ageErr && !errors.fechaNac) errors.parentesco = ageErr;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Tipo Doc. Identidad *">
        <IdentityInput
          tipoDoc={person.tipoDoc || 'V'}
          identificacion={person.identificacion}
          onTipoDocChange={(v) => onChange({ tipoDoc: v })}
          onIdentificacionChange={(v) => onChange({ identificacion: v })}
        />
      </Field>
      <Field label="Parentesco *" error={errors.parentesco}>
        {lockParentesco ? (
          <Input value="Titular" disabled readOnly />
        ) : (
          <SearchSelect
            value={person.parentesco}
            options={parentescoOptions}
            onChange={(value) => onChange({ parentesco: String(value) })}
            placeholder="— Seleccionar —"
            disabled={!parentescoOptions.length}
          />
        )}
      </Field>
      <Field label="Nombre *">
        <Input
          value={person.nombre}
          onChange={(e) => onChange({ nombre: e.target.value })}
          placeholder="Nombre"
        />
      </Field>
      <Field label="Apellido *">
        <Input
          value={person.apellido}
          onChange={(e) => onChange({ apellido: e.target.value })}
          placeholder="Apellido"
        />
      </Field>
      <Field label="Teléfono *">
        <Input
          value={formatTelefono(person.telefono ?? '')}
          onChange={(e) => onChange({ telefono: formatTelefono(e.target.value) })}
          placeholder="(0412) 123-4567"
          type="tel"
          inputMode="numeric"
        />
      </Field>
      <Field label="Correo electrónico *">
        <Input
          value={person.email ?? ''}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder="correo@ejemplo.com"
          type="email"
        />
      </Field>
      <PersonLocationFields
        person={person}
        setPerson={onChange}
        errors={{ estado: undefined, ciudad: undefined }}
        estados={catalogs.estados}
        ciuState={ciuState}
        catalogsLoading={catalogs.loading}
      />
      <Field label="Fecha de Nac. *" error={errors.fechaNac}>
        <Input
          type="date"
          value={person.fechaNac}
          max={new Date().toISOString().split('T')[0]}
          onChange={(e) => onChange({ fechaNac: e.target.value })}
        />
      </Field>
      <Field label="Sexo *">
        <SearchSelect
          value={person.sexo}
          options={
            catalogs.sexos.length
              ? catalogs.sexos.map((s) => ({ value: String(s.label), label: s.label }))
              : [
                  { value: 'Masculino', label: 'Masculino' },
                  { value: 'Femenino', label: 'Femenino' },
                ]
          }
          onChange={(value) => onChange({ sexo: String(value) })}
          placeholder="— Seleccionar —"
          loading={catalogs.loading}
        />
      </Field>
      <Field label="Estatura *" hint="Altura (mts.)">
        <Input
          value={person.estatura ?? ''}
          onChange={(e) => onChange({ estatura: e.target.value.replace(/[^0-9.,]/g, '') })}
          placeholder="1.70"
          inputMode="decimal"
        />
      </Field>
      <Field label="Peso *" hint="Peso (kg.)">
        <Input
          value={person.peso ?? ''}
          onChange={(e) => onChange({ peso: e.target.value.replace(/[^0-9.,]/g, '') })}
          placeholder="70"
          inputMode="decimal"
        />
      </Field>
      <Field label="Estado Civil *">
        <SearchSelect
          value={person.estadoCivil}
          options={
            catalogs.estadosCivil.length
              ? catalogs.estadosCivil.map((s) => ({ value: String(s.label), label: s.label }))
              : [
                  { value: 'Soltero(a)', label: 'Soltero(a)' },
                  { value: 'Casado(a)', label: 'Casado(a)' },
                  { value: 'Divorciado(a)', label: 'Divorciado(a)' },
                  { value: 'Viudo(a)', label: 'Viudo(a)' },
                ]
          }
          onChange={(value) => onChange({ estadoCivil: String(value) })}
          placeholder="— Seleccionar —"
          loading={catalogs.loading}
        />
      </Field>
      <Field label="Dirección *" full>
        <Textarea
          value={person.direccion ?? ''}
          onChange={(e) => onChange({ direccion: e.target.value })}
          placeholder="Dirección completa"
          rows={3}
        />
      </Field>
    </div>
  );
}

/**
 * Titular (resumen) + alta/edición de asegurados adicionales en el plan.
 * Los campos coinciden con el formulario nativo SysIP / OPENJSON del pre-SP.
 */
export function FuneralInsuredsEditor({
  parentescos,
  nmax_dep,
  maxAsegurados,
}: {
  parentescos?: PlanParentesco[] | null;
  nmax_dep?: number | null;
  maxAsegurados?: number | null;
}) {
  const funeral = useWizardStore((s) => s.funeral);
  const setFuneral = useWizardStore((s) => s.setFuneral);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const max = maxAseguradosDelPlan({ maxAsegurados, nmax_dep, parentescos });
  const titularOnly = max === 1 || isTitularOnlyPlan(parentescos);
  const extras = additionalParentescos(parentescos);
  const atLimit = max != null && funeral.asegurados.length >= max;
  const canAdd = extras.length > 0 && !titularOnly && !atLimit;
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
    if (atLimit) return;
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
            Asegurados
          </p>
          <p className="text-xs text-slate-500 mt-1">
            El titular viene del formulario. Agrega aquí los asegurados adicionales con los mismos datos.
            {max != null
              ? ` Este plan admite hasta ${max} asegurado${max === 1 ? '' : 's'} (titular${max > 1 ? ` + ${max - 1} adicional${max - 1 === 1 ? '' : 'es'}` : ''}).`
              : !parentescos?.length
                ? ' Elige un plan para revisar parentescos.'
                : titularOnly
                  ? ' Este plan no admite adicionales.'
                  : ''}
          </p>
        </div>
      </div>

      <ul className="space-y-3">
        {funeral.asegurados.map((aseg, idx) => {
          const isTitular = idx === 0;
          const ageErr = isTitular
            ? undefined
            : ageErrorForParentesco(aseg.fechaNac, aseg.parentesco, parentescos);
          const complete = isFuneralInsuredComplete(aseg, isTitular);
          const showForm = !isTitular && (
            editingIdx === idx
            || !complete
            || Boolean(ageErr)
          );
          const parentescoLabel = parentescoOptions.find(
            (o) => o.value === String(aseg.parentesco),
          )?.label || (isTitular ? 'Titular' : aseg.parentesco || '—');

          return (
            <li key={idx} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[0.7rem] font-black uppercase tracking-wider text-indigo-600">
                  {isTitular ? 'Titular' : `Asegurado ${idx + 1}`}
                </span>
                <div className="flex items-center gap-1">
                  {!isTitular && !showForm && (
                    <button
                      type="button"
                      onClick={() => setEditingIdx(idx)}
                      className="inline-flex items-center gap-1 text-[0.7rem] font-bold text-indigo-600 hover:text-indigo-700 min-h-[40px] px-2"
                    >
                      <Pencil size={12} /> Editar
                    </button>
                  )}
                  {!isTitular && showForm && complete && !ageErr && (
                    <button
                      type="button"
                      onClick={() => setEditingIdx(null)}
                      className="inline-flex items-center gap-1 text-[0.7rem] font-bold text-slate-500 hover:text-slate-700 min-h-[40px] px-2"
                    >
                      Cerrar
                    </button>
                  )}
                  {!isTitular && (
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

              {isTitular || !showForm ? (
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
                    {aseg.estatura ? ` · ${aseg.estatura} m` : ''}
                    {aseg.peso ? ` · ${aseg.peso} kg` : ''}
                  </p>
                  {ageErr && (
                    <p className="mt-2 text-xs font-semibold text-rose-700">{ageErr}</p>
                  )}
                </div>
              ) : (
                <FuneralExtraPersonForm
                  person={aseg}
                  onChange={(patch) => update(idx, patch)}
                  parentescoOptions={parentescoOptions}
                  lockParentesco={false}
                  ageErr={ageErr}
                />
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
          {max != null ? ` (${funeral.asegurados.length}/${max})` : ''}
        </button>
      )}
      {!canAdd && max != null && extras.length > 0 && !titularOnly && atLimit && (
        <p className="text-xs font-semibold text-slate-500">
          Ya alcanzaste el máximo de {max} asegurados de este plan.
        </p>
      )}
    </div>
  );
}
