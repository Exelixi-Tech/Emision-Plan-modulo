'use strict';

/**
 * Observaciones de la póliza RCV (adpoliza.xobserva, VARCHAR(255)).
 * nest-api (createEmissionAuto) acepta `observaciones` y rechaza con 400 si pasa de 255,
 * así que aquí se limpia y se corta antes de enviarlo. Vacío = no se envía el campo.
 */
const OBSERVACIONES_MAX = 255;

/**
 * Saltos de línea, tabs y otros caracteres de control pasan a un espacio, se colapsan
 * espacios repetidos, se recorta y se trunca a 255. Devuelve undefined si no queda texto.
 * @param {unknown} raw
 * @returns {string | undefined}
 */
function normalizarObservaciones(raw) {
  if (typeof raw !== 'string') return undefined;
  const texto = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, OBSERVACIONES_MAX)
    .trim();
  return texto === '' ? undefined : texto;
}

module.exports = { OBSERVACIONES_MAX, normalizarObservaciones };
