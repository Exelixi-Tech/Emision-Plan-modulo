/**
 * Cuestionario de emisión web según el ramo Sis2000 que se consulta.
 * Vida = 1 · Accidentes personales = 5 · Funerario = 9 y producto 57 (cramo 45).
 * El detalle "Especifique" aparece cuando la respuesta abre esa pregunta.
 */

const ALL = ['*'];

function yesNo(id, label, detail) {
  const question = {
    id,
    type: 'boolean',
    label,
    required: true,
    plans: ALL,
    scoreIfTrue: 0,
    scoreIfFalse: 0,
  };
  if (!detail) return [question];
  return [
    question,
    {
      id: detail.id,
      type: 'text',
      label: detail.label,
      description: detail.description,
      required: detail.required === true,
      plans: ALL,
      showIf: { field: id, equals: detail.whenYes !== false },
    },
  ];
}

function select(id, label, options) {
  return {
    id,
    type: 'select',
    label,
    required: true,
    plans: ALL,
    options,
    optionScores: {},
  };
}

const AP = [
  select('manoDominante', '¿Cuál es su mano dominante?', [
    { value: 'diestro', label: 'Diestro (mano derecha)' },
    { value: 'zurdo', label: 'Zurdo (mano izquierda)' },
    { value: 'ambidiestro', label: 'Ambidiestro (ambas manos)' },
  ]),
  {
    id: 'ocupacion',
    type: 'text',
    label: 'Ocupación u oficio principal',
    required: true,
    plans: ALL,
  },
  ...yesNo(
    'laboresRiesgo',
    '¿Realiza actividades laborales en alturas (mayores a 1.5 metros), con alta tensión eléctrica, manejo de maquinaria pesada, explosivos, químicos o manejo de carga?',
  ),
  ...yesNo(
    'deporteRiesgo',
    '¿Practica deportes de alto riesgo o realiza actividades de aviación no comercial?',
    { id: 'deporteRiesgoDetalle', label: 'Especifique la actividad', required: true },
  ),
  ...yesNo(
    'defectoFisico',
    '¿Presenta alguna amputación, deformidad, limitación motora o defecto físico congénito o adquirido?',
    { id: 'defectoFisicoDetalle', label: 'Especifique', required: true },
  ),
  ...yesNo(
    'condicionMedica',
    '¿Ha padecido, padece o ha sido diagnosticado con diabetes, afecciones del sistema nervioso, osteomuscular o de los sentidos, del sistema cardiovascular o coagulación, o del sistema respiratorio (asma, EPOC o enfisema)?',
    {
      id: 'condicionMedicaDetalle',
      label: 'Especifique',
      description: 'Diabetes, convulsiones, epilepsia, parálisis, vértigos, columna, hipertensión, infarto, trombosis, asma, EPOC u otras.',
      required: true,
    },
  ),
];

