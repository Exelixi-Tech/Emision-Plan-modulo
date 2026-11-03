/**
 * Persona jurídica (RIF J/G/C) y pasaporte: helpers comunes de RCV (policyMapper) y personas (personasMapper).
 *
 * Movido desde policyMapper sin cambiar el comportamiento de RCV:
 *  - nombresPJ: nombre = razón social; apellido según RCV_PJ_APELLIDO_MODO (o el modo que se pase).
 *  - resolveFechaPJ: fecha de constitución → inscripción del RIF (OCR) → fallback (RCV: fecha de emisión).
 *
 * Pasaporte (P): Sis2000 guarda la identificación en maclient.cci_rif (NUMERIC) y los SP reciben
 * @xrif_* numeric(9). Un pasaporte solo numérico viaja como icedula 'P'; uno alfanumérico
 * (p. ej. EM2849387) no cabe y se rechaza con un mensaje claro (no se quitan letras).
 */

const TIPOS_JURIDICOS = ['J', 'G', 'C'];

const MSG_PASAPORTE_ALFANUMERICO =
  'Sis2000 solo admite identificación numérica (maclient.cci_rif). Para pasaporte alfanumérico use el RIF personal E-xxxxxxxx-x';

function cleanString(v) {
  if (v == null) return '';
  return String(v).trim();
}

/** YYYY-MM-DD o null (misma lógica que normalizeDate de policyMapper). */
function normalizeDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[/\-](\d{2})[/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function esTipoJuridico(tipo) {
  return TIPOS_JURIDICOS.includes(cleanString(tipo).toUpperCase().charAt(0));
}

/**
 * RCV persona jurídica: cómo se manda el apellido al SP (env RCV_PJ_APELLIDO_MODO).
 *  - razon_social (default): apellido = razón social, igual que SysIP.
 *  - vacio: apellido = '' (el SP no lo exige para J/G/C).
 */
function rcvPjApellidoModo() {
  const v = String(process.env.RCV_PJ_APELLIDO_MODO || '').trim().toLowerCase();
  return v === 'vacio' ? 'vacio' : 'razon_social';
}

/** OCR del RIF (slot cédula) si el estado de la sesión lo trae. */
function ocrRifDe(state, slot) {
  const ocr = state?.documents?.[slot]?.ocr;
  return ocr && typeof ocr === 'object' ? ocr : {};
}

/** Persona jurídica: nombre = razón social; apellido según modo (default RCV_PJ_APELLIDO_MODO). */
function nombresPJ(person, ocr, modo = rcvPjApellidoModo()) {
  const razon = cleanString(person?.nombre || person?.razonSocial || ocr?.razonSocial || ocr?.nombre);
  return { nombre: razon, apellido: modo === 'vacio' ? '' : razon };
}

/** Persona jurídica: fecha de constitución → inscripción del RIF → fallback (RCV pasa la fecha de emisión). */
function resolveFechaPJ(person, ocr, fallback) {
  return normalizeDate(person?.fechaInscripcion || ocr?.fechaInscripcion || '') || fallback;
}

/** Pasaporte con número solo de dígitos (cabe en cci_rif NUMERIC). */
function esPasaporteNumerico(identificacion) {
  return /^\d{1,9}$/.test(cleanString(identificacion).replace(/[\s.-]/g, ''));
}

/** Pasaporte (P) cuyo número trae letras: Sis2000 no lo puede guardar. */
function esPasaporteAlfanumerico(tipo, identificacion) {
  if (cleanString(tipo).toUpperCase().charAt(0) !== 'P') return false;
  const id = cleanString(identificacion).replace(/[\s.-]/g, '');
  return id !== '' && !/^\d+$/.test(id);
}

module.exports = {
  TIPOS_JURIDICOS,
  MSG_PASAPORTE_ALFANUMERICO,
  esTipoJuridico,
  rcvPjApellidoModo,
  ocrRifDe,
  nombresPJ,
  resolveFechaPJ,
  esPasaporteNumerico,
  esPasaporteAlfanumerico,
};
