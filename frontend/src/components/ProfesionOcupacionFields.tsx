import { Field } from './ui/FormField';
import { SearchSelect } from './ui/SearchSelect';
import type { PersonCatalogs } from '../hooks/usePersonCatalogs';
import type { ProfesionOcupacionFields as Values } from '../types';

/**
 * Profesión (obligatoria), ocupación y actividad económica de una persona.
 * Regla: profesión y además ocupación o actividad (ver hasProfesionOcupacion).
 */
export function ProfesionOcupacionFields({
  person,
  onChange,
  catalogs,
}: {
  person: Values;
  onChange: (patch: Partial<Values>) => void;
  catalogs: PersonCatalogs;
}) {
  const toOptions = (items: PersonCatalogs['profesiones']) =>
    items.map((o) => ({ value: String(o.code), label: o.label }));

  return (
    <>
      <Field label="Profesión *">
        <SearchSelect
          value={person.cprofesion != null ? String(person.cprofesion) : ''}
          options={toOptions(catalogs.profesiones)}
          onChange={(code, label) => onChange({ cprofesion: code, xprofesion: label })}
          placeholder="— Seleccionar —"
          loading={catalogs.loading}
          noOptionsText="Sin profesiones disponibles"
        />
      </Field>
      <Field label="Ocupación *" hint="Basta con ocupación o actividad económica.">
        <SearchSelect
          value={person.cocupacion != null ? String(person.cocupacion) : ''}
          options={toOptions(catalogs.ocupaciones)}
          onChange={(code, label) => onChange({ cocupacion: code, xocupacion: label })}
          placeholder="— Seleccionar —"
          loading={catalogs.loading}
          noOptionsText="Sin ocupaciones disponibles"
        />
      </Field>
      <Field label="Actividad económica *" full>
        <SearchSelect
          value={person.cactividad != null ? String(person.cactividad) : ''}
          options={toOptions(catalogs.actividades)}
          onChange={(code, label) => onChange({ cactividad: code, xactividad: label })}
          placeholder="— Seleccionar (si no indicó ocupación) —"
          loading={catalogs.loading}
          noOptionsText="Sin actividades disponibles"
        />
      </Field>
      {catalogs.error && (
        <p className="sm:col-span-2 text-xs font-semibold text-rose-700">
          No se pudieron cargar los catálogos de profesión u ocupación. Recarga la página.
        </p>
      )}
    </>
  );
}
