/**
 * Monitor de expedientes Marketplace (contrato v1, 7-nov-2026).
 *
 * Arma el campo opcional `expediente` que viaja dentro del registro que Emisión ya envía a Nexus
 * (POST /api/emisiones, ver nexusEmisionFeed.js). Solo arma datos:
 *   - no hace I/O ni llamadas de red;
 *   - nunca lanza: si algo falla devuelve undefined y el registro sale igual que siempre;
 *   - no loguea datos personales.
 *
 * Apagado por defecto: solo se envía con EXPEDIENTES_ENABLED=true.
 */
const { resolveTitularCedula, buildNomenclatura } = require('./expedienteArchive');

/** Productos del monitor (los requisitos de cada uno los define Nexus). */
const PRODUCTOS = new Set(['rcv', 'personas', 'patrimonial']);

/**
 * Claves de state.documents: las mismas que ve la mesa técnica (EmisionRevisionPanel) y los
 * mismos nombres de archivo que usa OCR al archivar (lib/expedienteFs.js DOC_FILE_NAMES).
 */
const SLOTS_WIZARD = [
  'cedula',
  'cedula_titular',
  'cedula_beneficiario',
  'licencia',
  'certificado',
  'rif',
  'pasaporte',
  'factura',
];

function isEnabled() {
  return String(process.env.EXPEDIENTES_ENABLED || '').trim().toLowerCase() === 'true';
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Mismo saneo de nombre de carpeta que OCR (expedienteFs.sanitizeFolderName). */
function sanitizeFolderName(raw, fallback) {
  const cleaned = String(raw || '')
    .normalize('NFC')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || fallback;
}

/** Documento sin separadores: V/E/J/G/C solo dígitos; pasaporte alfanumérico. */
function cleanDocumento(tipoDoc, identificacion) {
  const raw = String(identificacion ?? '').trim();
  if (!raw) return null;
  const tipo = String(tipoDoc ?? '').trim().toUpperCase();
  if (tipo === 'P') return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase() || null;
  return raw.replace(/\D/g, '') || null;
}

function persona(p) {
  if (!p || typeof p !== 'object') return null;
  const tipoDoc = str(p.tipoDoc)?.toUpperCase() ?? null;
  return {
    tipoDoc,
    documento: cleanDocumento(tipoDoc, p.identificacion),
    nombre: str(p.nombre ?? p.razonSocial),
    apellido: str(p.apellido),
  };
}

/** Titular: personas = 1er asegurado; RCV = asegurado si es distinto del tomador. */
function resolveTitular(state, producto) {
  const funeral = state?.funeral || {};
  const aseg0 = Array.isArray(funeral.asegurados) ? funeral.asegurados[0] : null;
  if (producto === 'personas' && aseg0?.identificacion) return aseg0;
  if (state?.sameInsured === false && state?.asegurado?.identificacion) return state.asegurado;
  if (aseg0?.identificacion) return aseg0;
  return state?.tomador || {};
}

/**
 * Pago de la tarjeta en farmacia (bfactura / skipPayment con nfactura): la póliza se cobró en caja.
 * Mismo criterio que collectionAfterPayment.isTarjetaFarmaciaPayment.
 */
function isTarjetaFarmacia(state) {
  try {
    // eslint-disable-next-line global-require
    const { isTarjetaFarmaciaPayment } = require('./collectionAfterPayment');
    return typeof isTarjetaFarmaciaPayment === 'function'
      && isTarjetaFarmaciaPayment(state, state?.paymentCapture || {});
  } catch {
    return false;
  }
}

/**
 * pagada   = pago verificado en Pagos (state.paymentVerified) o tarjeta pagada en farmacia.
 * pendiente = se emitió sin pago verificado ("Emitir como pendiente"): el recibo no se cobró.
 * Es la misma señal con la que la emisión decide si activa el recibo (collectionAfterPayment).
 */
function resolveEstadoPago(state) {
  if (state?.paymentVerified === true) return 'pagada';
  if (isTarjetaFarmacia(state)) return 'pagada';
  return 'pendiente';
}

/** Área y vendedor desde la metadata SSO (ya fusionada con el JWT verificado). */
function resolveActor(state, nexusMetadata) {
  const sources = [
    state?.metadataCanal && typeof state.metadataCanal === 'object' ? state.metadataCanal : {},
    nexusMetadata && typeof nexusMetadata === 'object' ? nexusMetadata : {},
    state || {},
  ];
  const pick = (...keys) => {
    for (const key of keys) {
      for (const src of sources) {
        const v = str(src?.[key]);
        if (v != null) return v;
      }
    }
    return null;
  };
  const centidad = pick('centidad');
  return {
    centidad: centidad ? centidad.toUpperCase() : null,
    citem: pick('citem'),
    cgestor: pick('cgestor', 'cgestor_in'),
    ccanalalt: pick('ccanalalt', 'ccanalalt_in'),
    cusuario: pick('cusuario'),
    xlogin: pick('xlogin', 'login'),
    cproductor: pick('cproductor'),
    cproducto: pick('cproducto'),
  };
}

/** Carpeta relativa del expediente en el servidor OCR: {empresa}/{cédula}/{recibo-aa-mes-póliza}. */
function resolveCarpetaExpediente(state, emission, empresaId, empresaNombre) {
  const cedula = String(resolveTitularCedula(state) || '').slice(0, 12);
  if (!cedula) return null;
  const id = str(empresaId);
  const empresa = sanitizeFolderName(
    empresaNombre || process.env.EXPEDIENTE_EMPRESA_FALLBACK,
    id ? `empresa-${id}` : 'empresa-sin-nombre',
  );
  const nomenclatura = sanitizeFolderName(buildNomenclatura(emission), 'sin-poliza');
  return `${empresa}/${cedula}/${nomenclatura}`;
}

function extensionOf(url) {
  try {
    const pathname = new URL(String(url), 'http://local').pathname;
    const m = /\.[A-Za-z0-9]{1,5}$/.exec(pathname);
    return m ? m[0].toLowerCase() : '';
  } catch {
    return '';
  }
}

/**
 * Documentos recibidos o faltantes según el wizard: misma fuente (state.documents[k].file.url)
 * y mismas claves que la mesa técnica. Siempre trae las 8 claves.
 *   recibido: true|false
 *   ref: ruta relativa (EXPEDIENTES_ROOT) donde OCR deja el archivo al archivar:
 *        {carpetaExpediente}/{clave}{ext}; sin carpeta, la URL del wizard.
 *   url: la URL del wizard (/files/...), la misma que resuelve la mesa técnica.
 */
function resolveDocumentos(state, carpeta) {
  const docs = state?.documents && typeof state.documents === 'object' ? state.documents : {};
  const out = {};
  for (const slot of SLOTS_WIZARD) {
    const url = str(docs?.[slot]?.file?.url);
    out[slot] = url
      ? { recibido: true, ref: carpeta ? `${carpeta}/${slot}${extensionOf(url)}` : url, url }
      : { recibido: false };
  }
  return out;
}

/** cramo: el que trae la ruta; en RCV, el mismo que usa el mapper (18 nacional, 28 binacional). */
function resolveCramo(ctx, state, producto) {
  const fromCtx = num(ctx?.cramo);
  if (fromCtx != null) return fromCtx;
  if (producto === 'rcv') {
    try {
      // eslint-disable-next-line global-require
      const { resolveRcvCramo } = require('./policyMapper');
      return num(resolveRcvCramo(state.vehicle || {}, state.metadataCanal || {}));
    } catch {
      return null;
    }
  }
  return num(state?.metadataCanal?.cramo ?? state?.selectedPlan?.cramo);
}

function resolveVehiculo(state) {
  const v = state?.vehicle;
  if (!v || typeof v !== 'object') return null;
  return {
    placa: str(v.placa)?.toUpperCase() ?? null,
    marca: str(v.marca),
    modelo: str(v.modelo),
    version: str(v.version),
    anio: num(v.año ?? v.ano ?? v.anio),
    serial: str(v.serial),
    serialMotor: str(v.serialMotor),
    color: str(v.color),
  };
}

/**
 * @param {{
 *   producto: 'rcv'|'personas'|'patrimonial',
 *   cramo?: number|string,
 *   state: object,
 *   emission: object,
 *   nexusMetadata?: object,
 *   empresaId?: number|string,
 *   empresaNombre?: string,
 *   planNombre?: string,
 *   frecuencia?: string,
 * }} ctx
 * @returns {object|undefined}  undefined si está apagado o si no se pudo armar.
 */
function buildExpedienteFeed(ctx) {
  if (!isEnabled()) return undefined;
  try {
    const state = ctx?.state && typeof ctx.state === 'object' ? ctx.state : {};
    const emission = ctx?.emission && typeof ctx.emission === 'object' ? ctx.emission : {};
    const producto = PRODUCTOS.has(ctx?.producto) ? ctx.producto : 'personas';
    const actor = resolveActor(state, ctx?.nexusMetadata);

    const tomador = state.tomador || {};
    const titular = resolveTitular(state, producto);
    const aseguradoBase = persona(titular) || {};
    const asegurado = {
      ...aseguradoBase,
      // Contacto para los recordatorios: el del titular o, si no lo trae, el del tomador.
      email: str(titular.email) || str(tomador.email),
      telefono: str(titular.telefono) || str(tomador.telefono),
    };

    const carpetaExpediente = resolveCarpetaExpediente(state, emission, ctx?.empresaId, ctx?.empresaNombre);
    const quote = emission.quote || {};
    const plan = state.selectedPlan || {};

    return {
      version: 1,
      ...actor,
      producto,
      cramo: resolveCramo(ctx, state, producto),
      estadoPago: resolveEstadoPago(state),
      asegurado,
      snapshot: {
        tomador: persona(tomador),
        asegurado: aseguradoBase,
        vehiculo: producto === 'rcv' ? resolveVehiculo(state) : null,
        plan: str(plan.cplan) || str(ctx?.planNombre),
        planNombre: str(plan.name) || str(ctx?.planNombre),
        frecuencia: str(ctx?.frecuencia),
        fdesde: str(emission.fdesde),
        fhasta: str(emission.fhasta),
        prima: num(quote.mprimaext),
        primaBs: num(quote.mprima),
        tasa: num(quote.ptasa),
        cnpoliza: str(emission.cnpoliza),
        cnrecibo: str(emission.cnrecibo),
      },
      documentos: resolveDocumentos(state, carpetaExpediente),
      // false = el state de la emisión no trajo documents (p. ej. personas desde Pagos): los
      // "recibido: false" no significan faltante; cruzar con la mesa técnica u OCR.
      documentosEnWizard: Boolean(state.documents && typeof state.documents === 'object'),
      carpetaExpediente,
    };
  } catch (err) {
    // Solo el tipo de error: el mensaje podría arrastrar datos del state.
    console.warn('[expedienteFeed] no se pudo armar el campo expediente:', err?.name || 'Error');
    return undefined;
  }
}

module.exports = {
  buildExpedienteFeed,
  SLOTS_WIZARD,
  _internal: {
    isEnabled,
    resolveEstadoPago,
    resolveActor,
    resolveCarpetaExpediente,
    resolveDocumentos,
    resolveTitular,
    sanitizeFolderName,
    cleanDocumento,
  },
};