const VIDA = [
  ...yesNo(
    'habitos',
    '¿Fuma, consume bebidas alcohólicas, o utiliza o ha utilizado drogas, estupefacientes o medicamentos no recetados?',
    { id: 'habitosDetalle', label: 'Especifique', required: true },
  ),
  ...yesNo(
    'deporteRiesgo',
    '¿Practica habitualmente deportes de alto riesgo o aviación no comercial?',
    { id: 'deporteRiesgoDetalle', label: 'Especifique', required: true },
  ),
  ...yesNo(
    'pesoInvoluntario',
    '¿Ha aumentado o disminuido más de 5 kg involuntariamente en los últimos 3 años?',
    { id: 'pesoInvoluntarioDetalle', label: 'Indique los kg variados y la causa', required: true },
  ),
  ...yesNo(
    'cardiovascular',
    'Sistema cardiovascular: ¿padece o ha padecido de tensión alta, infartos, soplos, afecciones en venas o arterias, o trastornos o tumores en la sangre?',
    { id: 'cardiovascularDetalle', label: 'Especifique', required: true },
  ),
  ...yesNo(
    'respiratorioDigestivo',
    'Sistema respiratorio y digestivo: ¿ha sido diagnosticado o tratado por asma, tos crónica, neumonía, tuberculosis, úlceras, gastritis severa o enfermedades del hígado, vesícula, hemorroides, páncreas o colon?',
    { id: 'respiratorioDigestivoDetalle', label: 'Especifique', required: true },
  ),
  ...yesNo(
    'endocrinoRenal',
    'Sistema endocrino y renal: ¿sufre de diabetes, obesidad, alteraciones de la tiroides, enfermedad renal, vejiga o próstata?',
  ),
  ...yesNo(
    'nerviosoSentidos',
    'Sistema nervioso y sentidos: ¿presenta o ha tenido migrañas persistentes, dolores de columna o espalda, convulsiones, vértigos, parálisis o defectos de vista u oído?',
    { id: 'nerviosoSentidosDetalle', label: 'Especifique', required: true },
  ),
  ...yesNo(
    'oncologico',
    '¿Ha sido diagnosticado, tratado o se encuentra en control por quistes, tumores, neoplasias o algún tipo de cáncer?',
    { id: 'oncologicoDetalle', label: 'Especifique', required: true },
  ),
  ...yesNo(
    'quirurgico',
    '¿Ha tenido accidentes, cirugías, hospitalizaciones, transfusiones, posee tratamiento actual o tiene prevista alguna intervención?',
    { id: 'quirurgicoDetalle', label: 'Especifique', required: true },
  ),
  ...yesNo(
    'defectoFisico',
    '¿Presenta alguna deformidad, amputación, defecto físico, o afección congénita o adquirida?',
    { id: 'defectoFisicoDetalle', label: 'Especifique', required: true },
  ),
  ...yesNo(
    'embarazo',
    'Si aplica: ¿existe sospecha o confirmación de embarazo actual?',
  ),
  ...yesNo(
    'ginecologico',
    '¿Presenta padecimientos ginecológicos o de glándulas mamarias?',
    { id: 'ginecologicoDetalle', label: 'Especifique', required: true },
  ),
  ...yesNo(
    'otraCondicion',
    '¿Padece, ha padecido o ha sido diagnosticado de alguna otra enfermedad, síntoma, lesión o anomalía que no se haya nombrado, o está en proceso de diagnóstico?',
    { id: 'otraCondicionDetalle', label: 'Especifique', required: true },
  ),
];

const FUNERARIO = [
  ...yesNo(
    'buenEstadoSalud',
    '¿Se encuentra actualmente en buen estado de salud?',
    {
      id: 'buenEstadoSaludDetalle',
      label: 'Especifique',
      whenYes: false,
      required: false,
    },
  ),
  ...yesNo(
    'patologiaGrave',
    '¿Ha padecido, padece o ha sido diagnosticado con patologías coronarias o cardíacas, cáncer, enfermedad renal o hepática crónica, o alguna condición médica grave o terminal?',
    { id: 'patologiaGraveDetalle', label: 'Especifique', required: true },
  ),
];

/**
 * Ponderación inicial Vida/AP (puntos si responde "Sí"), sobre rangos de scoring
 * 0–25 emitir · 26–39 mesa técnica · 40+ rechazo. Ajustable en el parametrizador.
 * Debe coincidir con frontend/src/config/cuestionario-ramos.json.
 */
const DEFAULT_SCORES = {
  vida: {
    habitos: 10,
    deporteRiesgo: 15,
    pesoInvoluntario: 10,
    cardiovascular: 26,
    respiratorioDigestivo: 15,
    endocrinoRenal: 15,
    nerviosoSentidos: 10,
    oncologico: 30,
    quirurgico: 10,
    defectoFisico: 10,
    embarazo: 26,
    ginecologico: 10,
    otraCondicion: 15
  },
  ap: {
    laboresRiesgo: 26,
    deporteRiesgo: 26,
    defectoFisico: 20,
    condicionMedica: 20
  }
};

function applyDefaultScores(list, scores) {
  for (const q of list) {
    if (scores[q.id] != null) q.scoreIfTrue = scores[q.id];
  }
}
applyDefaultScores(VIDA, DEFAULT_SCORES.vida);
applyDefaultScores(AP, DEFAULT_SCORES.ap);

/**
 * @param {unknown} cramo
 * @returns {{ kind: 'ap'|'vida'|'funerario', questions: object[] } | null}
 */
function storedRamoKey(cramo) {
  const n = Number(cramo);
  if (n === 45 || n === 9) return '9';
  if (n === 1 || n === 5 || n === 7) return String(n);
  return '';
}

