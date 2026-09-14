import { useWizardStore } from '../store/wizardStore';
import type { FuneralPerson, PersonData, TomadorData } from '../types';

type PersonSource = TomadorData | PersonData | FuneralPerson;

function metricStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function fieldEq(a: unknown, b: unknown): boolean {
  return String(a ?? '').trim() === String(b ?? '').trim();
}

/**
 * Copia al titular (primer asegurado) los datos del formulario:
 * tomador si es la misma persona, o el asegurado si el pagador es otro.
 * Sin esto, emisión cotiza solo los adicionales (prima a la mitad).
 */
export function syncTitularFromTomador(): void {
  const { sameInsured, tomador, asegurado, funeral, setFuneral } = useWizardStore.getState();
  const src: PersonSource = sameInsured !== false ? tomador : asegurado;
  const lista = Array.isArray(funeral.asegurados) ? funeral.asegurados : [];
  const titular = lista[0];
  if (!titular || !src) return;

  const peso = metricStr(asegurado.peso) || metricStr(src.peso) || metricStr(titular.peso);
  const estatura =
    metricStr(asegurado.estatura) || metricStr(src.estatura) || metricStr(titular.estatura);

  const next: FuneralPerson = {
    ...titular,
    tipoDoc: src.tipoDoc || titular.tipoDoc || 'V',
    identificacion: String(src.identificacion || titular.identificacion || '').trim(),
    nombre: src.nombre || titular.nombre,
    apellido: src.apellido || titular.apellido,
    fechaNac: src.fechaNac || titular.fechaNac || '',
    sexo: src.sexo || titular.sexo || '',
    parentesco: '1',
    telefono: src.telefono || titular.telefono,
    email: src.email || titular.email,
    estadoCivil: src.estadoCivil || titular.estadoCivil,
    estado: src.estado || titular.estado,
    cestado: src.cestado ?? titular.cestado,
    ciudad: src.ciudad || titular.ciudad,
    cciudad: src.cciudad ?? titular.cciudad,
    direccion: src.direccion || titular.direccion,
    peso,
    estatura,
  };

  const unchanged =
    fieldEq(titular.identificacion, next.identificacion)
    && fieldEq(titular.nombre, next.nombre)
    && fieldEq(titular.apellido, next.apellido)
    && fieldEq(titular.fechaNac, next.fechaNac)
    && fieldEq(titular.sexo, next.sexo)
    && fieldEq(titular.telefono, next.telefono)
    && fieldEq(titular.email, next.email)
    && fieldEq(titular.estadoCivil, next.estadoCivil)
    && fieldEq(titular.direccion, next.direccion)
    && fieldEq(titular.peso, next.peso)
    && fieldEq(titular.estatura, next.estatura)
    && fieldEq(titular.parentesco, '1');

  if (unchanged) return;

  setFuneral({
    asegurados: [next, ...lista.slice(1)],
  });
}
