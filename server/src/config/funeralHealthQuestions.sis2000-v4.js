/**
 * Cuestionario alineado a Sis2000 QA — cproducto 57, cversion_matriz 4 (funerario).
 * Mantenimiento La Mundial: declaración de riesgo / sp_ma_obtener_preguntas_riesgo_producto.
 *
 * Rangos: 0–25 APROBAR · 26–39 REFERIR · 40+ RECHAZAR (maproductos_reglas_riesgo v4).
 */

const TIER = {
  TODOS: ['2', '3', '4', '5', '6', '7', '8', '9'],
};

/** @type {import('./funeralHealthQuestions').HealthQuestion[]} */
const SIS2000_V4_CATALOG = [
  {
    id: 'fuma',
    type: 'boolean',
    label: '¿Fuma o ha fumado en los últimos 12 meses?',
    description: 'Incluye cigarrillos, tabaco, puros o vapeo.',
    required: true,
    plans: TIER.TODOS,
    scoreIfTrue: 0,
    scoreIfFalse: 0,
  },
  {
    id: 'cigarrillosPorDia',
    type: 'select',
    label: '¿Cuántos cigarrillos se fuma al día?',
    required: true,
    plans: TIER.TODOS,
    showIf: { field: 'fuma', equals: true },
    options: [
      { value: 'Bajo', label: '1 a 5' },
      { value: 'Medio', label: '5 a 10' },
      { value: 'fumador violento', label: '10 a 15' },
      { value: 'Alto', label: 'Más de 20' },
    ],
    optionScores: {
      Bajo: 2,
      Medio: 5,
      'fumador violento': 15,
      Alto: 20,
    },
    optionActions: {
      Alto: 'reject',
    },
    blockReason:
      'Se han detectado varios factores de riesgo inhabilitantes, no es posible continuar con el proceso.',
  },
  {
    id: 'enfermedadCardiovascular',
    type: 'boolean',
    label: '¿Ha padecido enfermedades cardiovasculares?',
    required: true,
    plans: TIER.TODOS,
    scoreIfTrue: 0,
    scoreIfFalse: 0,
  },
  {
    id: 'indiqueEnfermedades',
    type: 'multi_select',
    label: 'Indique',
    description: 'Seleccione las condiciones que apliquen.',
    required: true,
    plans: TIER.TODOS,
    showIf: { field: 'enfermedadCardiovascular', equals: true },
    options: [
      { value: 'HIPCON', label: 'Hipertensión controlada' },
      { value: 'SI', label: 'Diabetes' },
      { value: 'inf', label: 'Infarto antiguo' },
      { value: 'diabe01', label: 'Diabetes controlada' },
    ],
    optionScores: {
      HIPCON: 8,
      SI: 12,
      inf: 10,
      diabe01: 15,
    },
  },
  {
    id: 'soyVidente',
    type: 'boolean',
    label: 'Soy vidente',
    required: true,
    plans: TIER.TODOS,
    scoreIfTrue: 5,
    scoreIfFalse: 0,
  },
  {
    id: 'aceptaTerminos',
    type: 'boolean',
    label: 'Acepto los términos y condiciones',
    description:
      'Declaro que la información suministrada es verídica y acepto las condiciones de la póliza.',
    required: true,
    plans: TIER.TODOS,
    scoreIfFalse: 0,
    blockIfFalse: true,
    blockReason: 'Debe aceptar los términos y condiciones.',
  },
];

module.exports = { SIS2000_V4_CATALOG, TIER };
