/**
 * Mapper del producto Patrimonial (Riesgos Generales, cramo 20):
 * Transforma el estado del wizard del frontend en el payload esperado por
 * el endpoint /api/v1/emissions/generalRisks de nest-api / SysIP.
 */

function onlyDigits(v) {
  if (v == null) return '';
  return String(v).replace(/\D+/g, '');
}

function digitsToNumber(v) {
  const d = onlyDigits(v);
  return d ? Number(d) : null;
}

function cleanString(v) {
  if (v == null) return '';
  return String(v).trim();
}

function cleanPhone(v) {
  if (v == null) return '';
  return String(v).replace(/\D/g, '');
}

function normalizeDateIso(v) {
  if (!v) return null;
  const s = String(v).trim();
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString();
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return !Number.isNaN(dt.getTime()) ? dt.toISOString() : null;
  }
  return null;
}

function normalizeDateYmd(v) {
  if (!v) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function calculateFhastaYmd(fdesdeYmd) {
  const parts = fdesdeYmd.split('-').map(Number);
  const year = parts[0] + 1;
  const month = String(parts[1]).padStart(2, '0');
  const day = String(parts[2]).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeTipoCedula(v) {
  const s = cleanString(v).toUpperCase().charAt(0);
  return ['V', 'E', 'J', 'G', 'P'].includes(s) ? (s === 'P' ? 'V' : s) : 'V';
}

function normalizeSexo(v) {
  const s = cleanString(v).toUpperCase().charAt(0);
  return s === 'F' ? 'F' : 'M';
}

function normalizeEstadoCivil(v) {
  const s = cleanString(v).toUpperCase().charAt(0);
  return s || 'S';
}

function genInternalPolicyId(prefix = 'PAT') {
  const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${ts}-${rand}`;
}

/**
 * Construye el objeto `bien_asegurado` a partir de los 3 items del formulario:
 * 1. datosBien (Nombre o identificación del bien)
 * 2. tipo (Clasificación del bien)
 * 3. descripcion (Descripción detallada)
 * @param {object} patrimoniales
 * @param {object} tomador
 */
function buildBienAsegurado(patrimoniales = {}, tomador = {}) {
  const datosBien = cleanString(patrimoniales.datosBien || patrimoniales.nombreBien || patrimoniales.nombre);
  const tipo = cleanString(patrimoniales.tipo || patrimoniales.tipoBien || 'Residencial');
  const descripcion = cleanString(patrimoniales.descripcion || patrimoniales.detalle || '');

  const xdescrip1 = `<strong>Datos del Bien:</strong> ${datosBien || 'N/A'} - <strong>Tipo:</strong> ${tipo || 'N/A'}`;
  const xdescrip2 = descripcion ? `<strong>Descripción:</strong> ${descripcion}` : '';
  const xdescrip3 = '';
  const xdescrip4 = '';

  const direccion = cleanString(patrimoniales.direccion || tomador.direccion || '');

  return {
    xdescrip1,
    xdescrip2,
    xdescrip3,
    xdescrip4,
    xdirecob: direccion,
    xdireccion: direccion,
  };
}

/**
 * Mapea el estado del wizard completo a la estructura requerida por generalRisks.
 *
 * @param {object} state - Estado completo del wizard
 * @param {object} cotizacion - Objeto de cotización con mprima, mprimaext, ptasa, etc.
 * @param {object} [overrides] - Parámetros override (plan, frecuencia, etc.)
 */
function mapWizardToGeneralRisksEmitDto(state, cotizacion = {}, overrides = {}) {
  const tomador = state.tomador || {};
  const sameInsured = state.sameInsured !== false;
  const aseguradoData = !sameInsured && state.asegurado && state.asegurado.identificacion ? state.asegurado : tomador;
  const patrimoniales = state.patrimoniales || state.bien || {};
  const metadataCanal = state.metadataCanal || {};

  const cramo = String(
    overrides.cramo ||
    state.cramo ||
    metadataCanal.cramo ||
    process.env.LAMUNDIAL_RAMO_PATRIMONIAL ||
    '20',
  );

  const cplan = String(
    overrides.plan ||
    state.selectedPlan?.cplan ||
    state.cplan ||
    'RCE9',
  ).trim();

  const ifrecuencia = String(
    overrides.frecuencia ||
    state.frecuencia ||
    state.rcv?.frecuencia ||
    'A',
  ).trim().toUpperCase();

  const cproductorRaw =
    metadataCanal.cproductor ??
    metadataCanal.citem ??
    process.env.LAMUNDIAL_PRODUCTOR ??
    366;
  const cproductor = parseInt(String(cproductorRaw).replace(/\D/g, ''), 10) || 366;

  const ccanalaltRaw = metadataCanal.ccanalalt_in ?? metadataCanal.ccanalalt;
  const ccanalalt = ccanalaltRaw != null && String(ccanalaltRaw).trim() !== '' ? String(ccanalaltRaw).trim() : '366';
  const cscanalalt = metadataCanal.cscanalalt_in ?? metadataCanal.cscanalalt ?? null;
  const ctipocanal = metadataCanal.ctipocanal ?? null;
  const cusuario = metadataCanal.cusuario ? parseInt(String(metadataCanal.cusuario), 10) : null;
  const xcorreo_gestor = cleanString(metadataCanal.xcorreo_gestor || tomador.email || '');

  const femision = normalizeDateYmd(overrides.femision || state.femision);
  const fdesde = normalizeDateYmd(overrides.fdesde || state.fdesde || femision);
  const fhasta = overrides.fhasta || calculateFhastaYmd(fdesde);

  const internalPolicyId = overrides.internalPolicyId || genInternalPolicyId();

  const payload = {
    keys: {
      cnpoliza_rel: overrides.cnpoliza_rel ?? null,
      cramo,
      cplan,
    },
    tomador: {
      tipo_tomador: normalizeTipoCedula(tomador.tipoDoc),
      rif_tomador: digitsToNumber(tomador.identificacion),
      nombre_tomador: cleanString(tomador.nombre),
      apellido_tomador: cleanString(tomador.apellido),
      sexo_tomador: normalizeSexo(tomador.sexo),
      estado_civil_tomador: normalizeEstadoCivil(tomador.estadoCivil),
      fnac_tomador: normalizeDateIso(tomador.fechaNac),
      telefono_tomador: cleanPhone(tomador.telefono),
      correo_tomador: cleanString(tomador.email),
      estado_tomador: cleanString(tomador.estado || 'Dtto Capital'),
      ciudad_tomador: cleanString(tomador.ciudad || 'Caracas'),
      direccion_tomador: cleanString(tomador.direccion || 'Av Panteon'),
    },
    asegurado: {
      tipo_asegurado: normalizeTipoCedula(aseguradoData.tipoDoc),
      rif_asegurado: digitsToNumber(aseguradoData.identificacion),
      nombre_asegurado: cleanString(aseguradoData.nombre),
      apellido_asegurado: cleanString(aseguradoData.apellido),
      sexo_asegurado: normalizeSexo(aseguradoData.sexo),
      estado_civil_asegurado: normalizeEstadoCivil(aseguradoData.estadoCivil),
      fnac_asegurado: normalizeDateIso(aseguradoData.fechaNac),
      telefono_asegurado: cleanPhone(aseguradoData.telefono),
      correo_asegurado: cleanString(aseguradoData.email),
      estado_asegurado: cleanString(aseguradoData.estado || tomador.estado || 'Dtto Capital'),
      ciudad_asegurado: cleanString(aseguradoData.ciudad || tomador.ciudad || 'Caracas'),
      direccion_asegurado: cleanString(aseguradoData.direccion || tomador.direccion || 'Av Panteon'),
    },
    bien_asegurado: buildBienAsegurado(patrimoniales, tomador),
    femision,
    fdesde,
    fhasta,
    ptasamon: cotizacion.ptasa != null ? Number(cotizacion.ptasa) : null,
    ctipocanal,
    ccanalalt,
    cscanalalt,
    cusuario,
    xcorreo_gestor,
    cproductor,
    ifrecuencia,
    suma_asegurada: state.selectedPlan?.sumaAsegurada ?? null,
    prima: cotizacion.mprimaext ?? cotizacion.mprima ?? null,
    dec_persona_politica: tomador.personaPoliticamenteExpuesta === true ? 1 : 0,
    dec_term_y_cod: 1,
  };

  return {
    payload,
    metadata: {
      internalPolicyId,
      cplan,
      cramo,
      ifrecuencia,
      product: 'patrimonial',
    },
  };
}

module.exports = {
  mapWizardToGeneralRisksEmitDto,
  buildBienAsegurado,
  _internal: {
    onlyDigits,
    digitsToNumber,
    normalizeDateIso,
    normalizeDateYmd,
    calculateFhastaYmd,
    genInternalPolicyId,
  },
};
