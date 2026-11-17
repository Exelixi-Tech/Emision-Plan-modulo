/**
 * Mapper del flujo "Emitir RCV desde cotización" → body de createEmissionAuto (nest-api).
 *
 * Reusa buildEmissionRequest + toLaMundialEmissionPayload del RCV de siempre (sin modificarlos) y fija
 * lo que manda la cotización: plan, vehículo (códigos INMA), tomador, vigencia y prima. Del navegador
 * solo se toman los datos que la cotización no trae (placa, seriales, color, asegurado, conductor,
 * dirección y contacto). Agrega cproces / ccerti_cotizacion / mprima_esperada / itipoEmi=NU.
 */
const {
  buildEmissionRequest,
  toLaMundialEmissionPayload,
  _internal: { todayYmd },
} = require('./policyMapper');
const { round2, splitNombreCompleto, resolveVigenciaEmision } = require('../lib/rcvCotizacion');

/** Datos del tomador que completa el usuario; identidad y nombre vienen de la cotización. */
const TOMADOR_CLIENT_KEYS = [
  'fechaNac', 'sexo', 'estadoCivil', 'direccion', 'cestado', 'estado', 'cciudad', 'ciudad',
  'telefono', 'email', 'personaPoliticamenteExpuesta', 'aceptaTerminos', 'declaraVeracidad',
  'cprofesion', 'cocupacion', 'cactividad', 'ocupacionSeparada', 'fechaInscripcion',
];

/** Datos del vehículo que completa el usuario; marca/modelo/versión/año/uso vienen de la cotización. */
const VEHICLE_CLIENT_KEYS = ['placa', 'serial', 'serialMotor', 'color'];

function pick(src, keys) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

function tipoPlacaDeCotizacion(tipoPlaca) {
  const s = str(tipoPlaca).toUpperCase();
  if (s.startsWith('B')) return 'binacional';
  if (s.startsWith('E')) return 'extranjera';
  return 'nacional';
}

function tipoDocDeCotizacion(tipoDoc) {
  const s = str(tipoDoc).toUpperCase().charAt(0);
  return s || 'V';
}

/**
 * Productor de la emisión: el de la cotización (documento comercial de SysIP). Si no trae, el del SSO.
 * Con centidad P el citem es el productor, así que se alinea.
 */
function metadataConProductorCotizacion(metadataCanal, cotizacion) {
  const meta = { ...(metadataCanal || {}) };
  const codigo = str(cotizacion?.productor?.codigo);
  if (!codigo) return meta;
  meta.cproductor = codigo;
  if (str(meta.centidad).toUpperCase() === 'P') meta.citem = codigo;
  return meta;
}

/** Estado del wizard con lo bloqueado por la cotización (el resto, del navegador). */
function buildCotizacionState({ cotizacion, state = {}, frecuencia, ndias }) {
  const cTom = cotizacion.tomador || {};
  const tipoDoc = tipoDocDeCotizacion(cTom.tipoDoc);
  const nombres = splitNombreCompleto(cTom.nombre, tipoDoc);
  const veh = cotizacion.vehiculo || {};
  const sameInsured = state.sameInsured !== false;
  const usoCodigo = veh.uso?.codigo;

  return {
    ...state,
    tomador: {
      ...pick(state.tomador, TOMADOR_CLIENT_KEYS),
      tipoDoc,
      identificacion: str(cTom.documento),
      nombre: nombres.nombre,
      apellido: nombres.apellido,
    },
    sameInsured,
    asegurado: sameInsured ? undefined : state.asegurado,
    hasBeneficiary: false,
    beneficiario: undefined,
    vehicle: {
      ...pick(state.vehicle, VEHICLE_CLIENT_KEYS),
      tipoPlaca: tipoPlacaDeCotizacion(veh.tipoPlaca),
      cmarca: str(veh.marca?.codigo),
      marca: str(veh.marca?.nombre),
      cmodelo: str(veh.modelo?.codigo),
      modelo: str(veh.modelo?.nombre),
      cversion: str(veh.version?.codigo),
      version: str(veh.version?.nombre),
      año: str(veh.anio),
      ...(usoCodigo != null && str(usoCodigo) !== '' ? { ccategoria_uso: usoCodigo } : {}),
      uso: str(veh.uso?.nombre) || 'Particular',
      ...(veh.tipo?.codigo != null ? { ctipo: veh.tipo.codigo } : {}),
      ntoneladas: veh.toneladas != null ? Number(veh.toneladas) : undefined,
      precargorcv: 0,
    },
    selectedPlan: { cplan: str(cotizacion.plan?.codigo), name: str(cotizacion.plan?.nombre) },
    rcv: { frecuencia, ndias: ndias ?? null, coberAdicional: 'RC', coberAdicionales: [] },
    metadataCanal: metadataConProductorCotizacion(state.metadataCanal, cotizacion),
  };
}

/**
 * @param {object} args
 * @param {object} args.cotizacion  data de GET /cotizaciones-auto/:cproces
 * @param {object} args.opcion      opción elegida (cotizacion.opciones[i])
 * @param {object} args.state       state del wizard (ya con metadataCanal fusionada del SSO)
 * @param {string} args.frecuencia  A|S|T|M…
 * @param {number|null} [args.ndias]
 * @param {number} args.ptasa       tasa Bs/USD del día
 * @param {string} [args.fechaEmision] YYYY-MM-DD (hoy por defecto)
 * @returns {{ payload: object, body: object, vigencia: object, metadata: object }}
 */
function buildCotizacionEmission({ cotizacion, opcion, state, frecuencia, ndias = null, ptasa, fechaEmision }) {
  const femision = fechaEmision || todayYmd();
  const primaUsd = round2(opcion.primaUsd);
  const tasa = Number(ptasa) > 0 ? Number(ptasa) : 0;
  const cotState = buildCotizacionState({ cotizacion, state, frecuencia, ndias });
  const plan = cotState.selectedPlan.cplan;

  const { payload, metadata } = buildEmissionRequest(
    cotState,
    { mprima: round2(primaUsd * tasa), mprimaext: primaUsd, ptasa: tasa },
    { plan, frecuencia, ndias, fechaEmision: femision, quoteMeta: {} },
  );

  // Vigencia y puestos de la cotización (el SP compara el plazo con el cotizado).
  const vigencia = resolveVigenciaEmision(cotizacion.vigencia, femision);
  payload.fdesde = vigencia.fdesde;
  payload.fhasta = vigencia.fhasta;
  // La suma asegurada la toma el SP de la cotización (vhofcert.mvalor).
  payload.msumaaseg = null;
  const puestos = Number(cotizacion.vehiculo?.puestos);
  if (Number.isFinite(puestos) && puestos > 0) payload.npuestos = puestos;

  const base = toLaMundialEmissionPayload(payload, { mprima: payload.mprima, mprimaext: primaUsd, ptasa: tasa });
  // Igual que policyService.createEmissionAutoViaNestApi: mprima 0, la prima la fija el SP (aquí, sopoltar).
  const body = {
    ...base,
    mprima: 0,
    mprimaext: primaUsd,
    ptasa: tasa,
    tasa,
    itipoEmi: 'NU',
    cproces: String(cotizacion.cproces),
    ccerti_cotizacion: Number(opcion.opcion),
    mprima_esperada: primaUsd,
  };

  return {
    payload,
    body,
    vigencia,
    metadata: { ...metadata, cproces: String(cotizacion.cproces), opcion: Number(opcion.opcion) },
  };
}

module.exports = { buildCotizacionEmission, buildCotizacionState, TOMADOR_CLIENT_KEYS, VEHICLE_CLIENT_KEYS };
