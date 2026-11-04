/**
 * Validador del payload de emision La Mundial.
 *
 * Se ejecuta SIEMPRE antes de llamar a createEmissionAuto. Si hay errores,
 * el orquestador rechaza la emision con HTTP 400 + lista detallada,
 * SIN consumir el cupo de la API real.
 */

function ageInYears(yyyymmdd) {
  if (!yyyymmdd) return -1;
  const m = String(yyyymmdd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return -1;
  const birth = new Date(`${yyyymmdd}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return -1;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

/**
 * V/P: cédula venezolana o pasaporte (1-8 dígitos).
 * J/G/C: RIF de persona jurídica con dígito verificador, ej. J-31317476-9 (1-9), como lo guarda Sis2000.
 * E: documento extranjero, ej. C.C. Colombia (1-10).
 */
const RIF_MAX_DIGITOS = { E: 10, J: 9, G: 9, C: 9 };

function rifMaxDigitos(tipo) {
  return RIF_MAX_DIGITOS[String(tipo || '').trim().toUpperCase()] ?? 8;
}

function rifValido(rif, tipo) {
  return new RegExp(`^\\d{1,${rifMaxDigitos(tipo)}}$`).test(String(rif || ''));
}

/**
 * Año del vehículo: el SP RCV exige > 1900 y el catálogo INMA (VInma) llega hasta el año actual + 2
 * (en QA, 1950-2028). Sis2000 ya tiene emisiones RCV de vehículos anteriores a 1980.
 */
const FANO_MIN = 1901;
const FANO_MAX_ADELANTO = 2;

function fanoValido(fano) {
  return Number.isInteger(fano) && fano >= FANO_MIN && fano <= new Date().getFullYear() + FANO_MAX_ADELANTO;
}

/**
 * @param {object} p Payload de createEmissionAuto ya construido por mapper.
 * @returns {string[]} Lista de errores (vacia = OK).
 */
function validateEmissionPayload(p) {
  const errors = [];

  if (!p) {
    errors.push('payload requerido');
    return errors;
  }

  // Identificadores (poliza/cnpoliza_rel no se envían; Sis2000 genera cnpoliza)
  if (!p.cramo) errors.push('cramo requerido');
  if (!p.plan || !String(p.plan).trim()) errors.push('plan requerido (vacío)');
  if (!['A', 'S', 'C', 'T', 'M', 'D', 'E'].includes(p.frecuencia)) {
    errors.push(`frecuencia invalida: ${p.frecuencia}`);
  }
  if (p.frecuencia === 'D' && !(Number(p.ndias) > 0)) {
    errors.push('ndias requerido para frecuencia D (binacional)');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha_emision || '')) errors.push('fecha_emision formato YYYY-MM-DD');

  // Tomador — cédula/RIF: 1–8 dígitos (alineado con formulario Exélixi)
  if (!/^[VEJ]$/.test(p.tipo_cedula_tomador || '')) errors.push('tipo_cedula_tomador invalido (V|E|J)');
  if (!rifValido(p.rif_tomador, p.tipo_cedula_tomador)) {
    errors.push(`rif_tomador invalido (solo digitos, 1-${rifMaxDigitos(p.tipo_cedula_tomador)})`);
  }
  if (!p.nombre_tomador?.trim()) errors.push('nombre_tomador requerido');
  // Persona jurídica (J): apellido y fecha de nacimiento no aplican (el SP RCV no exige apellido a J/G/C).
  const tomadorPJ = p.tipo_cedula_tomador === 'J';
  const titularPJ = p.tipo_cedula_titular === 'J';
  if (!tomadorPJ && !p.apellido_tomador?.trim()) errors.push('apellido_tomador requerido');
  if (!/^[+]?\d{8,15}$/.test(String(p.telefono_tomador || '').replace(/\s+/g, ''))) {
    errors.push('telefono_tomador invalido (8-15 digitos, opcional +)');
  }
  if (!/.+@.+\..+/.test(p.correo_tomador || '')) errors.push('correo_tomador invalido');
  if (tomadorPJ) {
    if (p.fnac_tomador && !/^\d{4}-\d{2}-\d{2}$/.test(p.fnac_tomador)) errors.push('fnac_tomador formato YYYY-MM-DD');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fnac_tomador || '')) {
    errors.push('fnac_tomador formato YYYY-MM-DD');
  } else if (ageInYears(p.fnac_tomador) < 18) {
    errors.push('tomador debe ser mayor de edad (18+)');
  }
  if (!p.direccion_tomador?.trim()) errors.push('direccion_tomador requerida');

  // Titular (si distinto al tomador, mismas reglas basicas)
  if (!/^[VEJ]$/.test(p.tipo_cedula_titular || '')) errors.push('tipo_cedula_titular invalido (V|E|J)');
  if (!rifValido(p.rif_titular, p.tipo_cedula_titular)) {
    errors.push(`rif_titular invalido (solo digitos, 1-${rifMaxDigitos(p.tipo_cedula_titular)})`);
  }
  if (!p.nombre_titular?.trim()) errors.push('nombre_titular requerido');
  if (!titularPJ && !p.apellido_titular?.trim()) errors.push('apellido_titular requerido');
  if (titularPJ) {
    if (p.fnac_titular && !/^\d{4}-\d{2}-\d{2}$/.test(p.fnac_titular)) errors.push('fnac_titular formato YYYY-MM-DD');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fnac_titular || '')) {
    errors.push('fnac_titular formato YYYY-MM-DD (fecha nacimiento titular/asegurado)');
  } else if (ageInYears(p.fnac_titular) < 18) {
    errors.push('titular debe ser mayor de edad (18+)');
  }

  // Vehiculo
  if (!/^[A-Z0-9]{6,8}$/.test(p.placa || '')) errors.push('placa invalida (6-8 alfanumericos en mayusculas)');
  if (!p.serial_carroceria?.trim()) errors.push('serial_carroceria requerido');
  if (!fanoValido(p.fano)) {
    errors.push(`fano fuera de rango (${FANO_MIN}-${new Date().getFullYear() + FANO_MAX_ADELANTO})`);
  }

  // Economicos (vienen de cotizacion)
  if (!(Number(p.mprima) > 0)) errors.push('mprima debe venir de cotizacion (> 0)');
  if (!(Number(p.mprimaext) >= 0)) errors.push('mprimaext invalido');
  if (!(Number(p.ptasa) > 0)) errors.push('ptasa debe venir de cotizacion (> 0)');

  // Declaraciones legales
  if (!['0', '1'].includes(String(p.dec_persona_politica))) errors.push('dec_persona_politica debe ser "0" o "1"');
  if (String(p.dec_term_y_cod) !== '1') errors.push('dec_term_y_cod debe ser "1" (acepta terminos)');

  return errors;
}

module.exports = { validateEmissionPayload, _internal: { ageInYears, fanoValido, rifMaxDigitos, rifValido } };
