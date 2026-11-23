/**
 * Datos de PRUEBA del modo marca neutra (MarketPlace Exélixi sin La Mundial).
 *
 * Planes, cotizaciones, frecuencias y pólizas fijas, con nombres neutros y montos en USD
 * con tasa fija. Nada sale de aquí hacia nest-api ni Sis2000. Las pólizas llevan el
 * prefijo PRUEBA- (nunca LM-) y no tienen PDF.
 */

/** Tasa Bs/USD fija de la simulación. */
const TASA_PRUEBA = 100;

const PLANES_RCV_PRUEBA = [
  {
    cplan: 'PRUEBA-RCV-BAS',
    xplan: 'Plan Prueba RCV Básico',
    primaUsd: 30,
    sumaCosasUsd: 1500,
    sumaPersonasUsd: 2000,
  },
  {
    cplan: 'PRUEBA-RCV-PLUS',
    xplan: 'Plan Prueba RCV Plus',
    primaUsd: 55,
    sumaCosasUsd: 3000,
    sumaPersonasUsd: 4000,
  },
];

const PLAN_FUNERARIO_PRUEBA = {
  cplan: 'PRUEBA-FUN',
  xplan: 'Plan Prueba Funerario',
  primaTitularUsd: 60,
  primaDependienteUsd: 30,
  sumaUsd: 2000,
};

const PARENTESCOS_PRUEBA = [
  { cparen: 1, xparentesco: 'TITULAR', min_edad: 18, max_edad: 75 },
  { cparen: 2, xparentesco: 'CONYUGE', min_edad: 18, max_edad: 75 },
  { cparen: 3, xparentesco: 'HIJO(A)', min_edad: 0, max_edad: 25 },
];

/** Anual y fraccionadas: Pagos cobra la 1.ª cuota (simulada) y domicilia el resto (simulado). */
const FRECUENCIAS_PRUEBA = [
  { code: 'A', label: 'Anual', ndias: 365 },
  { code: 'S', label: 'Semestral', ndias: 180 },
  { code: 'T', label: 'Trimestral', ndias: 90 },
  { code: 'M', label: 'Mensual', ndias: 30 },
];

const CUOTAS_POR_FRECUENCIA = { A: 1, S: 2, T: 4, M: 12 };

/** Código de frecuencia válido de la simulación (por defecto A). */
function frecuenciaPrueba(code) {
  const c = String(code ?? 'A').trim().toUpperCase().charAt(0);
  return CUOTAS_POR_FRECUENCIA[c] ? c : 'A';
}

/** Vigencias de placa extranjera (mismo formato que mavigencias_PR). */
const VIGENCIAS_PRUEBA = [
  { cvigencia: 1, xvigencia: '1 MES', imedida_tiempo: 'M', ntiempo: 1, itipovalor: 'P', nvalor: 0.2 },
  { cvigencia: 2, xvigencia: '3 MESES', imedida_tiempo: 'M', ntiempo: 3, itipovalor: 'P', nvalor: 0.4 },
  { cvigencia: 3, xvigencia: '12 MESES', imedida_tiempo: 'M', ntiempo: 12, itipovalor: 'P', nvalor: 1 },
];

function redondear(n) {
  return Math.round(Number(n) * 100) / 100;
}

function aVes(usd) {
  return redondear(usd * TASA_PRUEBA);
}

/** Planes RCV de prueba con la forma de /catalogo/planes (PlanRcv). */
function planesRcvPrueba() {
  return PLANES_RCV_PRUEBA.map((p) => ({
    cplan: p.cplan,
    xplan: p.xplan,
    xplan_c: p.xplan,
    cramo: 18,
  }));
}

function planRcvPorCodigo(cplan) {
  const code = String(cplan ?? '').trim().toUpperCase();
  return PLANES_RCV_PRUEBA.find((p) => p.cplan === code) ?? PLANES_RCV_PRUEBA[0];
}

/**
 * Cotización RCV de prueba con la forma de /policies/quote.
 * Placa extranjera: prorratea por el % de la vigencia elegida (como Sis2000).
 */
