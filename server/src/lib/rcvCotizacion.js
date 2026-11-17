/**
 * Emitir RCV desde una cotización de automóvil de SysIP (sopoliza.cproces).
 *
 * Funciones puras del flujo nuevo (sin red). El flujo solo se activa si el nexus_token validado trae
 * `cotizacionID` en la metadata: el número de la cotización nunca se toma de la URL ni del body.
 * Pagos no reenvía el token de Emisión, así que entre "preparar el pago" y "emitir" el número viaja en
 * un comprobante firmado por este server (ticket), nunca en texto plano editable.
 */
const jwt = require('jsonwebtoken');

/** sopoliza.cproces es NUMERIC(13). */
const CPROCES_RE = /^\d{1,13}$/;
const COTIZACION_ID_KEYS = ['cotizacionID', 'cotizacionId'];

/** Número de la cotización en la metadata del token, o null si no viene (flujo de siempre). */
function readCotizacionId(meta) {
  if (!meta || typeof meta !== 'object') return null;
  for (const key of COTIZACION_ID_KEYS) {
    const raw = meta[key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (CPROCES_RE.test(value) && Number(value) > 0) return value;
  }
  return null;
}

function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Cuotas por frecuencia: misma tabla que Pagos (frecuencia.ts) y sp_genera_coberturas_recibos_auto_rcv_nexus. */
const CUOTAS_BY_FREC = { A: 1, S: 2, T: 4, C: 3, M: 12, E: 1, D: 1, B: 1 };

function normalizeFrecuencia(code) {
  return String(code ?? 'A').trim().toUpperCase().charAt(0) || 'A';
}

function cuotasPorFrecuencia(code) {
  return CUOTAS_BY_FREC[normalizeFrecuencia(code)] ?? 1;
}

/**
 * RCV básico = Daños a personas (ccoberturaint 15) y Daños a cosas (17): van completas en el primer recibo.
 * El contrato de la cotización trae ccober + nombre; si algún día trae `cuotaInicial` o `ccoberturaint` se usa eso.
 */
const CUOTA_INICIAL_CINT = new Set(['15', '17']);
const RCV_BASICO_RE = /DA[ÑN]OS?\s+A\s+(LAS\s+)?(PERSONAS|COSAS)/i;

function esCoberturaCuotaInicial(cob) {
  if (!cob || typeof cob !== 'object') return false;
  if (typeof cob.cuotaInicial === 'boolean') return cob.cuotaInicial;
  const cint = cob.ccoberturaint ?? cob.coberturaInt;
  if (cint != null && String(cint).trim() !== '') return CUOTA_INICIAL_CINT.has(String(cint).trim());
  const nombre = String(cob.nombre ?? '');
  return RCV_BASICO_RE.test(nombre) && !/EXCESO/i.test(nombre);
}

/** Prima anual USD de la opción y la parte que va completa en el primer recibo. */
function resumenOpcion(opcion) {
  const coberturas = Array.isArray(opcion?.coberturas) ? opcion.coberturas : [];
  const rcvBasicoUsd = round2(
    coberturas.reduce((sum, c) => {
      const prima = Number(c?.primaUsd ?? 0);
      return esCoberturaCuotaInicial(c) && Number.isFinite(prima) && prima > 0 ? sum + prima : sum;
    }, 0),
  );
  return { annualUsd: round2(opcion?.primaUsd), rcvBasicoUsd };
}

/**
 * Monto del PRIMER recibo. Regla del SP: el RCV básico va completo en el recibo 1 y el resto se divide
 * entre las cuotas; si solo hay RCV básico, un único recibo. La cuota USD se redondea a 2 decimales
 * antes de pasar a Bs (ROUND(cuota_usd × tasa, 2)).
 */
function computePrimerRecibo({ annualUsd, rcvBasicoUsd = 0, frecuencia, ptasa }) {
  const annual = round2(annualUsd);
  let cuotas = cuotasPorFrecuencia(frecuencia);
  const rcv = cuotas > 1 ? round2(Math.max(0, Number(rcvBasicoUsd) || 0)) : 0;
  if (cuotas > 1 && rcv > 0 && rcv >= annual) cuotas = 1;
  const rcvInicialUsd = cuotas > 1 ? rcv : 0;
  const siguienteUsd = round2((annual - rcvInicialUsd) / cuotas);
  const primerUsd = round2(rcvInicialUsd + siguienteUsd);
  const tasa = Number(ptasa) > 0 ? Number(ptasa) : 0;
  return {
    cuotas,
    annualUsd: annual,
    rcvInicialUsd,
    primerUsd,
    siguienteUsd: cuotas > 1 ? siguienteUsd : 0,
    ptasa: tasa,
    annualVes: tasa ? round2(annual * tasa) : 0,
    primerVes: tasa ? round2(primerUsd * tasa) : 0,
    siguienteVes: tasa && cuotas > 1 ? round2(siguienteUsd * tasa) : 0,
  };
}

function toYmd(value) {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function diffDays(desde, hasta) {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Vigencia de la emisión = la de la cotización. Si su inicio ya pasó no se emite con fecha atrasada:
 * desde hoy por el mismo número de días (el SP solo exige el mismo plazo, o ambos anuales).
 */
function resolveVigenciaEmision(vigencia, hoyYmd) {
  const desde = toYmd(vigencia?.desde);
  const hasta = toYmd(vigencia?.hasta);
  const diasRaw = Number(vigencia?.dias);
  const dias = Number.isFinite(diasRaw) && diasRaw > 0
    ? Math.round(diasRaw)
    : (desde && hasta ? diffDays(desde, hasta) : 365);
  if (desde && hasta && desde >= hoyYmd) {
    return { fdesde: desde, fhasta: hasta, dias, ajustada: false };
  }
  return { fdesde: hoyYmd, fhasta: addDaysYmd(hoyYmd, dias), dias, ajustada: true };
}

/** Nombre completo de la cotización → nombres / apellidos (V/E). Persona jurídica: razón social en nombre. */
function splitNombreCompleto(nombreCompleto, tipoDoc) {
  const full = String(nombreCompleto ?? '').trim().replace(/\s+/g, ' ');
  const tipo = String(tipoDoc ?? '').trim().toUpperCase().charAt(0);
  if (['J', 'G', 'C'].includes(tipo)) return { nombre: full, apellido: '' };
  const words = full ? full.split(' ') : [];
  if (words.length <= 1) return { nombre: full, apellido: full };
  if (words.length === 2) return { nombre: words[0], apellido: words[1] };
  if (words.length === 3) return { nombre: words[0], apellido: words.slice(1).join(' ') };
  return { nombre: words.slice(0, 2).join(' '), apellido: words.slice(2).join(' ') };
}

/** Opciones que este flujo puede emitir (Solo RCV). */
function opcionesSoloRcv(cotizacion) {
  const opciones = Array.isArray(cotizacion?.opciones) ? cotizacion.opciones : [];
  return opciones.filter((o) => o && o.soloRcv === true && Number(o.primaUsd) > 0);
}

const CASCO_MSG = 'La cotización incluye coberturas de casco: se emite en Auto Casco, no en este flujo.';

/** Motivos por los que no se puede continuar ([] = se puede). */
function motivosNoEmitible(cotizacion) {
  const motivos = (Array.isArray(cotizacion?.motivos) ? cotizacion.motivos : [])
    .filter((m) => m && (m.codigo || m.mensaje))
    .map((m) => ({
      codigo: String(m.codigo || 'NO_EMITIBLE'),
      mensaje: /CASCO/i.test(String(m.codigo || '')) ? CASCO_MSG : String(m.mensaje || m.codigo),
    }));
  if (cotizacion?.emitida) {
    if (!motivos.some((m) => /EMITIDA/i.test(m.codigo))) {
      motivos.push({
        codigo: 'COTIZACION_EMITIDA',
        mensaje: `La cotización ya fue emitida${cotizacion.poliza ? ` (póliza ${cotizacion.poliza})` : ''}.`,
      });
    }
  }
  if (cotizacion?.emitible === true && !cotizacion?.emitida && opcionesSoloRcv(cotizacion).length === 0) {
    motivos.push({ codigo: 'CASCO', mensaje: CASCO_MSG });
  }
  if (cotizacion?.emitible !== true && motivos.length === 0) {
    motivos.push({ codigo: 'NO_EMITIBLE', mensaje: 'La cotización no se puede emitir.' });
  }
  return motivos;
}

// ── Comprobante firmado entre Emisión y Pagos ───────────────────────────────

const TICKET_TYP = 'rcv-cotizacion';

function ticketSecret() {
  return String(process.env.RCV_COTIZACION_TICKET_SECRET || process.env.TENANT_TOKEN_SECRET || '').trim();
}

/** @returns {string|null} null si el server no tiene secreto configurado. */
function signTicket({ cproces, opcion, frecuencia, primaUsd }) {
  const secret = ticketSecret();
  if (!secret) return null;
  return jwt.sign(
    { typ: TICKET_TYP, cproces: String(cproces), opcion: Number(opcion), frecuencia: normalizeFrecuencia(frecuencia), primaUsd: round2(primaUsd) },
    secret,
    { expiresIn: process.env.RCV_COTIZACION_TICKET_TTL || '12h' },
  );
}

/** @returns {{cproces:string, opcion:number, frecuencia:string, primaUsd:number}|null} */
function verifyTicket(ticket) {
  const secret = ticketSecret();
  if (!secret || typeof ticket !== 'string' || !ticket) return null;
  try {
    const p = jwt.verify(ticket, secret);
    if (!p || p.typ !== TICKET_TYP || !CPROCES_RE.test(String(p.cproces))) return null;
    return { cproces: String(p.cproces), opcion: Number(p.opcion), frecuencia: String(p.frecuencia), primaUsd: Number(p.primaUsd) };
  } catch {
    return null;
  }
}

module.exports = {
  readCotizacionId,
  round2,
  normalizeFrecuencia,
  cuotasPorFrecuencia,
  esCoberturaCuotaInicial,
  resumenOpcion,
  computePrimerRecibo,
  resolveVigenciaEmision,
  splitNombreCompleto,
  opcionesSoloRcv,
  motivosNoEmitible,
  signTicket,
  verifyTicket,
  CASCO_MSG,
};
