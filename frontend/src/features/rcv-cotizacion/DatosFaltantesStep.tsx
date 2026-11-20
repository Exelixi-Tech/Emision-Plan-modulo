import { Car, Lock, MapPin, ShieldCheck, User, UserCheck } from 'lucide-react';
import type { VistaCotizacion } from '../../lib/rcv-cotizacion-api';
import {
  esPersonaJuridica,
  normalizePlacaInput,
  type DatosFaltantes,
  type PersonaExtra,
} from '../../lib/rcv-cotizacion-calc';
import { normalizeVehicleSerial, VEHICLE_SERIAL_MAX_LEN } from '../../lib/vehicle-serial';
import { formatTelefono } from '../../lib/phone';
import { useCatalogs, useCiudades } from '../../hooks/useCatalogs';
import type { CatalogItem } from '../../lib/api';
import { Field, Input, Select } from '../../components/ui/FormField';
import { ToggleSwitch } from '../../components/ui/ToggleSwitch';
import { PersonLocationFields } from '../../components/PersonLocationFields';
import { ProfesionOcupacionFields } from '../../components/ProfesionOcupacionFields';
import { usePersonCatalogs } from '../../hooks/usePersonCatalogs';
import { SectionTitle, fmtFecha } from './parts';

interface Props {
  vista: VistaCotizacion;
  form: DatosFaltantes;
  onChange: (patch: Partial<DatosFaltantes>) => void;
  errors: Record<string, string>;
}

function SexoSelect({ value, onChange, sexos }: { value: string; onChange: (v: string) => void; sexos: CatalogItem[] }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Seleccione</option>
      {sexos.map((s) => <option key={String(s.code)} value={String(s.code)}>{s.label}</option>)}
    </Select>
  );
}

function PersonaFields({ prefix, persona, onChange, errors, sexos }: {
  prefix: string;
  persona: PersonaExtra;
  onChange: (p: PersonaExtra) => void;
  errors: Record<string, string>;
  sexos: CatalogItem[];
}) {
  const set = (patch: Partial<PersonaExtra>) => onChange({ ...persona, ...patch });
  return (
    <div className="grid gap-4 sm:grid-cols-2 mt-4">
      <Field label="Cédula *" error={errors[`${prefix}.identificacion`]}>
        <div className="flex gap-2">
          <Select className="w-24 shrink-0" value={persona.tipoDoc} onChange={(e) => set({ tipoDoc: e.target.value })}>
            <option value="V">V</option>
            <option value="E">E</option>
          </Select>
          <Input
            inputMode="numeric"
            value={persona.identificacion}
            onChange={(e) => set({ identificacion: e.target.value.replace(/\D/g, '').slice(0, 10) })}
            placeholder="Ej. 18456329"
          />
        </div>
      </Field>
      <Field label="Fecha de nacimiento *" error={errors[`${prefix}.fechaNac`]}>
        <Input type="date" value={persona.fechaNac} onChange={(e) => set({ fechaNac: e.target.value })} />
      </Field>
      <Field label="Nombres *" error={errors[`${prefix}.nombre`]}>
        <Input value={persona.nombre} onChange={(e) => set({ nombre: e.target.value })} />
      </Field>
      <Field label="Apellidos *" error={errors[`${prefix}.apellido`]}>
        <Input value={persona.apellido} onChange={(e) => set({ apellido: e.target.value })} />
      </Field>
      <Field label="Sexo *" error={errors[`${prefix}.sexo`]}>
        <SexoSelect value={persona.sexo} onChange={(sexo) => set({ sexo })} sexos={sexos} />
      </Field>
    </div>
  );
}

