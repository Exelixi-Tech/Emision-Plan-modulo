import { Field } from './ui/FormField';
import { SearchSelect } from './ui/SearchSelect';
import type { CatalogItem } from '../lib/api';

interface PersonLike {
  cestado?: number;
  estado?: string;
  cciudad?: number;
  ciudad?: string;
}

interface CiudadesState {
  ciudades: CatalogItem[];
  loading: boolean;
}

interface PersonLocationFieldsProps {
  person: PersonLike;
  setPerson: (patch: Partial<PersonLike>) => void;
  errors: Record<string, string | undefined>;
  estados: CatalogItem[];
  ciuState: CiudadesState;
  catalogsLoading: boolean;
}

export function PersonLocationFields({
  person,
  setPerson,
  errors,
  estados,
  ciuState,
  catalogsLoading,
}: PersonLocationFieldsProps) {
  return (
    <>
      <Field label="Estado *" error={errors.estado}>
        <SearchSelect
          value={person.cestado}
          options={estados.map((s) => ({ value: String(s.code), label: s.label }))}
          onChange={(code, label) => {
            setPerson({
              estado: label,
              cestado: code ? Number(code) : undefined,
              ciudad: '',
              cciudad: undefined,
            });
          }}
          placeholder="Seleccione Estado"
          loading={catalogsLoading}
        />
      </Field>
      <Field
        label="Ciudad *"
        error={errors.ciudad}
        hint={person.cestado ? undefined : 'Selecciona primero el estado'}
      >
        <SearchSelect
          value={person.cciudad}
          options={ciuState.ciudades.map((c) => ({ value: String(c.code), label: c.label }))}
          onChange={(code, label) => {
            setPerson({
              ciudad: label,
              cciudad: code ? Number(code) : undefined,
            });
          }}
          placeholder={person.cestado ? 'Seleccione Ciudad' : 'Selecciona primero el estado'}
          disabled={!person.cestado}
          loading={ciuState.loading}
        />
      </Field>
    </>
  );
}
