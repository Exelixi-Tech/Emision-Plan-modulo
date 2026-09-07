/**
 * Archiva el expediente OCR al emitir (RCV y funerario).
 * Fail-open: un error de disco/OCR no debe tumbar la emisión.
 */
const axios = require('axios');

const DOC_KEYS = [
  'cedula',
  'cedula_titular',
  'cedula_beneficiario',
  'licencia',
  'certificado',
  'rif',
  'pasaporte',
];

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

/**
 * Cédula del titular: RCV (asegurado si es distinto) o funerario (1er asegurado).
 * @param {object} state
 * @returns {string}
 */
function resolveTitularCedula(state) {
  const funeral = state?.funeral || {};
  const aseg0 = Array.isArray(funeral.asegurados) ? funeral.asegurados[0] : null;
  if (aseg0?.identificacion) return onlyDigits(aseg0.identificacion);
  if (state?.sameInsured === false && state?.asegurado?.identificacion) {
    return onlyDigits(state.asegurado.identificacion);
  }
  return onlyDigits(state?.tomador?.identificacion);
}

/**
 * Nomenclatura recibo-aa-mes-poliza (ej. 2321234-25-1-1100015737).
 * @param {{ cnrecibo?: unknown, cnpoliza?: unknown, fanopol?: unknown, fmespol?: unknown }} emission
 * @returns {string}
 */
function buildNomenclatura(emission) {
  const recibo = onlyDigits(emission?.cnrecibo);
  const poliza = onlyDigits(emission?.cnpoliza);
  const now = new Date();
  const year = Number(emission?.fanopol);
  const month = Number(emission?.fmespol);
  const yy = Number.isFinite(year) && year > 0
    ? String(year).slice(-2)
    : String(now.getFullYear()).slice(-2);
  const mes = Number.isFinite(month) && month > 0
    ? String(month)
    : String(now.getMonth() + 1);
  return [recibo || 'sRecibo', yy, mes, poliza || 'sPoliza'].join('-');
}

/**
 * @param {object} documents
 * @returns {Array<{ url: string, docType: string, name?: string }>}
 */
function filesFromDocuments(documents) {
  if (!documents || typeof documents !== 'object') return [];
  const out = [];
  for (const key of DOC_KEYS) {
    const url = documents[key]?.file?.url;
    if (!url) continue;
    out.push({
      url,
      docType: key,
      name: documents[key]?.file?.name,
    });
  }
  return out;
}

/**
 * Llama a OCR para mover los documentos a {empresa}/{cedula}/{nomenclatura}/.
 * Nunca lanza: solo loguea.
 *
 * @param {{
 *   state: object,
 *   emission: object,
 *   empresaNombre?: string,
 *   authToken?: string,
 * }} args
 */
async function archiveExpedienteAfterEmit(args) {
  const ocrBase = String(process.env.OCR_API_URL || 'http://127.0.0.1:4001').replace(/\/$/, '');
  const cedula = resolveTitularCedula(args.state);
  const nomenclatura = buildNomenclatura(args.emission);
  const files = filesFromDocuments(args.state?.documents);
  const empresaNombre = String(args.empresaNombre || '').trim();

  if (!cedula) {
    console.warn('[expediente] emit sin cédula de titular — no se archiva');
    return;
  }
  if (files.length === 0) {
    console.warn(`[expediente] emit ${nomenclatura} sin archivos en wizard — se intenta pendiente`);
  }

  const headers = { 'Content-Type': 'application/json' };
  if (args.authToken) headers.Authorization = `Bearer ${args.authToken}`;
  const internalKey = process.env.EXPEDIENTE_INTERNAL_KEY || '';
  if (internalKey) headers['x-expediente-key'] = internalKey;

  try {
    const res = await axios.post(
      `${ocrBase}/api/documents/commit-expediente`,
      {
        empresaNombre,
        cedula,
        nomenclatura,
        cnrecibo: args.emission?.cnrecibo,
        cnpoliza: args.emission?.cnpoliza,
        fanopol: args.emission?.fanopol,
        fmespol: args.emission?.fmespol,
        files,
      },
      { headers, timeout: 15000, validateStatus: () => true },
    );
    if (res.status >= 200 && res.status < 300 && res.data?.success) {
      console.log(
        `[expediente] archivado ${empresaNombre || '?'} / ${cedula} / ${nomenclatura} files=${(res.data.saved || []).length}`,
      );
      return;
    }
    console.warn(
      `[expediente] OCR commit ${res.status}:`,
      res.data?.message || res.data?.code || 'sin detalle',
    );
  } catch (err) {
    console.warn('[expediente] no se pudo archivar:', err.message || err);
  }
}

module.exports = {
  resolveTitularCedula,
  buildNomenclatura,
  filesFromDocuments,
  archiveExpedienteAfterEmit,
};
