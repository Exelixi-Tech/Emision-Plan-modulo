import { useWizardStore } from '../store/wizardStore';
import type { FuneralPerson, PersonData, TomadorData } from '../types';
import { pickProfesionOcupacion } from './profesion-ocupacion';

type PersonSource = TomadorData | PersonData | FuneralPerson;

function metricStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function fieldEq(a: unknown, b: unknown): boolean {
  return String(a ?? '').trim() === String(b ?? '').trim();
}

function extraMetrics(p: unknown): { peso?: string; estatura?: string } {
  if (!p || typeof p !== 'object') return {};
  const o = p as Record<string, unknown>;
  return {
    peso: metricStr(o.peso),
    estatura: metricStr(o.estatura),
  };
}

/**
 * Persona que es el titular: la sección "persona que será asegurada (Titular)" del
 * formulario si está completa (cédula y fecha de nacimiento); si no, el tomador cuando
 * es la misma persona. Así la edad que se cotiza es la del titular que se ve en pantalla.
 */
export function resolveTitularSource<A extends { identificacion?: string; fechaNac?: string }, B extends { identificacion?: string; fechaNac?: string }>(
  sameInsured: boolean | undefined,
  tomador: A,
  asegurado: B,
): A | B {
  const asegOk = String(asegurado?.identificacion ?? '').trim() && String(asegurado?.fechaNac ?? '').trim();
  if (asegOk) return asegurado;
  return sameInsured !== false ? tomador : asegurado;
}

/**
 * Copia al titular (primer asegurado) los datos del formulario:
 * tomador si es la misma persona, o el asegurado si el pagador es otro.
 * Sin esto, emisión cotiza solo los adicionales (prima a la mitad).
 */
export function syncTitularFromTomador(): void {
  const { sameInsured, tomador, asegurado, funeral, setFuneral } = useWizardStore.getState();
  const src: PersonSource = resolveTitularSource(sameInsured, tomador, asegurado);
  const lista = Array.isArray(funeral.asegurados) ? funeral.asegurados : [];
  const titular = lista[0];
  if (!titular || !src) return;

  const fromAseg = extraMetrics(asegurado);
  const fromSrc = extraMetrics(src);
  const fromTitular = extraMetrics(titular);
  const peso = fromAseg.peso || fromSrc.peso || fromTitular.peso;
  const estatura = fromAseg.estatura || fromSrc.estatura || fromTitular.estatura;

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
    ...pickProfesionOcupacion(src, titular),
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
    && fieldEq(titular.cprofesion, next.cprofesion)
    && fieldEq(titular.cocupacion, next.cocupacion)
    && fieldEq(titular.cactividad, next.cactividad)
    && fieldEq(titular.parentesco, '1');

  if (unchanged) return;

  setFuneral({
    asegurados: [next, ...lista.slice(1)],
  });
}
