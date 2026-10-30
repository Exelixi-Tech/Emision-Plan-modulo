import type { ProfesionOcupacionFields } from '../types';

/**
 * Regla de personas (igual que RCV): profesión obligatoria y además ocupación o actividad
 * económica. Se exige el código: un nombre sin código no llega a la emisión.
 */
export function hasProfesionOcupacion(p: ProfesionOcupacionFields): boolean {
  const has = (v: unknown) => String(v ?? '').trim() !== '';
  return has(p.cprofesion) && (has(p.cocupacion) || has(p.cactividad));
}

/** Profesión, ocupación y actividad de `src`; lo que `src` no traiga se conserva de `dst`. */
export function pickProfesionOcupacion(
  src: ProfesionOcupacionFields,
  dst: ProfesionOcupacionFields = {},
): ProfesionOcupacionFields {
  return {
    cprofesion: src.cprofesion ?? dst.cprofesion,
    xprofesion: src.xprofesion ?? dst.xprofesion,
    cocupacion: src.cocupacion ?? dst.cocupacion,
    xocupacion: src.xocupacion ?? dst.xocupacion,
    cactividad: src.cactividad ?? dst.cactividad,
    xactividad: src.xactividad ?? dst.xactividad,
  };
}
