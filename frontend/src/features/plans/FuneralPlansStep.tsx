import { useEffect, useRef, useState } from 'react';
import { useWizardStore } from '../../store/wizardStore';
import { planPreferidoRenovacion } from '../../lib/renovacion';
import { RenovacionBanner } from '../../components/RenovacionBanner';
import {
  Check, Star, Shield, ChevronDown, ShieldCheck,
  Loader2, AlertTriangle, Users, CalendarClock, Plane
} from 'lucide-react';
import type { FuneralPerson, Plan, PolicyQuote } from '../../types';
import {
  personasApi,
  resolveQuoteCramo,
  resolveSsoCproducto,
  resolveSsoXproducto,
  type PlanPer,
  getFrecuenciasByPlan,
  type CatalogItem,
} from '../../lib/api';
import { getProductConfig } from '../../lib/product';
import { AnimatedCounter } from '../../components/ui/AnimatedCounter';
import { toast } from '../../store/toastStore';
import {
  AGE_OUT_OF_RANGE_MESSAGE,
  AGE_OUT_OF_RANGE_TITLE,
  PLAN_UNAVAILABLE_MESSAGE,
  PLAN_UNAVAILABLE_TITLE,
  isAgeOutOfRangeError,
  isPlanUnavailableError,
} from '../../lib/personas-age';
import { ageErrorForParentesco, isTitularOnlyPlan, maxAseguradosDelPlan, nmaxDepDelPlan } from '../../lib/funeralPlanParentescos';
import { resolveTitularSource, syncTitularFromTomador } from '../../lib/funeral-sync';
import { frecuenciasPersonas, getCuotasByFrecuencia } from '../../lib/frecuencia';
import { FuneralInsuredsEditor } from './FuneralInsuredsEditor';
import {
  familiaViajeKey,
  familiasViaje,
  limitesDiasViaje,
  opcionesViajeParaDias,
  type OpcionPlanViaje,
  type RangoDiasViaje,
} from '../../lib/viajeroPlanes';
import { etiquetaTarifa, textoSinMarca } from '../../lib/marca';

function emptyTitular(): FuneralPerson {
  return {
    tipoDoc: 'V',
    identificacion: '',
    nombre: '',
    apellido: '',
    fechaNac: '',
    sexo: '',
    parentesco: '1',
  };
}

/** Completa el slot 0 con tomador/asegurado del formulario si llegó vacío del bridge. */
function mergeTitularFromForm(
  asegurados: FuneralPerson[],
  src: { identificacion?: string; fechaNac?: string; tipoDoc?: string; nombre?: string; apellido?: string },
): FuneralPerson[] {
  const list = (asegurados.length ? asegurados : [emptyTitular()]).map((a) => ({ ...a }));
  const titular = list[0];
  if (!String(titular.identificacion || '').trim()) {
    titular.identificacion = String(src.identificacion || '').trim();
    titular.tipoDoc = src.tipoDoc || titular.tipoDoc || 'V';
  }
  if (!String(titular.fechaNac || '').trim()) {
    titular.fechaNac = String(src.fechaNac || '').trim();
  }
  if (!String(titular.nombre || '').trim()) titular.nombre = String(src.nombre || '');
  if (!String(titular.apellido || '').trim()) titular.apellido = String(src.apellido || '');
  titular.parentesco = '1';
  return list;
}

/** SysIP persons-alt: si maplanes_frec no tiene el plan, al menos ANUAL. */
const FRECUENCIAS_PERSONAS_FALLBACK: CatalogItem[] = [{ code: 'A', label: 'ANUAL' }];
/** Viajero por días: pago único si el plan no tiene filas en maplanes_frec (p. ej. VIAJE5/VIAJE6). */
const FRECUENCIAS_VIAJE_PRORRATA_FALLBACK: CatalogItem[] = [{ code: 'E', label: 'ÚNICA' }];