/**
 * Reglas del semáforo del ramo (product_config.healthScoringRulesByRamo) o `null`
 * para usar las generales (healthScoringRules).
 */
function scoringRulesStoredForRamo(cfg, cramo) {
  const key = storedRamoKey(cramo);
  const by = cfg?.healthScoringRulesByRamo;
  if (!key || !by || typeof by !== 'object' || Array.isArray(by)) return null;
  const rules = by[key];
  return rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : null;
}

/**
 * Lista guardada en product_config.healthQuestionsByRamo.
 * `null` si ese ramo no está en la base (se usa el catálogo de código).
 * @returns {object[] | null}
 */
function questionsStoredForRamo(cfg, cramo) {
  const key = storedRamoKey(cramo);
  const by = cfg?.healthQuestionsByRamo;
  if (!key || !by || typeof by !== 'object' || Array.isArray(by)) return null;
  if (!Object.prototype.hasOwnProperty.call(by, key)) return null;
  const list = Array.isArray(by[key]) ? by[key] : null;
  if (list && list.length > 0) return list;
  return null;
}

function catalogForConsultedRamo(cramo) {
  const n = Number(cramo);
  if (n === 5) return { kind: 'ap', questions: AP };
  if (n === 1) return { kind: 'vida', questions: VIDA };
  if (n === 9 || n === 45) return { kind: 'funerario', questions: FUNERARIO };
  return null;
}

/** Ramo con el que se guarda cada cuestionario en product_config.healthQuestionsByRamo. */
const RAMO_BY_KIND = { vida: 1, ap: 5, funerario: 9, salud: 7 };

/**
 * @param {string | undefined} raw lista separada por comas (.env)
 * @param {string} fallback
 * @returns {Set<string>}
 */
function productosFromEnv(raw, fallback) {
  return new Set(
    String(raw ?? fallback)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Cuestionario según el producto Sis2000 que manda el SSO.
 * Vida 76 · AP 78 y 79 · Funerario 57 (configurable por .env).
 * @param {unknown} cproducto
 * @returns {{ kind: 'ap'|'vida'|'funerario', questions: object[], cramo: number } | null}
 */
function catalogForProducto(cproducto) {
  const prod = String(cproducto ?? '').trim();
  if (!prod) return null;
  const env = process.env;
  if (productosFromEnv(env.LAMUNDIAL_PRODUCTOS_FUNERARIO, env.LAMUNDIAL_PRODUCTO_FUNERARIO || '57').has(prod)) {
    return { kind: 'funerario', questions: FUNERARIO, cramo: RAMO_BY_KIND.funerario };
  }
  if (productosFromEnv(env.LAMUNDIAL_PRODUCTOS_VIDA, '76').has(prod)) {
    return { kind: 'vida', questions: VIDA, cramo: RAMO_BY_KIND.vida };
  }
  if (productosFromEnv(env.LAMUNDIAL_PRODUCTOS_AP, '78,79').has(prod)) {
    return { kind: 'ap', questions: AP, cramo: RAMO_BY_KIND.ap };
  }
  // Salud (ramo 7): sin cuestionario de fábrica; solo el que se configure en el parametrizador.
  if (productosFromEnv(env.LAMUNDIAL_PRODUCTOS_SALUD, '14,15').has(prod)) {
    return { kind: 'salud', questions: [], cramo: RAMO_BY_KIND.salud };
  }
  return null;
}

const PRODUCT_LABELS = { funerario: 'Funerario', vida: 'Vida', ap: 'Accidentes Personales' };

/**
 * Nombre del producto para los correos: funerario/vida/AP por cproducto;
 * otro producto usa el xproducto del SSO. Sin dato: undefined (plantilla = Funerario).
 * @param {{ cproducto?: unknown, xproducto?: unknown }} meta
 * @returns {string | undefined}
 */
function productLabelFromMeta(meta) {
  const byProd = catalogForProducto(meta?.cproducto);
  if (byProd && PRODUCT_LABELS[byProd.kind]) return PRODUCT_LABELS[byProd.kind];
  const x = String(meta?.xproducto ?? '').trim();
  return x || undefined;
}

module.exports = {
  catalogForConsultedRamo,
  catalogForProducto,
  productLabelFromMeta,
  questionsStoredForRamo,
  scoringRulesStoredForRamo,
  FUNERARIO,
};
