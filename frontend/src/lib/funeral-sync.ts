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

function extraMetrics(p: unknown): { peso?: string; estatura?: string } {
  if (!p || typeof p !== 'object') return {};
  const o = p as Record<string, unknown>;
  return {
    peso: metricStr(o.peso),
    estatura: metricStr(o.estatura),
  };
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