/** Convierte un PlanPer de la API al tipo Plan del wizard. */
function parseNdiasFromLabel(text: string): number | null {
  const m = String(text || '').match(/(\d+)\s*d[ií]as?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Nombre de producto por cproducto (maproductos) cuando el SSO no trae `xproducto`. */
const PERSONAS_PRODUCT_LABELS: Record<string, string> = {
  '14': 'Salud Individual',
  '15': 'Salud Familiar',
  '25': 'Viajero',
  '26': 'Viajero Local',
  '51': 'Combinado Familiar',
  '52': 'Funerario Familiar',
  '57': 'Funerario',
  '58': 'Combinado de Personas',
  '76': 'Póliza de Vida',
  '77': '4 en 1',
  '78': 'Accidentes Personales',
  '79': 'Accidentes Personales Individual',
};

/** xproducto del wizard o del SSO; si no, el nombre por cproducto; si no, el del módulo. */
export function resolvePersonasProductLabel(meta: Record<string, unknown> | null, fallback: string): string {
  const fromMeta = String(meta?.xproducto ?? '').trim() || resolveSsoXproducto();
  if (fromMeta) return fromMeta;
  const cproducto = String(meta?.cproducto ?? '').trim() || resolveSsoCproducto();
  return PERSONAS_PRODUCT_LABELS[cproducto] ?? fallback;
}

function apiPlanToWizardPlan(p: PlanPer, productName: string = 'Funerario'): Plan {
  const fromApi =
    p.ndias != null && Number.isFinite(Number(p.ndias)) && Number(p.ndias) > 0
      ? Number(p.ndias)
      : null;
  const ndias = fromApi ?? parseNdiasFromLabel(p.xplan ?? '') ?? parseNdiasFromLabel(p.cplan ?? '');
  return {
    cplan: p.cplan,
    name: (p.xplan ?? '').trim() || p.cplan,
    price: etiquetaTarifa(),
    priceNum: 0,
    tag: ndias ? `Viajero · ${ndias} días` : productName,
    desc: ndias
      ? `Cobertura por ${ndias} días para las personas aseguradas.`
      : `Cobertura de ${productName.toLowerCase()} para las personas aseguradas.`,
    benefits: ndias
      ? [
          `Vigencia de ${ndias} días`,
          'Cobertura para el grupo asegurado',
          'Asistencia en viaje',
        ]
      : /funer/i.test(productName)
        ? [
            `Servicio de ${productName.toLowerCase()} completo`,
            'Cobertura para el grupo asegurado',
            'Atención especializada',
          ]
        : [
            'Coberturas según el plan elegido',
            'Cobertura para el grupo asegurado',
          ],
    sumaAsegurada: 0,
    cramo: p.cramo,
    parentescos: p.parentescos ?? [],
    nmax_dep: p.nmax_dep ?? null,
    maxAsegurados: p.maxAsegurados,
    ndias,
    ndiasFijo: fromApi != null,
    ndiasMin: enteroPositivo(p.ndiasMin),
    ndiasMax: enteroPositivo(p.ndiasMax),
  };
}

function enteroPositivo(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Planes VIAJ* (ramos 5 y 25): se piden las fechas del viaje y se eligen los planes que aplican a esos días. */
function isViajeroPorDias(plans: Plan[]): boolean {
  return plans.length > 0 && plans.every((p) => /^VIAJ/i.test(String(p.cplan ?? '').trim()));
}

function todayYmd(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Días del viaje contando salida y regreso; null si las fechas no son válidas o quedan fuera de los límites. */
function diasViaje(
  fdesde: string | undefined,
  fhasta: string | undefined,
  minDias: number,
  maxDias: number | null,
): number | null {
  if (!fdesde || !fhasta) return null;
  const desde = new Date(`${fdesde}T00:00:00Z`).getTime();
  const hasta = new Date(`${fhasta}T00:00:00Z`).getTime();
  if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta < desde) return null;
  const n = Math.round((hasta - desde) / 86_400_000) + 1;
  return n >= minDias && (maxDias == null || n <= maxDias) ? n : null;
}

function diasTexto(n: number): string {
  return `${n} día${n === 1 ? '' : 's'}`;
}

function rangoDiasTexto(r: RangoDiasViaje): string {
  if (r.max == null) return `desde ${diasTexto(r.min)}`;
  if (r.min === r.max) return diasTexto(r.min);
  return `de ${r.min} a ${r.max} días`;
}

function montoUsd(n: number, decimales = 2): string {
  return n.toLocaleString('es-VE', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

type FilaAsegurado = { a: FuneralPerson; idx: number };

/** Firma de la cotización de personas (plan, días, fecha de salida y asegurados). */
function funeralQuoteSig(plan: Plan | null, fdesde: string | undefined, asegurados: FilaAsegurado[]): string {
  const cplan = plan?.cplan ?? '';
  if (!cplan) return '';
  const ndias = plan?.ndias != null && plan.ndias > 0
    ? plan.ndias
    : parseNdiasFromLabel(plan?.name ?? plan?.tag ?? '');
  return `funeral|${plan?.cramo ?? ''}:${cplan}|${ndias ?? 'A'}|${fdesde ?? ''}|${asegurados
    .map(({ a, idx }) => `${idx === 0 ? '1' : a.parentesco}:${a.identificacion}:${a.fechaNac}`)
    .join(',')}`;
}

/** Mensaje y título de un error de cotización de personas. */
function errorCotizacion(err: unknown): { title: string; message: string } {
  const ax = err as { response?: { data?: { message?: string; code?: string } }; message?: string };
  const raw =
    ax.response?.data?.message?.trim()
    || ax.message
    || 'No pudimos obtener la tarifa.';
  const ageIssue = isAgeOutOfRangeError(ax.response?.data?.code) || isAgeOutOfRangeError(raw);
  const planIssue = !ageIssue
    && (isPlanUnavailableError(ax.response?.data?.code) || isPlanUnavailableError(raw));
  return {
    message: ageIssue ? AGE_OUT_OF_RANGE_MESSAGE : planIssue ? PLAN_UNAVAILABLE_MESSAGE : raw,
    title: ageIssue ? AGE_OUT_OF_RANGE_TITLE : planIssue ? PLAN_UNAVAILABLE_TITLE : 'Cotización no disponible',
  };
}

/** Cotización de un plan del selector de viajero. */
type CotizacionOpcionViaje =
  | { estado: 'cargando' }
  | { estado: 'lista'; quote: PolicyQuote }
  | { estado: 'error'; message: string };

/** Suma asegurada de la tarjeta: la mayor de las coberturas cotizadas; si no llega, la del nombre del plan. */
function sumaOpcionViaje(o: OpcionPlanViaje, quote: PolicyQuote | undefined): number | null {
  const sumas = (quote?.coberturas ?? []).map((c) => Number(c.sumaAsegurada) || 0);
  const mayor = sumas.length ? Math.max(...sumas) : 0;
  return mayor > 0 ? mayor : o.sumaNombre;
}

function vigenciasDesdeNdias(ndias: number): { fdesde: string; fhasta: string; ndias: number } {
  const fdesde = new Date().toISOString().slice(0, 10);
  const desde = new Date(`${fdesde}T00:00:00Z`);
  const hasta = new Date(desde);
  hasta.setUTCDate(hasta.getUTCDate() + ndias - 1);
  return { fdesde, fhasta: hasta.toISOString().slice(0, 10), ndias };
}

function planOptionKey(p: Plan): string {
  if (p.ndias != null && p.ndias > 0) return `${planBaseKey(p)}|${p.ndias}`;
  return planBaseKey(p);
}

/** Ramo + plan (como spBuscaPlanProducto): el mismo código existe en varios ramos del producto. */
function planBaseKey(p: Plan): string {
  const cplan = String(p.cplan ?? '').trim();
  if (!cplan) return '';
  return p.cramo != null ? `${p.cramo}:${cplan}` : cplan;
}

function daysForPlan(plans: Plan[], baseKey: string): Plan[] {
  const rows = plans.filter((p) => planBaseKey(p) === baseKey && p.ndias != null && p.ndias > 0);
  rows.sort((a, b) => (a.ndias ?? 0) - (b.ndias ?? 0));
  return rows;
}

function uniquePlansForSelect(plans: Plan[]): Plan[] {
  const seen = new Set<string>();
  const out: Plan[] = [];
  for (const p of plans) {
    const key = planBaseKey(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const days = daysForPlan(plans, key);
    out.push(days.length ? days[0] : p);
  }
  return out;
}

function findPlanByOptionKey(plans: Plan[], key: string): Plan | undefined {
  return plans.find((p) => planOptionKey(p) === key);
}

function selectPlanDisplayName(p: Plan): string {
  return String(p.name || p.cplan)
    .replace(/\s*[·•|-]?\s*\d+\s*d[ií]as?/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || p.cplan;
}

function planCramo(plan: Plan | null | undefined, fallback: number): number {
  const n = Number(plan?.cramo);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * `hidePrice`: el producto tiene cuestionario de salud. Las respuestas pueden recargar o
 * descontar la prima (o mandar a revisión), así que no se muestra ningún monto aquí:
 * el cliente ve la prima final recién al pagar.
 */
export function FuneralPlansStep({ hidePrice = false }: { hidePrice?: boolean } = {}) {
  const {
    funeral, selectedPlan, setSelectedPlan, setCategory,
    quote, quoteState, quoteError,
    tomador, asegurado, sameInsured, metadataCanal,
  } = useWizardStore();

  const product = getProductConfig();
  const productLabel = resolvePersonasProductLabel(
    metadataCanal as Record<string, unknown> | null,
    product.label,
  );
  const isFunerarioLabel = productLabel === product.label;

  const [apiPlans, setApiPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState(false);

  const [apiFrecuencias, setApiFrecuencias] = useState<CatalogItem[]>([]);
  const [frecLoading, setFrecLoading] = useState(false);
  // Viajero: plan elegido por el cliente (familia); se conserva al cambiar las fechas si sigue aplicando.
  const [familiaViaje, setFamiliaViaje] = useState<string | null>(() =>
    selectedPlan ? familiaViajeKey(selectedPlan) : null,
  );
  const [cotizacionesViaje, setCotizacionesViaje] = useState<Record<string, CotizacionOpcionViaje>>({});
  const cotizacionesPedidasRef = useRef<Set<string>>(new Set());
  const setFuneral = useWizardStore((s) => s.setFuneral);

  // ── Carga de planes de personas (ramo 9) ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);
    setPlansError(false);

    const meta = useWizardStore.getState().metadataCanal as Record<string, unknown> | null;
    const effectiveCramo = meta?.cramo != null ? Number(meta.cramo) : product.cramo;
    const effectiveLabel = resolvePersonasProductLabel(meta, product.label);

    personasApi.planes(effectiveCramo)
      .then((res) => {
        if (cancelled) return;
        const mapped = (res.data.planes ?? []).map((p) => apiPlanToWizardPlan(p, effectiveLabel));
        setApiPlans(mapped);
        const current = useWizardStore.getState().selectedPlan;
        // Renovación: sin plan elegido aún, preseleccionar el de la póliza anterior si sigue disponible.
        const planRenovacion = current ? null : planPreferidoRenovacion();
        if (planRenovacion) {
          setSelectedPlan(mapped.find((p) => String(p.cplan ?? '').toUpperCase() === planRenovacion) ?? null);
          return;
        }
        const keep = current
          ? mapped.find(
              (p) =>
                planOptionKey(p) === planOptionKey(current)
                || (planBaseKey(p) === planBaseKey(current) && (current.ndias == null || p.ndias === current.ndias)),
            ) ?? null
          : null;
        setSelectedPlan(keep);
      })
      .catch(() => {
        if (cancelled) return;
        setPlansError(true);
        setApiPlans([]);
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Carga de frecuencias ──────────────────────────────────────────────────
  useEffect(() => {
    const planCode = selectedPlan?.cplan;
    if (!planCode) {
      setApiFrecuencias([]);
      return;
    }

    let cancelled = false;
    setFrecLoading(true);
    const frecuenciasFallback = isViajeroPorDias(apiPlans)
      ? FRECUENCIAS_VIAJE_PRORRATA_FALLBACK
      : FRECUENCIAS_PERSONAS_FALLBACK;
    getFrecuenciasByPlan(planCode, planCramo(selectedPlan, product.cramo))
      .then((items) => {
        if (cancelled) return;
        const list = frecuenciasPersonas(items, frecuenciasFallback);
        setApiFrecuencias(list);
        const currentValid = list.find((i) => String(i.code) === funeral.frecuencia);
        if (!currentValid) {
          setFuneral({ frecuencia: String(list[0].code) });
        }
      })
      .catch((err) => {
        console.error('Error cargando frecuencias', err);
        if (cancelled) return;
        setApiFrecuencias(frecuenciasFallback);
        const code = String(frecuenciasFallback[0].code);
        if (funeral.frecuencia !== code) setFuneral({ frecuencia: code });
      })
      .finally(() => {
        if (!cancelled) setFrecLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedPlan?.cplan, selectedPlan?.cramo, product.cramo, setFuneral, funeral.frecuencia, apiPlans]);

  useEffect(() => {
    syncTitularFromTomador();
  }, [
    sameInsured,
    tomador.identificacion,
    tomador.nombre,
    tomador.apellido,
    tomador.fechaNac,
    tomador.sexo,
    asegurado.identificacion,
    asegurado.nombre,
    asegurado.apellido,
    asegurado.fechaNac,
    asegurado.sexo,
  ]);

  // ── Cotización contra getCotizacionPer ─────────────────────────────────────
  const planParentescos = selectedPlan?.parentescos ?? [];
  const planNmaxDep = nmaxDepDelPlan({
    nmax_dep: selectedPlan?.nmax_dep,
    maxAsegurados: selectedPlan?.maxAsegurados,
    parentescos: planParentescos,
  });
  const titularSrc = resolveTitularSource(sameInsured, tomador, asegurado);
  const aseguradosConTitular = mergeTitularFromForm(funeral.asegurados, titularSrc);
  const aseguradosListos = aseguradosConTitular
    .map((a, idx) => ({ a, idx }))
    .filter(({ a, idx }) => {
      const idOk = (a.identificacion || '').toString().trim() && (a.fechaNac || '').toString().trim();
      if (!idOk) return false;
      if (idx > 0 && !(a.parentesco || '').toString().trim()) return false;
      return !ageErrorForParentesco(
        a.fechaNac,
        idx === 0 ? '1' : a.parentesco,
        planParentescos,
      );
    });
  const planCode = selectedPlan?.cplan ?? '';
  const planNdias = selectedPlan?.ndias != null && selectedPlan.ndias > 0
    ? selectedPlan.ndias
    : parseNdiasFromLabel(selectedPlan?.name ?? selectedPlan?.tag ?? '');
  // Viajero por días: la vigencia son las fechas del viaje (no hoy + días del plan).
  const viajeroPorDias = isViajeroPorDias(apiPlans);
  // Límites de las fechas: los días que cubre algún plan del canal (lo que dice cada plan).
  const limitesViaje = viajeroPorDias ? limitesDiasViaje(apiPlans) : null;
  const viajeMinDias = limitesViaje?.min ?? 1;
  const viajeMaxDias = limitesViaje?.max ?? null;
  const viajeNdias = viajeroPorDias
    ? diasViaje(funeral.viajeFdesde, funeral.viajeFhasta, viajeMinDias, viajeMaxDias)
    : null;
  const viajeVig = viajeNdias != null
    ? { fdesde: funeral.viajeFdesde!, fhasta: funeral.viajeFhasta!, ndias: viajeNdias }
    : null;
  // Planes que aplican a los días del viaje: uno por familia, con su suma, coberturas y prima.
  const opcionesViaje = viajeNdias != null ? opcionesViajeParaDias(apiPlans, viajeNdias) : [];
  const opcionesViajeKey = opcionesViaje.map((o) => `${o.key}>${o.plan.cramo}:${o.plan.cplan}`).join(',');
  const mostrarSelectorViaje = opcionesViaje.length > 1;
  const aseguradosPayload = aseguradosListos.map(({ a, idx }) => ({
    parentesco: idx === 0 ? '1' : a.parentesco,
    identificacion: a.identificacion,
    fechaNac: a.fechaNac,
  }));
  const opcionesViajeSigs = opcionesViaje.map((o) => funeralQuoteSig(o.plan, viajeVig?.fdesde, aseguradosListos));
  // SysIP calcPrima personas siempre cotiza ifrecuencia=A (prima anual).
  // Viajero: prima prorrata por ndias del plan elegido.
  const quoteSig = funeralQuoteSig(selectedPlan, viajeVig?.fdesde, aseguradosListos);

  const activeSigRef = useRef('');

  useEffect(() => {
    if (!quoteSig || !planCode || aseguradosListos.length === 0) return;

    const snap = useWizardStore.getState();
    if (snap.quoteVehicleSignature === quoteSig) return;

    activeSigRef.current = quoteSig;
    snap.setQuoteState('loading');

    const snapPlan = useWizardStore.getState().selectedPlan;
    const vig = viajeVig ?? (planNdias != null ? vigenciasDesdeNdias(planNdias) : null);
    personasApi.cotizar({
      cplan: planCode,
      cramo: resolveQuoteCramo(snapPlan?.cramo, product.cramo),
      ifrecuencia: 'A',
      ...(vig ?? {}),
      asegurados: aseguradosPayload,
    })
      .then((r) => {
        if (activeSigRef.current !== quoteSig) return;
        if (!(Number(r.data.mprimaext) > 0)) {
          // Sin tarifa en Sis2000 para este plan: no se puede cobrar ni emitir.
          useWizardStore.getState().clearQuote();
          useWizardStore.getState().setQuoteState('error', PLAN_UNAVAILABLE_MESSAGE);
          toast.warning(PLAN_UNAVAILABLE_TITLE, PLAN_UNAVAILABLE_MESSAGE, 9000);
          return;
        }
        useWizardStore.getState().setQuote(
          {
            mprima: r.data.mprima,
            mprimaext: r.data.mprimaext,
            ptasa: r.data.ptasa,
            ...(r.data.coberturas?.length ? { coberturas: r.data.coberturas } : {}),
          },
          quoteSig,
        );
      })
      .catch((err: unknown) => {
        if (activeSigRef.current !== quoteSig) return;
        const { title, message } = errorCotizacion(err);
        useWizardStore.getState().setQuoteState('error', message);
        toast.warning(title, message, 9000);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteSig]);

  // ── Viajero: prima de cada plan del selector (mismo cálculo que la cotización del plan elegido) ──
  useEffect(() => {
    if (!mostrarSelectorViaje || !viajeVig || aseguradosListos.length === 0) return;
    opcionesViaje.forEach((o, i) => {
      const sig = opcionesViajeSigs[i];
      if (!sig || cotizacionesPedidasRef.current.has(sig)) return;
      cotizacionesPedidasRef.current.add(sig);
      const guardar = (valor: CotizacionOpcionViaje) =>
        setCotizacionesViaje((prev) => ({ ...prev, [sig]: valor }));
      guardar({ estado: 'cargando' });
      personasApi.cotizar({
        cplan: o.plan.cplan,
        cramo: resolveQuoteCramo(o.plan.cramo, product.cramo),
        ifrecuencia: 'A',
        ...viajeVig,
        asegurados: aseguradosPayload,
      })
        .then((r) => {
          if (!(Number(r.data.mprimaext) > 0)) {
            guardar({ estado: 'error', message: PLAN_UNAVAILABLE_MESSAGE });
            return;
          }
          guardar({
            estado: 'lista',
            quote: {
              mprima: r.data.mprima,
              mprimaext: r.data.mprimaext,
              ptasa: r.data.ptasa,
              ...(r.data.coberturas?.length ? { coberturas: r.data.coberturas } : {}),
            },
          });
        })
        .catch((err: unknown) => {
          // Se puede reintentar al volver a mostrar el plan.
          cotizacionesPedidasRef.current.delete(sig);
          guardar({ estado: 'error', message: errorCotizacion(err).message });
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarSelectorViaje, opcionesViajeSigs.join('#')]);

  const isLoadingQuote = quoteState === 'loading';
  const hasRealQuote = quoteState === 'ready' && Boolean(quote);
  const annualUsd = hasRealQuote ? quote!.mprimaext : 0;
  const cuotasFrecuencia = getCuotasByFrecuencia(funeral.frecuencia);
  const planOptions = uniquePlansForSelect(apiPlans);
  const dayOptions = selectedPlan ? daysForPlan(apiPlans, planBaseKey(selectedPlan)) : [];
  const showDayPicker = !viajeroPorDias && dayOptions.length > 1;

  // Viajero: al cambiar las fechas se recalculan los planes que aplican. Si hay uno solo, queda elegido
  // (como antes); si hay varios, se conserva el que eligió el cliente mientras siga aplicando.
  useEffect(() => {
    if (!viajeroPorDias) return;
    const current = useWizardStore.getState().selectedPlan;
    const familia = familiaViaje ?? (current ? familiaViajeKey(current) : null);
    const elegida = opcionesViaje.length === 1
      ? opcionesViaje[0]
      : opcionesViaje.find((o) => o.key === familia) ?? null;
    const next = elegida?.plan ?? null;
    if (
      current?.cplan === next?.cplan
      && current?.cramo === next?.cramo
      && current?.ndias === next?.ndias
    ) return;
    applySelectedPlan(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viajeroPorDias, viajeNdias, opcionesViajeKey, familiaViaje]);

  const hoy = todayYmd();
  const viajeHastaMax = funeral.viajeFdesde && viajeMaxDias != null
    ? addDaysYmd(funeral.viajeFdesde, viajeMaxDias - 1)
    : undefined;
  const viajeHastaMin = funeral.viajeFdesde ? addDaysYmd(funeral.viajeFdesde, viajeMinDias - 1) : undefined;
  const familiasDelCanal = viajeroPorDias && viajeNdias != null && opcionesViaje.length === 0
    ? familiasViaje(apiPlans)
    : [];

  /** El cliente elige un plan del selector; si ya está cotizado, se usa esa prima sin volver a pedirla. */
  function elegirOpcionViaje(o: OpcionPlanViaje, sig: string) {
    setFamiliaViaje(o.key);
    applySelectedPlan(o.plan);
    const cot = cotizacionesViaje[sig];
    if (cot?.estado === 'lista') useWizardStore.getState().setQuote(cot.quote, sig);
  }

  function applySelectedPlan(found: Plan | null) {
    if (found) setCategory(found.name);
    setSelectedPlan(found);
    if (!found) return;
    const extras = useWizardStore.getState().funeral.asegurados;
    const max = maxAseguradosDelPlan({
      maxAsegurados: found.maxAsegurados,
      nmax_dep: found.nmax_dep,
      parentescos: found.parentescos,
    });
    const nmax = nmaxDepDelPlan({
      nmax_dep: found.nmax_dep,
      maxAsegurados: found.maxAsegurados,
      parentescos: found.parentescos,
    });
    const titularOnly = max === 1 || isTitularOnlyPlan(found.parentescos);
    let nextAsegurados = titularOnly
      ? extras.slice(0, 1)
      : extras.map((a, idx) => {
        if (idx === 0) return a;
        const allowed = (found.parentescos ?? []).some(
          (p) => String(p.cparen) === String(a.parentesco),
        );
        return allowed ? a : { ...a, parentesco: '' };
      });
    if (max != null && nextAsegurados.length > max) {
      nextAsegurados = nextAsegurados.slice(0, max);
      toast.warning(
        'Límite del plan',
        `Este plan admite hasta ${nmax ?? 0} dependiente${nmax === 1 ? '' : 's'}. Se quitaron los que sobraban.`,
        6000,
      );
    } else if (titularOnly && extras.length > 1) {
      toast.warning(
        'Plan solo titular',
        'Se quitaron los asegurados adicionales porque este plan no los admite.',
        6000,
      );
    }
    setFuneral({
      asegurados: nextAsegurados,
      healthQuestionnaireDone: false,
      healthAnswers: {},
      healthAnswersByInsured: {},
      diagnosticoEnfermedad: false,
      descripcionEnfermedad: '',
      aceptaTerminos: false,
    });
  }

  return (
    <div className="animate-fade-in space-y-6">
      <RenovacionBanner />
      <div className="flex items-start justify-between gap-4 flex-wrap -mt-2">
        <p className="text-slate-500 text-sm leading-relaxed max-w-md">
          {viajeroPorDias
            ? 'Indica las fechas de tu viaje y elige entre los planes que aplican a esos días.'
            : isFunerarioLabel
              ? 'Selecciona el plan funerario que mejor se ajuste a tu grupo familiar.'
              : `Selecciona el plan de ${productLabel} que mejor se ajuste a tu grupo familiar.`}
        </p>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-xs font-bold text-indigo-700">
          <Users size={11} />
          {aseguradosListos.length} asegurado{aseguradosListos.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Selectores */}
      <div className={`grid grid-cols-1 gap-4 ${showDayPicker ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {viajeroPorDias ? (
        /* Viajero: fechas del viaje → días → planes que aplican */
        <div>
          <label className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-2 inline-flex items-center gap-1.5">
            <CalendarClock size={11} className="text-amber-500" />
            Fechas del viaje
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              aria-label="Fecha de salida"
              value={funeral.viajeFdesde ?? ''}
              min={hoy}
              onChange={(e) => {
                const fdesde = e.target.value;
                const fhasta = funeral.viajeFhasta;
                const tope = fdesde && viajeMaxDias != null ? addDaysYmd(fdesde, viajeMaxDias - 1) : undefined;
                const minimo = fdesde ? addDaysYmd(fdesde, viajeMinDias - 1) : undefined;
                setFuneral({
                  viajeFdesde: fdesde,
                  viajeFhasta: fhasta && minimo && fhasta >= minimo && (!tope || fhasta <= tope) ? fhasta : '',
                });
              }}
              className="w-full px-3 py-3 rounded-xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <input
              type="date"
              aria-label="Fecha de regreso"
              value={funeral.viajeFhasta ?? ''}
              min={viajeHastaMin || hoy}
              max={viajeHastaMax}
              disabled={!funeral.viajeFdesde}
              onChange={(e) => setFuneral({ viajeFhasta: e.target.value })}
              className="w-full px-3 py-3 rounded-xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50 disabled:bg-slate-50"
            />
          </div>
          <p className="mt-1.5 text-xs text-slate-600">
            {viajeNdias != null
              ? selectedPlan
                ? `${diasTexto(viajeNdias)} · ${selectedPlan.name}`
                : mostrarSelectorViaje
                  ? `${diasTexto(viajeNdias)} · elige tu plan`
                  : diasTexto(viajeNdias)
              : `Salida y regreso: ${rangoDiasTexto({ min: viajeMinDias, max: viajeMaxDias })}.`}
          </p>
        </div>
        ) : (
        /* Selector de plan */
        <div>
          <label className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-2 inline-flex items-center gap-1.5">
            <Star size={11} className="text-violet-500" />
            {isFunerarioLabel ? 'Plan funerario' : 'Plan'}
          </label>
          <div className="relative group">
            <div className={`absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg grid place-items-center pointer-events-none transition-all ${
              selectedPlan
                ? 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-[0_4px_14px_rgba(46,109,191,0.3)]'
                : 'bg-slate-100 text-slate-500'
            }`}>
              {plansLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} strokeWidth={2.5} />}
            </div>
            <select
              value={selectedPlan ? planBaseKey(selectedPlan) : ''}
              onChange={(e) => {
                const key = e.target.value;
                const days = daysForPlan(apiPlans, key);
                const found = days[0]
                  ?? planOptions.find((p) => planBaseKey(p) === key)
                  ?? null;
                applySelectedPlan(found);
              }}
              disabled={plansLoading || apiPlans.length === 0}
              className="w-full pl-14 pr-10 py-3.5 rounded-xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-900 appearance-none cursor-pointer hover:border-indigo-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50"
            >
              {plansLoading ? (
                <option value="">Cargando planes...</option>
              ) : plansError ? (
                <option value="">Error al cargar planes</option>
              ) : planOptions.length === 0 ? (
                <option value="">Sin planes disponibles</option>
              ) : (
                <>
                  <option value="" disabled>— Elige un plan —</option>
                  {planOptions.map((p) => {
                    const nmax = nmaxDepDelPlan({
                      nmax_dep: p.nmax_dep,
                      maxAsegurados: p.maxAsegurados,
                      parentescos: p.parentescos,
                    });
                    const label = selectPlanDisplayName(p);
                    const cupo = nmax == null
                      ? label
                      : nmax === 0
                        ? `${label} · sin dependientes`
                        : `${label} · hasta ${nmax} dependiente${nmax === 1 ? '' : 's'}`;
                    return (
                      <option key={planBaseKey(p)} value={planBaseKey(p)}>{cupo}</option>
                    );
                  })}
                </>
              )}
            </select>
            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
        </div>
        )}

        {showDayPicker ? (
          <div>
            <label className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-2 inline-flex items-center gap-1.5">
              <CalendarClock size={11} className="text-amber-500" />
              Días de vigencia
            </label>
            <div className="relative group">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg grid place-items-center pointer-events-none bg-gradient-to-br from-amber-500 to-orange-500 text-white">
                <CalendarClock size={15} strokeWidth={2.5} />
              </div>
              <select
                value={selectedPlan ? planOptionKey(selectedPlan) : ''}
                onChange={(e) => {
                  const found = findPlanByOptionKey(apiPlans, e.target.value) ?? null;
                  applySelectedPlan(found);
                }}
                className="w-full pl-14 pr-10 py-3.5 rounded-xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-900 appearance-none cursor-pointer hover:border-indigo-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
              >
                {dayOptions.map((p) => (
                  <option key={planOptionKey(p)} value={planOptionKey(p)}>
                    {p.ndias} días
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            </div>
          </div>
        ) : null}

        {/* Selector de frecuencia */}
        <div>
          <label className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-2 inline-flex items-center gap-1.5">
            <CalendarClock size={11} className="text-emerald-500" />
            Frecuencia de pago
          </label>
          <div className="relative group">
            <div className={`absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg grid place-items-center pointer-events-none transition-all ${
              funeral.frecuencia
                ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-[0_4px_14px_rgba(16,185,129,0.3)]'
                : 'bg-slate-100 text-slate-500'
            }`}>
              {frecLoading ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={15} strokeWidth={2.5} />}
            </div>
            <select
              value={funeral.frecuencia ?? ''}
              onChange={(e) => setFuneral({ frecuencia: e.target.value })}
              disabled={frecLoading || apiFrecuencias.length === 0 || !selectedPlan}
              className="w-full pl-14 pr-10 py-3.5 rounded-xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-900 appearance-none cursor-pointer hover:border-indigo-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50"
            >
              {frecLoading ? (
                <option value="">Cargando...</option>
              ) : !selectedPlan ? (
                <option value="">Selecciona un plan primero</option>
              ) : apiFrecuencias.length === 0 ? (
                <option value="">Sin frecuencias</option>
              ) : (
                apiFrecuencias.map((f) => (
                  <option key={f.code} value={String(f.code)}>{f.label}</option>
                ))
              )}
            </select>
            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
          {cuotasFrecuencia > 1 && (
            <p className="mt-1.5 text-xs text-slate-600">
              {annualUsd > 0 && !hidePrice
                ? `${cuotasFrecuencia} cuotas de $${(annualUsd / cuotasFrecuencia).toFixed(2)}. `
                : `${cuotasFrecuencia} cuotas. `}
              Hoy pagas la 1ª cuota y las siguientes se cobran por domiciliación bancaria.
            </p>
          )}
        </div>
      </div>

      {familiasDelCanal.length > 0 && !plansLoading ? (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
          <p className="font-bold inline-flex items-center gap-1.5">
            <AlertTriangle size={14} className="text-amber-600" />
            No hay planes para un viaje de {diasTexto(viajeNdias ?? 0)}.
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {familiasDelCanal.map((f) => (
              <li key={f.key}>
                <span className="font-semibold">{selectPlanDisplayName({ name: f.nombre, cplan: f.nombre } as Plan)}</span>
                {': '}
                {rangoDiasTexto(f.rango)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {mostrarSelectorViaje ? (
        <div>
          <p className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-2 inline-flex items-center gap-1.5">
            <Plane size={11} className="text-indigo-500" />
            Planes para {diasTexto(viajeNdias ?? 0)}
          </p>
          <div role="radiogroup" aria-label="Planes del viaje" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {opcionesViaje.map((o, i) => {
              const sig = opcionesViajeSigs[i];
              const cot = cotizacionesViaje[sig];
              const quoteOpcion = cot?.estado === 'lista' ? cot.quote : undefined;
              const suma = sumaOpcionViaje(o, quoteOpcion);
              const activo = Boolean(selectedPlan) && familiaViajeKey(selectedPlan!) === o.key;
              const coberturas = quoteOpcion?.coberturas?.length
                ? quoteOpcion.coberturas.map((c) => c.name)
                : o.plan.benefits;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  onClick={() => elegirOpcionViaje(o, sig)}
                  className={`text-left rounded-2xl border-2 p-4 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-200 ${
                    activo
                      ? 'border-indigo-500 bg-gradient-to-br from-indigo-50 to-white shadow-[0_12px_28px_-12px_rgba(15,26,90,0.35)]'
                      : 'border-slate-200 bg-white hover:border-indigo-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display font-black text-slate-900 text-sm leading-snug break-words">
                      {selectPlanDisplayName(o.plan)}
                    </p>
                    <span className={`w-5 h-5 rounded-full grid place-items-center flex-shrink-0 ${
                      activo ? 'bg-indigo-600 text-white' : 'border-2 border-slate-300'
                    }`}>
                      {activo ? <Check size={11} strokeWidth={3} /> : null}
                    </span>
                  </div>
                  <p className="mt-2 text-[0.62rem] font-black text-slate-500 uppercase tracking-widest">Suma asegurada</p>
                  <p className="text-base font-display font-black text-slate-900 tabular-nums">
                    {suma != null ? `${montoUsd(suma, 0)} $` : '—'}
                  </p>
                  <p className="mt-2 text-[0.62rem] font-black text-slate-500 uppercase tracking-widest">Prima del viaje</p>
                  {hidePrice ? (
                    <p className="text-xs font-semibold text-slate-600">Verás el monto al pagar.</p>
                  ) : !cot || cot.estado === 'cargando' ? (
                    <p className="text-xs font-semibold text-slate-500 inline-flex items-center gap-1.5">
                      {aseguradosListos.length ? <Loader2 size={12} className="animate-spin" /> : null}
                      {aseguradosListos.length ? 'Calculando…' : 'Completa los datos del titular.'}
                    </p>
                  ) : cot.estado === 'error' ? (
                    <p className="text-xs font-semibold text-rose-700 leading-relaxed">{textoSinMarca(cot.message)}</p>
                  ) : (
                    <p className="text-xl font-display font-black gradient-text-indigo tabular-nums">
                      $ {montoUsd(cot.quote.mprimaext)}
                    </p>
                  )}
                  <ul className="mt-3 space-y-1">
                    {coberturas.slice(0, 3).map((c) => (
                      <li key={c} className="flex items-start gap-1.5 text-[0.7rem] text-slate-700">
                        <Check size={11} strokeWidth={3} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span className="leading-snug">{c}</span>
                      </li>
                    ))}
                    {coberturas.length > 3 ? (
                      <li className="text-[0.68rem] font-semibold text-indigo-700">
                        + {coberturas.length - 3} cobertura{coberturas.length - 3 === 1 ? '' : 's'} más
                      </li>
                    ) : null}
                  </ul>
                  <p className="mt-2 text-[0.68rem] text-slate-500">Cubre viajes {rangoDiasTexto(o.rango)}.</p>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <FuneralInsuredsEditor
        parentescos={planParentescos}
        nmax_dep={selectedPlan?.nmax_dep}
        maxAsegurados={selectedPlan?.maxAsegurados}
      />

      {/* Detalle del plan + prima */}
      {selectedPlan ? (
        <article className="relative rounded-2xl border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-50/90 via-violet-50/40 to-white p-4 sm:p-6 shadow-[0_24px_48px_-12px_rgba(15,26,90,0.22)] animate-spring-in overflow-hidden">
          <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-fuchsia-500/12 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
              <div className="min-w-0 flex-1">
                <span className="inline-block px-2 py-0.5 rounded-md bg-white text-slate-500 text-[0.62rem] font-bold mb-2 uppercase tracking-wider border border-slate-200">
                  {selectedPlan.tag}
                </span>
                <h3 className="font-display font-black text-slate-900 text-xl sm:text-2xl leading-tight break-words">{selectedPlan.name}</h3>
                {planNmaxDep != null && (
                  <p className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-indigo-200 text-[0.7rem] font-bold text-indigo-800">
                    <Users size={12} className="text-indigo-500 shrink-0" />
                    Hasta {planNmaxDep} dependiente{planNmaxDep === 1 ? '' : 's'}
                  </p>
                )}
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed max-w-md">{selectedPlan.desc}</p>
                {quoteState === 'error' && (
                  <p className="mt-3 text-xs font-semibold text-rose-700 bg-rose-50 px-3 py-2 rounded-md border border-rose-200 leading-relaxed normal-case">
                    <AlertTriangle size={12} strokeWidth={2.4} className="inline mr-1 -mt-0.5" />
                    {textoSinMarca(quoteError) || PLAN_UNAVAILABLE_MESSAGE}
                  </p>
                )}
              </div>

              {hidePrice ? (
                <div className="w-full sm:w-auto sm:max-w-[15rem] sm:shrink-0 text-left sm:text-right">
                  <p className="text-[0.62rem] font-black text-indigo-700 uppercase tracking-widest">Prima</p>
                  <p className="mt-1 text-xs font-semibold text-slate-600 leading-relaxed">
                    Verás el monto al pagar.
                  </p>
                </div>
              ) : (
              <div className="w-full sm:w-auto sm:shrink-0 text-left sm:text-right">
                <div className="flex items-end gap-1 sm:justify-end">
                  <span className="text-base sm:text-[1.2rem] font-display font-black text-slate-500 leading-none pb-1 sm:pb-2">$</span>
                  {isLoadingQuote && !hasRealQuote ? (
                    <span className="text-4xl sm:text-5xl font-display font-black gradient-text-indigo leading-none inline-flex items-center gap-2">
                      <Loader2 size={28} className="animate-spin opacity-70" />
                      <span className="opacity-50">---</span>
                    </span>
                  ) : (
                    <span className="text-4xl sm:text-5xl font-display font-black gradient-text-indigo leading-none tabular-nums">
                      <AnimatedCounter value={annualUsd} duration={500} decimals={hasRealQuote ? 2 : 0} />
                    </span>
                  )}
                </div>
                <p className="text-[0.7rem] text-slate-500 font-semibold mt-1 uppercase">{viajeroPorDias ? '/ viaje' : '/ año'}</p>
                {hasRealQuote && quote && quote.mprima > 0 && (
                  <p className="text-[0.65rem] font-bold text-indigo-700/80 mt-1.5 tabular-nums">
                    ≈ Bs {quote.mprima.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                )}
              </div>
              )}
            </div>

            <div className="divider-soft mb-5" />

            <p className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-3 inline-flex items-center gap-1.5">
              <Shield size={11} className="text-indigo-500" />
              Cobertura incluida
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
              {/* Coberturas reales de la cotización (Sis2000); textos del plan solo si no llegan. */}
              {(hasRealQuote && quote?.coberturas?.length
                ? quote.coberturas.map((c) => ({
                    key: String(c.ccobertura ?? c.name),
                    text: c.name,
                    suma: c.sumaAsegurada,
                  }))
                : selectedPlan.benefits.map((b) => ({ key: b, text: b, suma: null as number | null }))
              ).map((item) => (
                <li key={item.key} className="flex items-start gap-2 text-xs text-slate-700">
                  <span className="w-4 h-4 rounded-full bg-emerald-500 text-white grid place-items-center flex-shrink-0 mt-0.5 shadow-[0_2px_8px_rgba(16,185,129,0.3)]">
                    <Check size={9} strokeWidth={3.5} />
                  </span>
                  <span className="leading-relaxed font-medium">
                    {item.text}
                    {item.suma != null && item.suma > 0 && (
                      <span className="block text-[0.68rem] text-slate-500 font-semibold">
                        Suma asegurada ${item.suma.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-5 pt-4 border-t border-indigo-100/80 flex items-center justify-between gap-2 flex-wrap">
              <div className="inline-flex items-center gap-1.5 text-[0.7rem] font-bold text-indigo-600">
                <ShieldCheck size={11} />
                Plan seleccionado
              </div>
            </div>
          </div>
        </article>
      ) : (
        <div className="text-center py-14 px-4 rounded-2xl border-2 border-dashed border-slate-200 bg-gradient-to-br from-slate-50/70 to-white">
          <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 grid place-items-center mx-auto mb-3 shadow-sm">
            <Shield size={22} className="text-slate-500" />
          </div>
          <p className="text-sm text-slate-500 font-medium">
            {plansLoading
              ? 'Cargando planes disponibles...'
              : viajeroPorDias && viajeNdias == null
                ? 'Indica las fechas del viaje para ver los planes disponibles.'
                : 'Elige un plan en el selector para ver la cotización.'}
          </p>
        </div>
      )}
    </div>
  );
}
