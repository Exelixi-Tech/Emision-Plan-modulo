/**
 * Flujo "Emitir RCV desde cotización" (SysIP → Nexus SSO con cotizacionID → Emisión → Pagos → emisión).
 *
 * Aislado del RCV de siempre: reutiliza sus piezas (mapper, validador, validación de placa, cobro del
 * recibo, anexo de conductor, correo) sin modificarlas. Nunca emite sin pago verificado.
 */
const nest = require('./nestApiClient');
const client = require('./rcvCotizacionClient');
const { resolveIngresoCajaAfterPayment } = require('./collectionAfterPayment');
const { validateEmissionPayload } = require('./policyValidator');
const { buildCotizacionEmission, buildCotizacionState } = require('./rcvCotizacionMapper');
const { _internal: { todayYmd } } = require('./policyMapper');
const lib = require('../lib/rcvCotizacion');

class CotizacionFlowError extends Error {
  constructor(code, message, httpStatus = 400, extra = {}) {
    super(message);
    this.name = 'CotizacionFlowError';
    this.code = code;
    this.httpStatus = httpStatus;
    Object.assign(this, extra);
  }
}

/** Mensajes claros para los errores del SP que nest-api devuelve como 400 con `code`. */
const SP_ERROR_MESSAGES = {
  COTIZACION_NO_EXISTE: 'La cotización ya no existe en SysIP. Verifica el número o genera una nueva cotización.',
  COTIZACION_EMITIDA: 'Esta cotización ya fue emitida; no se puede emitir dos veces.',
  COTIZACION_NO_COINCIDE: 'Los datos no coinciden con la cotización (plan, vehículo, vigencia o prima). Revisa la cotización en SysIP.',
};

/** Frecuencias que la emisión RCV acepta (policyValidator) y que tienen cuotas definidas. */
const FRECUENCIAS_PERMITIDAS = new Set(['A', 'S', 'C', 'T', 'M']);
const FRECUENCIA_ANUAL = { code: 'A', label: 'Anual', ndias: null };

