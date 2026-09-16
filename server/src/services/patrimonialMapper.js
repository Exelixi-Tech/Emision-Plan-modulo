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
  // If already formatted with xdescrip1..4
  if (patrimoniales.xdescrip1 != null || patrimoniales.xdescrip2 != null) {
    return {
      xdescrip1: cleanString(patrimoniales.xdescrip1 || ''),
      xdescrip2: cleanString(patrimoniales.xdescrip2 || ''),
      xdescrip3: cleanString(patrimoniales.xdescrip3 || ''),
      xdescrip4: cleanString(patrimoniales.xdescrip4 || ''),
    };
  }

  const datosBien = cleanString(patrimoniales.datosBien || patrimoniales.nombreBien || patrimoniales.nombre);
  const direccion = cleanString(patrimoniales.direccion || tomador.direccion);
  const tipo = cleanString(patrimoniales.tipo || patrimoniales.tipoBien);
  const descripcion = cleanString(patrimoniales.descripcion || patrimoniales.detalle);

  return {
    xdescrip1: datosBien,
    xdescrip2: direccion,
    xdescrip3: tipo,
    xdescrip4: descripcion,
  };
}

/**
 * Mapea el estado del wizard completo a la estructura requerida por generalRisks (CreateEmissionGeneralRiskDto).
 *
 * @param {object} state - Estado completo del wizard
 * @param {object} cotizacion - Objeto de cotización con mprima, mprimaext, ptasa, etc.
 * @param {object} [overrides] - Parámetros override (plan, frecuencia, etc.)
 */
function mapWizardToGeneralRisksEmitDto(state, cotizacion = {}, overrides = {}) {
  const tomador = state.tomador || {};
  const sameInsured = state.sameInsured !== false;
  const aseguradoData = !sameInsured && state.asegurado && (state.asegurado.identificacion || state.asegurado.rif_asegurado)
    ? state.asegurado
    : tomador;
  const patrimoniales = state.patrimoniales || state.bien || state.bien_asegurado || {};
  const metadataCanal = state.metadataCanal || {};

  const cramo = Number(
    overrides.cramo ||
    state.cramo ||
    metadataCanal.cramo ||
    process.env.LAMUNDIAL_RAMO_PATRIMONIAL ||
    20,
  );

  const cplan = String(
    overrides.plan ||
    state.selectedPlan?.cplan ||
    state.cplan ||
    '',
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
    null;
  const cproductor = parseInt(String(cproductorRaw ?? '').replace(/\D/g, ''), 10) || null;

  const ccanalaltRaw = metadataCanal.ccanalalt_in ?? metadataCanal.ccanalalt;
  const ccanalalt = ccanalaltRaw != null && String(ccanalaltRaw).trim() !== '' ? String(ccanalaltRaw).trim() : null;
  const cscanalalt = metadataCanal.cscanalalt_in ?? metadataCanal.cscanalalt ?? null;
  const ctipocanal = metadataCanal.ctipocanal ?? null;
  const xfuente = cleanString(overrides.xfuente || metadataCanal.xfuente || 'API');

  const femision = normalizeDateYmd(overrides.femision || state.femision);
  const fdesde = normalizeDateYmd(overrides.fdesde || state.fdesde || femision);
  const fhasta = overrides.fhasta || calculateFhastaYmd(fdesde);

  const internalPolicyId = overrides.internalPolicyId || genInternalPolicyId();

  const sumaAsegurada = Number(
    cotizacion.sumaAsegurada ??
    state.selectedPlan?.sumaAsegurada ??
    2000,
  );
  const prima = Number(
    cotizacion.mprimaext ??
    cotizacion.mprima ??
    150,
  );
  const ptasamon = Number(
    cotizacion.ptasa ??
    cotizacion.ptasamon ??
    state.quote?.ptasa ??
    state.ptasamon ??
    0,
  );

  const payload = {
    keys: {
      cnpoliza_rel: overrides.cnpoliza_rel ?? null,
      cplan,
      cramo,
    },
    tomador: {
      tipo_tomador: normalizeTipoCedula(tomador.tipoDoc || tomador.tipo_tomador),
      rif_tomador: digitsToNumber(tomador.identificacion || tomador.rif_tomador),
      nombre_tomador: cleanString(tomador.nombre || tomador.nombre_tomador).toUpperCase(),
      apellido_tomador: cleanString(tomador.apellido || tomador.apellido_tomador).toUpperCase(),
      sexo_tomador: normalizeSexo(tomador.sexo || tomador.sexo_tomador),
      estado_civil_tomador: normalizeEstadoCivil(tomador.estadoCivil || tomador.estado_civil_tomador),
      fnac_tomador: normalizeDateYmd(tomador.fechaNac || tomador.fechaNacimiento || tomador.fnac_tomador),
      telefono_tomador: cleanPhone(tomador.telefono || tomador.telefono_tomador),
      correo_tomador: cleanString(tomador.email || tomador.correo || tomador.correo_tomador),
      estado_tomador: cleanString(tomador.estado || tomador.estado_tomador),
      ciudad_tomador: cleanString(tomador.ciudad || tomador.ciudad_tomador),
      direccion_tomador: cleanString(tomador.direccion || tomador.direccion_tomador),
    },
    asegurado: {
      tipo_asegurado: normalizeTipoCedula(aseguradoData.tipoDoc || aseguradoData.tipo_asegurado),
      rif_asegurado: digitsToNumber(aseguradoData.identificacion || aseguradoData.rif_asegurado),
      nombre_asegurado: cleanString(aseguradoData.nombre || aseguradoData.nombre_asegurado).toUpperCase(),
      apellido_asegurado: cleanString(aseguradoData.apellido || aseguradoData.apellido_asegurado).toUpperCase(),
      sexo_asegurado: normalizeSexo(aseguradoData.sexo || aseguradoData.sexo_asegurado),
      estado_civil_asegurado: normalizeEstadoCivil(aseguradoData.estadoCivil || aseguradoData.estado_civil_asegurado),
      fnac_asegurado: normalizeDateYmd(aseguradoData.fechaNac || aseguradoData.fechaNacimiento || aseguradoData.fnac_asegurado),
      telefono_asegurado: cleanPhone(aseguradoData.telefono || aseguradoData.telefono_asegurado),
      correo_asegurado: cleanString(aseguradoData.email || aseguradoData.correo || aseguradoData.correo_asegurado),
      estado_asegurado: cleanString(aseguradoData.estado || aseguradoData.estado_asegurado || tomador.estado),
      ciudad_asegurado: cleanString(aseguradoData.ciudad || aseguradoData.ciudad_asegurado || tomador.ciudad),
      direccion_asegurado: cleanString(aseguradoData.direccion || aseguradoData.direccion_asegurado || tomador.direccion),
    },
    bien_asegurado: buildBienAsegurado(patrimoniales, tomador),
    suma_asegurada: sumaAsegurada,
    prima: prima,
    ptasamon: ptasamon,
    femision,
    fdesde,
    fhasta,
    dec_persona_politica: tomador.personaPoliticamenteExpuesta === true || tomador.dec_persona_politica === 1 ? 1 : 0,
    dec_term_y_cod: 1,
    cproductor,
    ifrecuencia,
    ctipocanal,
    ccanalalt,
    cscanalalt,
    xfuente,
  };

  return {
    payload,
    metadata: {
      internalPolicyId,
      cplan,
      cramo,
      ifrecuencia,
      product: 'patrimoniales',
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