function cotizacionRcvPrueba(state = {}, plan) {
  const p = planRcvPorCodigo(plan || state?.selectedPlan?.cplan);
  const nvalor = Number(state?.rcv?.vigenciaExt?.nvalor);
  const factor = state?.vehicle?.tipoPlaca === 'extranjera' && nvalor > 0 && nvalor <= 1 ? nvalor : 1;
  const primaUsd = redondear(p.primaUsd * factor);
  const cosas = redondear(primaUsd * 0.4);
  const personas = redondear(primaUsd - cosas);
  const v = state?.vehicle || {};
  const etiqueta = [v.marca, v.modelo].map((s) => String(s ?? '').trim()).filter(Boolean).join(' / ');
  return {
    mprima: aVes(primaUsd),
    mprimaext: primaUsd,
    ptasa: TASA_PRUEBA,
    coberturas: [
      { ccobertura: 1, name: 'Daños a cosas (prueba)', prima: cosas, sumaAsegurada: p.sumaCosasUsd },
      { ccobertura: 2, name: 'Daños a personas (prueba)', prima: personas, sumaAsegurada: p.sumaPersonasUsd },
    ],
    primaCuotaInicial: 0,
    metadata: {
      simulacion: true,
      marca: 'neutra',
      quoteSource: 'simulacion-marca-neutra',
      ...(etiqueta ? { vehicleLabel: etiqueta } : {}),
      vehicleFallback: false,
      referenceSuma: p.sumaCosasUsd + p.sumaPersonasUsd,
      sumaAsegurada: p.sumaCosasUsd + p.sumaPersonasUsd,
    },
  };
}

/** Planes de personas de prueba con la forma de /personas/planes (PlanPer). */
function planesPersonasPrueba(cramo) {
  const ramo = Number(cramo);
  return [
    {
      cplan: PLAN_FUNERARIO_PRUEBA.cplan,
      xplan: PLAN_FUNERARIO_PRUEBA.xplan,
      cramo: Number.isFinite(ramo) && ramo > 0 ? ramo : 9,
      nmax_dep: 4,
      maxAsegurados: 5,
      parentescos: PARENTESCOS_PRUEBA.map((x) => ({ ...x })),
    },
  ];
}

/** Cotización de personas de prueba: titular + dependientes, en USD con tasa fija. */
function cotizacionPersonasPrueba(nAsegurados = 1) {
  const n = Math.max(1, Number(nAsegurados) || 1);
  const primaUsd = redondear(
    PLAN_FUNERARIO_PRUEBA.primaTitularUsd + (n - 1) * PLAN_FUNERARIO_PRUEBA.primaDependienteUsd,
  );
  return {
    mprima: aVes(primaUsd),
    mprimaext: primaUsd,
    ptasa: TASA_PRUEBA,
    coberturas: [
      {
        ccobertura: 1,
        name: 'Servicio funerario (prueba)',
        sumaAsegurada: PLAN_FUNERARIO_PRUEBA.sumaUsd,
        prima: primaUsd,
      },
    ],
  };
}

/** Usa la prima que ya trae el wizard (la que se cobró) si es válida; si no, la de prueba. */
function quoteDesdeState(state, fallback) {
  const q = state?.quote;
  const usd = Number(q?.mprimaext);
  if (Number.isFinite(usd) && usd > 0) {
    const ptasa = Number(q.ptasa) > 0 ? Number(q.ptasa) : TASA_PRUEBA;
    const ves = Number(q.mprima) > 0 ? Number(q.mprima) : redondear(usd * ptasa);
    return { mprima: ves, mprimaext: usd, ptasa };
  }
  return { mprima: fallback.mprima, mprimaext: fallback.mprimaext, ptasa: fallback.ptasa };
}

function sufijoUnico(now) {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rnd = String(Math.floor(100000 + Math.random() * 900000));
  return `${ymd}-${rnd}`;
}

/**
 * Póliza de prueba con la forma de `policy` de /policies/emit y /personas/emision.
 * @param {'RCV'|'FUN'} producto
 */
function polizaPrueba(producto, quote, now = new Date(), frecuencia = 'A') {
  const sufijo = sufijoUnico(now);
  const cnpoliza = `PRUEBA-${producto}-${sufijo}`;
  const ifrecuencia = frecuenciaPrueba(frecuencia);
  return {
    number: cnpoliza,
    cnpoliza,
    cnrecibo: `PRUEBA-REC-${sufijo}`,
    urlpoliza: '',
    ncuota: 1,
    ifrecuencia,
    ncuotas: CUOTAS_POR_FRECUENCIA[ifrecuencia],
    internalPolicyId: `PRUEBA-${now.getTime()}`,
    emittedAt: now.toISOString(),
    quote: { mprima: quote.mprima, mprimaext: quote.mprimaext, ptasa: quote.ptasa },
    metadata: { simulacion: true, marca: 'neutra' },
  };
}

module.exports = {
  TASA_PRUEBA,
  FRECUENCIAS_PRUEBA,
  frecuenciaPrueba,
  VIGENCIAS_PRUEBA,
  planesRcvPrueba,
  cotizacionRcvPrueba,
  planesPersonasPrueba,
  cotizacionPersonasPrueba,
  quoteDesdeState,
  polizaPrueba,
};