function ramoDe(cotizacion) {
  const n = parseInt(String(cotizacion?.ramo ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : parseInt(process.env.LAMUNDIAL_RAMO || '18', 10);
}

/** Frecuencias del plan como en la emisión RCV normal (spBuscaFrecuenciaPlan vía nest-api). */
async function frecuenciasDelPlan(cotizacion) {
  try {
    const items = await nest.getValrepFrecuencias(cotizacion.plan?.codigo, ramoDe(cotizacion));
    const ok = items
      .map((i) => ({ code: lib.normalizeFrecuencia(i.code), label: String(i.label || i.code), ndias: i.ndias ?? null }))
      .filter((i) => FRECUENCIAS_PERMITIDAS.has(i.code));
    return ok.length > 0 ? ok : [FRECUENCIA_ANUAL];
  } catch (err) {
    console.warn(`[rcv-cotizacion] frecuencias plan=${cotizacion.plan?.codigo}: ${err.message}; solo anual`);
    return [FRECUENCIA_ANUAL];
  }
}

function vistaOpcion(o) {
  const r = lib.resumenOpcion(o);
  return {
    opcion: Number(o.opcion),
    primaUsd: r.annualUsd,
    rcvBasicoUsd: r.rcvBasicoUsd,
    coberturas: Array.isArray(o.coberturas) ? o.coberturas : [],
  };
}

/** Pantalla 1: cotización + si se puede emitir + opciones Solo RCV + frecuencias del plan. */
async function getVista(cproces) {
  const cotizacion = await client.getCotizacionAuto(cproces);
  const motivos = lib.motivosNoEmitible(cotizacion);
  const emitible = motivos.length === 0;
  let ptasa = null;
  if (emitible) {
    // Solo para mostrar Bs en pantalla; el monto definitivo lo calcula prepararPago.
    try {
      ptasa = await client.getTasaBcv(todayYmd());
    } catch (err) {
      console.warn(`[rcv-cotizacion] tasa BCV: ${err.message}`);
    }
  }
  return {
    cotizacion,
    emitible,
    motivos,
    opciones: lib.opcionesSoloRcv(cotizacion).map(vistaOpcion),
    frecuencias: emitible ? await frecuenciasDelPlan(cotizacion) : [],
    vigenciaEmision: lib.resolveVigenciaEmision(cotizacion.vigencia, todayYmd()),
    ptasa,
  };
}

function assertEmitible(cotizacion) {
  const motivos = lib.motivosNoEmitible(cotizacion);
  if (motivos.length > 0) {
    throw new CotizacionFlowError(
      'COTIZACION_NO_EMITIBLE',
      motivos.map((m) => m.mensaje).join(' '),
      409,
      { details: motivos },
    );
  }
}

function pickOpcion(cotizacion, opcion) {
  const opciones = lib.opcionesSoloRcv(cotizacion);
  if ((opcion == null || opcion === '') && opciones.length === 1) return opciones[0];
  const found = opciones.find((o) => Number(o.opcion) === Number(opcion));
  if (!found) {
    throw new CotizacionFlowError('COTIZACION_OPCION_INVALIDA', 'Elige una de las opciones Solo RCV de la cotización.', 400);
  }
  return found;
}

/**
 * Pantalla 3 → Pagos: valida de nuevo la cotización y la placa, toma la tasa del día, calcula el primer
 * recibo y firma el comprobante que Pagos devolverá al emitir.
 */
async function prepararPago(cproces, { opcion, frecuencia, vehicle, tomador } = {}) {
  const cotizacion = await client.getCotizacionAuto(cproces);
  assertEmitible(cotizacion);
  const opt = pickOpcion(cotizacion, opcion);
  const frecuencias = await frecuenciasDelPlan(cotizacion);
  const freq = lib.normalizeFrecuencia(frecuencia);
  const frec = frecuencias.find((f) => f.code === freq);
  if (!frec) {
    throw new CotizacionFlowError('FRECUENCIA_INVALIDA', 'La frecuencia elegida no está disponible para el plan de la cotización.', 400);
  }

  // Antes de cobrar: el SP rechaza la emisión sin profesión u actividad (99013) y el pago quedaría sin póliza.
  if (!lib.tomadorEsJuridico(cotizacion.tomador?.tipoDoc) && !lib.tieneProfesionOcupacion(tomador)) {
    throw new CotizacionFlowError(
      'PROFESION_REQUERIDA',
      'Indica la profesión y además la ocupación o la actividad económica del tomador antes de pagar.',
      400,
    );
  }

  if (vehicle?.placa) {
    try {
      await nest.validateEmissionAutoViaNestApi({
        plan: cotizacion.plan?.codigo,
        placa: String(vehicle.placa).toUpperCase().replace(/[^A-Z0-9]/g, ''),
        serial_carroceria: vehicle.serial,
        serial_motor: vehicle.serialMotor,
      });
    } catch (err) {
      if (err.code === 'PLATE_ALREADY_INSURED') {
        throw new CotizacionFlowError('LAMUNDIAL_PLATE_ALREADY_INSURED', err.message, 409);
      }
      if (err.code === 'INVALID_PLACA_FORMAT' || err.code === 'INVALID_SERIAL_FORMAT') {
        throw new CotizacionFlowError(err.code, err.message, 400);
      }
      throw new CotizacionFlowError('VALIDATE_EMISSION_ERROR', `No se pudo validar la placa: ${err.message}`, 502);
    }
  }

  const ptasa = await client.getTasaBcv(todayYmd());
  const { annualUsd, rcvBasicoUsd } = lib.resumenOpcion(opt);
  const montos = lib.computePrimerRecibo({ annualUsd, rcvBasicoUsd, frecuencia: freq, ptasa });
  const ticket = lib.signTicket({ cproces: cotizacion.cproces ?? cproces, opcion: opt.opcion, frecuencia: freq, primaUsd: annualUsd });
  if (!ticket) {
    throw new CotizacionFlowError('COTIZACION_TICKET_SIN_SECRETO', 'Falta configurar el secreto del flujo de cotización en el servidor de Emisión.', 500);
  }

  // Lo bloqueado por la cotización, ya en la forma del wizard (Pagos lo muestra y lo reenvía al emitir).
  const base = buildCotizacionState({ cotizacion, state: {}, frecuencia: freq, ndias: frec.ndias ?? null });
  const { tipoDoc, identificacion, nombre, apellido } = base.tomador;

  return {
    opcion: Number(opt.opcion),
    frecuencia: freq,
    frecuenciaLabel: frec.label,
    ndias: frec.ndias ?? null,
    montos,
    // Lo que Pagos usa para el monto (resolveFrecuenciaAmounts): anual USD/Bs, tasa y RCV completo en la 1ª cuota.
    quote: { mprima: montos.annualVes, mprimaext: annualUsd, ptasa, primaCuotaInicial: rcvBasicoUsd },
    bloqueados: {
      tomador: { tipoDoc, identificacion, nombre, apellido },
      vehicle: base.vehicle,
      selectedPlan: base.selectedPlan,
    },
    ticket,
  };
}

/**
 * Número de la cotización para emitir: el del token (si viene) y el del comprobante firmado deben
 * coincidir. Sin token con cotizacionID (Pagos no reenvía el de Emisión) vale el comprobante.
 */
function resolveCotizacionParaEmitir(tokenCproces, marker) {
  const ticket = lib.verifyTicket(marker?.ticket);
  if (!ticket) {
    throw new CotizacionFlowError(
      'COTIZACION_TICKET_INVALIDO',
      'La sesión de la cotización venció o no es válida. Vuelve a abrir la cotización desde SysIP.',
      403,
    );
  }
  if (tokenCproces && tokenCproces !== ticket.cproces) {
    throw new CotizacionFlowError('COTIZACION_NO_COINCIDE', 'La cotización de la sesión no es la que se preparó para el pago.', 403);
  }
  return ticket;
}

function mapEmitError(err, extra = {}) {
  if (err instanceof CotizacionFlowError) return err;
  const spCode = err?.raw?.code;
  if (spCode && SP_ERROR_MESSAGES[spCode]) {
    const detalle = typeof err.raw?.message === 'string' ? err.raw.message : err.message;
    return new CotizacionFlowError(spCode, `${SP_ERROR_MESSAGES[spCode]}${detalle ? ` Detalle: ${detalle}` : ''}`, 400, extra);
  }
  if (err?.code === 'LAMUNDIAL_PLATE_ALREADY_INSURED') {
    return new CotizacionFlowError(err.code, err.message, 409, extra);
  }
  if (err?.code === 'NEST_API_COUNTER_COLLISION') {
    return new CotizacionFlowError(err.code, err.message, 503, extra);
  }
  return new CotizacionFlowError(err?.code || 'NEST_API_EMISSION_ERROR', err?.message || 'Error emitiendo la póliza.', err?.httpStatus >= 400 && err?.httpStatus < 500 ? 400 : 502, extra);
}

function publicUrl(url) {
  if (!url) return url;
  const origin = String(process.env.NEST_PUBLIC_API_ORIGIN || process.env.PUBLIC_API_ORIGIN || '').trim().replace(/\/$/, '');
  if (!origin) return url;
  try {
    const parsed = new URL(url);
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return url;
    const prefix = String(process.env.NEST_PUBLIC_API_PREFIX || process.env.PUBLIC_API_PREFIX || '').trim().replace(/\/$/, '');
    return `${origin}${prefix}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * Emisión post-pago. `state` = el que Pagos manda a /policies/emit (con metadataCanal ya fusionada).
 * @returns resultado con la misma forma que policyService.quoteAndEmit (para la misma respuesta HTTP).
 */
async function emitirDesdeCotizacion({ tokenCproces, state, tokenMetadata }) {
  const marker = state?.rcv?.cotizacionRcv;
  const ticket = resolveCotizacionParaEmitir(tokenCproces, marker);

  // Sin pago verificado solo emite quien puede "emitir como pendiente" (misma regla que el RCV, con la
  // metadata del token). El cobro se omite y el recibo queda pendiente en Sis2000.
  const pendiente = state?.paymentVerified !== true;
  if (pendiente && !lib.puedeEmitirPendiente(tokenMetadata)) {
    throw new CotizacionFlowError('PAGO_REQUERIDO', 'El pago no está verificado; la póliza se emite solo después de confirmar el pago.', 402);
  }

  const frecuencia = lib.normalizeFrecuencia(state?.rcv?.frecuencia);
  if (frecuencia !== ticket.frecuencia) {
    throw new CotizacionFlowError('FRECUENCIA_NO_COINCIDE', 'La frecuencia de pago cambió después de preparar el cobro. Vuelve a Emisión.', 400);
  }

  const cotizacion = await client.getCotizacionAuto(ticket.cproces);
  assertEmitible(cotizacion);
  const opcion = pickOpcion(cotizacion, ticket.opcion);
  if (lib.round2(opcion.primaUsd) !== lib.round2(ticket.primaUsd)) {
    throw new CotizacionFlowError('COTIZACION_NO_COINCIDE', 'La prima de la cotización cambió después de preparar el cobro.', 409);
  }

  // Tasa del día desde el server (como el RCV de siempre, que recotiza al emitir); nunca la del navegador.
  const ptasa = await client.getTasaBcv(todayYmd());
  const { payload, body, metadata } = buildCotizacionEmission({
    cotizacion,
    opcion,
    state,
    frecuencia,
    ndias: state?.rcv?.ndias ?? null,
    ptasa,
  });

  const errors = validateEmissionPayload(payload);
  if (errors.length > 0) {
    throw new CotizacionFlowError('INVALID_PAYLOAD', `Validacion fallida: ${errors.join('; ')}`, 400, {
      details: errors,
      internalPolicyId: metadata.internalPolicyId,
    });
  }

  console.log(
    `[rcv-cotizacion][${new Date().toISOString()}] EMITIENDO cproces=${body.cproces} opcion=${body.ccerti_cotizacion} plan=${body.cplan} placa=${body.xplaca} mprima_esperada=${body.mprima_esperada} ifrecuencia=${body.ifrecuencia} internalId=${metadata.internalPolicyId}`,
  );

  let emission;
  try {
    emission = await nest.createEmissionAutoViaNestApi(body);
  } catch (err) {
    throw mapEmitError(err, { internalPolicyId: metadata.internalPolicyId });
  }

  const { annualUsd, rcvBasicoUsd } = lib.resumenOpcion(opcion);
  const montos = lib.computePrimerRecibo({ annualUsd, rcvBasicoUsd, frecuencia, ptasa });
  let url_ingreso_caja;
  if (emission.cnrecibo) {
    url_ingreso_caja = await resolveIngresoCajaAfterPayment(state, {
      cnrecibo: emission.cnrecibo,
      mpagoFallback: montos.primerVes,
      metadata,
    });
    if (metadata.collectionError) {
      console.error(`[rcv-cotizacion] collection/activate falló cnrecibo=${emission.cnrecibo}:`, metadata.collectionError);
    }
  }

  let url_conductor_habitual;
  if (body.conductor?.xrif_conductor) {
    try {
      url_conductor_habitual = publicUrl(await nest.generateConductorHabitualViaNestApi({
        poliza: emission.cnpoliza,
        certificado: '0',
        fechaEmision: body.femision,
        sucursal: 'CARACAS',
        intermediario: String(body.cproductor || '80080'),
        tomadorNombre: `${body.xnombre_tomador || ''} ${body.xapellido_tomador || ''}`.trim(),
        tomadorRif: String(body.xrif_tomador || ''),
        vigenciaDesde: body.fdesde,
        vigenciaHasta: body.fhasta,
        conductorNombre: `${body.conductor.xnombre_conductor} ${body.conductor.xapellido_conductor}`.trim(),
        conductorRif: String(body.conductor.xrif_conductor),
      }));
    } catch (err) {
      console.error('[rcv-cotizacion] anexo conductor habitual:', err.message);
      metadata.conductorPdfError = err.message;
    }
  }

  console.log(`[rcv-cotizacion][${new Date().toISOString()}] EMITIDA cproces=${body.cproces} cnpoliza=${emission.cnpoliza}`);

  if (body.xcorreo_tomador) {
    nest.sendPolicyEmailViaNestApi({
      to: body.xcorreo_tomador,
      name: `${body.xnombre_tomador || ''} ${body.xapellido_tomador || ''}`.trim() || undefined,
      cnpoliza: emission.cnpoliza,
      cnrecibo: emission.cnrecibo,
      fanopol: emission.fanopol,
      fmespol: emission.fmespol,
      urlpoliza: emission.urlpoliza,
      url_conductor_habitual,
      url_club_arys: emission.url_club_arys || undefined,
      url_ingreso_caja,
    }).catch((err) => console.warn(`[rcv-cotizacion] correo póliza ${emission.cnpoliza}:`, err.message || err));
  }

  return {
    internalPolicyId: metadata.internalPolicyId,
    cnpoliza: emission.cnpoliza,
    cnrecibo: emission.cnrecibo,
    urlpoliza: emission.urlpoliza,
    url_conductor_habitual,
    url_club_arys: emission.url_club_arys || undefined,
    url_ingreso_caja,
    ncuota: emission.ncuota,
    quote: { mprima: montos.annualVes, mprimaext: annualUsd, ptasa },
    emittedAt: new Date().toISOString(),
    metadata: { ...metadata, cotizacion: { cproces: body.cproces, opcion: body.ccerti_cotizacion }, montos },
  };
}

module.exports = {
  getVista,
  prepararPago,
  emitirDesdeCotizacion,
  resolveCotizacionParaEmitir,
  mapEmitError,
  CotizacionFlowError,
  SP_ERROR_MESSAGES,
};