/** Pantalla 2 — Datos que la cotización no trae. Plan, vehículo, tomador y vigencia quedan bloqueados. */
export function DatosFaltantesStep({ vista, form, onChange, errors }: Props) {
  const c = vista.cotizacion;
  const cats = useCatalogs();
  const ciudades = useCiudades(form.cestado ?? null);
  const juridico = esPersonaJuridica(c.tomador?.tipoDoc);
  const personCatalogs = usePersonCatalogs();

  return (
    <div className="animate-fade-in space-y-7">
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-white to-violet-50/50 p-4 sm:p-5">
        <SectionTitle icon={<Lock size={11} className="text-indigo-500" />}>Datos fijos de la cotización</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <p><span className="text-slate-500">Plan:</span> <b className="text-slate-900">{c.plan?.nombre}</b></p>
          <p><span className="text-slate-500">Vehículo:</span> <b className="text-slate-900">{`${c.vehiculo.marca?.nombre ?? ''} ${c.vehiculo.modelo?.nombre ?? ''} ${c.vehiculo.anio ?? ''}`.trim()}</b></p>
          <p><span className="text-slate-500">Tomador:</span> <b className="text-slate-900">{`${c.tomador?.tipoDoc}-${c.tomador?.documento} · ${c.tomador?.nombre}`}</b></p>
          <p><span className="text-slate-500">Vigencia:</span> <b className="text-slate-900">{fmtFecha(vista.vigenciaEmision.fdesde)} al {fmtFecha(vista.vigenciaEmision.fhasta)}</b></p>
        </div>
      </div>

      <section>
        <SectionTitle icon={<Car size={11} className="text-indigo-500" />}>Vehículo</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Placa *" error={errors.placa}>
            <Input
              value={form.placa}
              onChange={(e) => onChange({ placa: normalizePlacaInput(e.target.value) })}
              placeholder="AE123KT"
              maxLength={8}
              className="uppercase font-bold tracking-wider"
            />
          </Field>
          <Field label="Color *" error={errors.color}>
            <Input value={form.color} onChange={(e) => onChange({ color: e.target.value.slice(0, 30) })} placeholder="Ej. Blanco" />
          </Field>
          <Field label="Serial de carrocería *" error={errors.serial}>
            <Input
              value={form.serial}
              onChange={(e) => onChange({ serial: normalizeVehicleSerial(e.target.value) })}
              maxLength={VEHICLE_SERIAL_MAX_LEN}
              className="uppercase"
            />
          </Field>
          <Field label="Serial de motor" error={errors.serialMotor} hint="Opcional si no aparece en el certificado">
            <Input
              value={form.serialMotor}
              onChange={(e) => onChange({ serialMotor: normalizeVehicleSerial(e.target.value) })}
              maxLength={VEHICLE_SERIAL_MAX_LEN}
              className="uppercase"
            />
          </Field>
        </div>
      </section>

      {!juridico && (
        <section>
          <SectionTitle icon={<User size={11} className="text-indigo-500" />}>Tomador</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha de nacimiento *" error={errors.fechaNac}>
              <Input type="date" value={form.fechaNac} onChange={(e) => onChange({ fechaNac: e.target.value })} />
            </Field>
            <Field label="Sexo *" error={errors.sexo}>
              <SexoSelect value={form.sexo} onChange={(sexo) => onChange({ sexo })} sexos={cats.sexos} />
            </Field>
            <Field label="Estado civil">
              <Select value={form.estadoCivil} onChange={(e) => onChange({ estadoCivil: e.target.value })}>
                <option value="">Seleccione</option>
                {cats.estadosCivil.map((s) => <option key={String(s.code)} value={String(s.code)}>{s.label}</option>)}
              </Select>
            </Field>
            {/* Debida diligencia simplificada: el SP rechaza la emisión sin profesión u actividad (99013). */}
            <ProfesionOcupacionFields person={form} onChange={onChange} catalogs={personCatalogs} />
            {errors.profesion && (
              <p className="sm:col-span-2 text-[0.72rem] text-rose-500 font-semibold">{errors.profesion}</p>
            )}
          </div>
        </section>
      )}

      <section>
        <SectionTitle icon={<MapPin size={11} className="text-indigo-500" />}>Dirección y contacto</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <PersonLocationFields
            person={{ cestado: form.cestado, estado: form.estado, cciudad: form.cciudad, ciudad: form.ciudad }}
            setPerson={(patch) => onChange(patch as Partial<DatosFaltantes>)}
            errors={errors}
            estados={cats.estados}
            ciuState={ciudades}
            catalogsLoading={cats.loading}
          />
          <Field label="Dirección *" error={errors.direccion} full>
            <Input value={form.direccion} onChange={(e) => onChange({ direccion: e.target.value.slice(0, 250) })} placeholder="Urbanización, calle, casa o edificio" />
          </Field>
          <Field label="Correo electrónico *" error={errors.email}>
            <Input type="email" value={form.email} onChange={(e) => onChange({ email: e.target.value.trim() })} placeholder="nombre@correo.com" />
          </Field>
          <Field label="Teléfono *" error={errors.telefono}>
            <Input inputMode="tel" value={form.telefono} onChange={(e) => onChange({ telefono: formatTelefono(e.target.value) })} placeholder="(0414) 123-4567" />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle icon={<UserCheck size={11} className="text-indigo-500" />}>Asegurado y conductor</SectionTitle>
        <ToggleSwitch
          checked={form.sameInsured}
          onChange={(v) => onChange({ sameInsured: v })}
          label="El asegurado es el mismo tomador"
          description="Desactiva si el titular del vehículo es otra persona."
        />
        {!form.sameInsured && (
          <PersonaFields prefix="asegurado" persona={form.asegurado} onChange={(asegurado) => onChange({ asegurado })} errors={errors} sexos={cats.sexos} />
        )}
        <ToggleSwitch
          checked={form.hasDriver}
          onChange={(v) => onChange({ hasDriver: v })}
          label="Agregar conductor habitual"
          description="Si otra persona maneja el vehículo de forma habitual."
        />
        {form.hasDriver && (
          <PersonaFields prefix="conductor" persona={form.conductor} onChange={(conductor) => onChange({ conductor })} errors={errors} sexos={cats.sexos} />
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle icon={<ShieldCheck size={11} className="text-emerald-500" />}>Declaraciones</SectionTitle>
        <label className="flex items-start gap-3 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 w-4 h-4 accent-indigo-600"
            checked={form.personaPoliticamenteExpuesta}
            onChange={(e) => onChange({ personaPoliticamenteExpuesta: e.target.checked })}
          />
          Soy persona políticamente expuesta (PEP).
        </label>
        <label className="flex items-start gap-3 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 w-4 h-4 accent-indigo-600"
            checked={form.aceptaTerminos}
            onChange={(e) => onChange({ aceptaTerminos: e.target.checked })}
          />
          Acepto los términos y condiciones y declaro que los datos suministrados son verdaderos.
        </label>
        {errors.aceptaTerminos && <p className="text-[0.72rem] text-rose-500 font-semibold">{errors.aceptaTerminos}</p>}
      </section>
    </div>
  );
}
