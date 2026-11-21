/**
 * Criterio de la emisión simulada para el flujo de prueba MarketPlace (marca neutra).
 *
 * Mismo criterio que el pago simulado de Pagos (pagoSimuladoMarcaNeutra.js). Con la
 * simulación activa, Emisión responde planes, cotización y póliza de PRUEBA sin llamar
 * a nest-api ni a Sis2000.
 *
 * Se permite solo si se cumplen TODAS:
 *   (a) la petición viene marcada como marca neutra (header X-Exelixi-Marca
 *       o query ?marca=neutra);
 *   (b) EMISION_SIMULADA_MARCA_NEUTRA=1 en el .env del server (solo en el 120;
 *       nunca por defecto);
 *   (c) el entorno no es producción: ENTORNO/APP_ENV no dicen producción y
 *       ningún host de la petición (Host, X-Forwarded-Host, Origin, Referer)
 *       es de producción (emision.exelixitech.com, pagos.exelixitech.com +
 *       EMISION_HOSTS_PRODUCCION).
 *
 * Si la marca neutra viene pedida pero no está permitida, la emisión se rechaza
 * (403 SIMULACION_NO_PERMITIDA): en modo neutro jamás se emite real.
 */

const HOSTS_PRODUCCION_FIJOS = ['emision.exelixitech.com', 'pagos.exelixitech.com'];
const ENTORNOS_PRODUCCION = ['produccion', 'producción', 'production', 'prod'];

function flagActivo(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

function hostDe(value) {
  const raw = String(value ?? '').split(',')[0].trim().toLowerCase();
  if (!raw) return '';
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) return new URL(raw).hostname;
  } catch {
    return '';
  }
  // Host[:puerto]
  return raw.replace(/:\d+$/, '');
}

function header(headers, name) {
  if (!headers) return undefined;
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function hostsProduccion(env) {
  const extra = String(env.EMISION_HOSTS_PRODUCCION ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...HOSTS_PRODUCCION_FIJOS, ...extra]);
}

/** true si la petición viene marcada como marca neutra (header o query). */
function pideMarcaNeutra({ headers = {}, query = {} } = {}) {
  const marca = String(header(headers, 'x-exelixi-marca') ?? query?.marca ?? '')
    .trim()
    .toLowerCase();
  return marca === 'neutra';
}

/**
 * @param {{ env?: object, headers?: object, query?: object }} input
 * @returns {{ permitido: boolean, motivo: string }}
 */
function evaluarSimulacionMarcaNeutra({ env = process.env, headers = {}, query = {} } = {}) {
  if (!pideMarcaNeutra({ headers, query })) return { permitido: false, motivo: 'sin_marca_neutra' };

  if (!flagActivo(env.EMISION_SIMULADA_MARCA_NEUTRA)) {
    return { permitido: false, motivo: 'variable_desactivada' };
  }

  const entorno = String(env.ENTORNO ?? env.APP_ENV ?? '').trim().toLowerCase();
  if (ENTORNOS_PRODUCCION.includes(entorno)) {
    return { permitido: false, motivo: 'entorno_produccion' };
  }

  const prod = hostsProduccion(env);
  const hosts = [
    header(headers, 'host'),
    header(headers, 'x-forwarded-host'),
    header(headers, 'origin'),
    header(headers, 'referer'),
  ].map(hostDe).filter(Boolean);
  if (hosts.some((h) => prod.has(h))) {
    return { permitido: false, motivo: 'host_produccion' };
  }

  return { permitido: true, motivo: 'ok' };
}

module.exports = { evaluarSimulacionMarcaNeutra, pideMarcaNeutra };
