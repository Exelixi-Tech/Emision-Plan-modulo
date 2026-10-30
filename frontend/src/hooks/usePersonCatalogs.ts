import { useEffect, useState } from 'react';
import { getActividades, getOcupaciones, getProfesiones, type CatalogItem } from '../lib/api';

/** Profesión, ocupación y actividad económica de las personas (solo donde se piden). */
export interface PersonCatalogs {
  profesiones: CatalogItem[];
  ocupaciones: CatalogItem[];
  actividades: CatalogItem[];
  loading    : boolean;
  error      : string | null;
}

export function usePersonCatalogs(): PersonCatalogs {
  const [cats, setCats] = useState<PersonCatalogs>({
    profesiones: [], ocupaciones: [], actividades: [], loading: true, error: null,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const results = await Promise.allSettled([getProfesiones(), getOcupaciones(), getActividades()]);
      if (cancelled) return;

      const [profesiones, ocupaciones, actividades] = results.map((r) =>
        r.status === 'fulfilled' ? r.value : [],
      );
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => r.reason?.message ?? String(r.reason));

      setCats({
        profesiones,
        ocupaciones,
        actividades,
        loading: false,
        error: errors.length ? errors.join('; ') : null,
      });
    })();

    return () => { cancelled = true; };
  }, []);

  return cats;
}
