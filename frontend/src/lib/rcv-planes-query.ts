/**
 * Catálogo de planes RCV: el ramo es 18 (Sis2000). La metadata de sesión (snapshot del marketplace, token de
 * Nexus o metadataCanal) puede traer `cramo`/`cproducto` de otro producto (p. ej. 28/89 tras probar otro
 * flujo); si se reenvían, la consulta de planes RCV vuelve vacía ("No se encuentra planes asociados").
 */
export const RCV_CRAMO = 18;
/** Producto RCV en Sis2000 (mismo valor que RCV_AUTO_CPRODUCTO de nest-api). */
export const RCV_CPRODUCTO_SIS2000 = '24';

/**
 * Ajusta la consulta de planes RCV:
 * - Placa nacional/extranjera (o sin dato): siempre `cramo=18`. Si la sesión traía otro ramo, su
 *   `cproducto` también es de ese otro producto y se reemplaza por el de RCV; si ya era ramo 18 (o no
 *   traía ramo) se respeta el `cproducto` de la sesión (p. ej. 248 del marketplace).
 * - Placa binacional (B): sin cambios (Binacional usa sus propios ramos).
 */
export function normalizeRcvPlanesQuery(qs: URLSearchParams, iplaca?: string | null): void {
  if (String(iplaca ?? '').trim().toUpperCase() === 'B') return;

  const cramoSesion = qs.get('cramo')?.trim();
  if (cramoSesion && cramoSesion !== String(RCV_CRAMO)) {
    qs.set('cproducto', RCV_CPRODUCTO_SIS2000);
  }
  qs.set('cramo', String(RCV_CRAMO));
}
