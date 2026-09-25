import { useEffect, useRef, useState } from 'react';
import { useWizardStore } from '../../store/wizardStore';
import {
  Check, Star, Shield, ChevronDown, ShieldCheck,
  Loader2, AlertTriangle, Users, CalendarClock
} from 'lucide-react';
import type { FuneralPerson, Plan } from '../../types';
import { personasApi, type PlanPer, getFrecuenciasByPlan, type CatalogItem } from '../../lib/api';
import { getProductConfig } from '../../lib/product';
import { AnimatedCounter } from '../../components/ui/AnimatedCounter';
import { toast } from '../../store/toastStore';
import { ageErrorForParentesco, isTitularOnlyPlan, maxAseguradosDelPlan, nmaxDepDelPlan } from '../../lib/funeralPlanParentescos';
import { syncTitularFromTomador } from '../../lib/funeral-sync';
import { FuneralInsuredsEditor } from './FuneralInsuredsEditor';

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

/** Convierte un PlanPer de la API al tipo Plan del wizard. */
function parseNdiasFromLabel(text: string): number | null {
  const m = String(text || '').match(/(\d+)\s*d[ií]as?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function apiPlanToWizardPlan(p: PlanPer): Plan {
  const fromApi =
    p.ndias != null && Number.isFinite(Number(p.ndias)) && Number(p.ndias) > 0
      ? Number(p.ndias)
      : null;
  const ndias = fromApi ?? parseNdiasFromLabel(p.xplan ?? '') ?? parseNdiasFromLabel(p.cplan ?? '');
  return {
    cplan: p.cplan,
    name: (p.xplan ?? '').trim() || p.cplan,
    price: 'Tarifa La Mundial',
    priceNum: 0,
    tag: ndias ? `Viajero · ${ndias} días` : 'Funerario',
    desc: ndias
      ? `Cobertura por ${ndias} días para las personas aseguradas.`
      : 'Cobertura de servicios funerarios para las personas aseguradas.',
    benefits: ndias
      ? [
          `Vigencia de ${ndias} días`,
          'Cobertura para el grupo asegurado',
          'Asistencia en viaje',
        ]
      : [
          'Servicio funerario completo',
          'Cobertura para el grupo familiar asegurado',
          'Asistencia y traslado',
        ],
    sumaAsegurada: 0,
    cramo: p.cramo,
    parentescos: p.parentescos ?? [],
    nmax_dep: p.nmax_dep ?? null,
    maxAsegurados: p.maxAsegurados,
    ndias,
  };
}

function vigenciasDesdeNdias(ndias: number): { fdesde: string; fhasta: string; ndias: number } {
  const fdesde = new Date().toISOString().slice(0, 10);
  const desde = new Date(`${fdesde}T00:00:00Z`);
  const hasta = new Date(desde);
  hasta.setUTCDate(hasta.getUTCDate() + ndias - 1);
  return { fdesde, fhasta: hasta.toISOString().slice(0, 10), ndias };
}

function planOptionKey(p: Plan): string {
  if (p.ndias != null && p.ndias > 0) return `${p.cplan}|${p.ndias}`;
  return p.cplan;
}

function planBaseKey(p: Plan): string {
  return String(p.cplan ?? '').trim();
}

function daysForPlan(plans: Plan[], cplan: string): Plan[] {
  const rows = plans.filter((p) => planBaseKey(p) === cplan && p.ndias != null && p.ndias > 0);
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

export function FuneralPlansStep() {
  const {
    funeral, selectedPlan, setSelectedPlan, setCategory,
    quote, quoteState, quoteError,
    tomador, asegurado, sameInsured,
  } = useWizardStore();

  const product = getProductConfig();

  const [apiPlans, setApiPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState(false);

  const [apiFrecuencias, setApiFrecuencias] = useState<CatalogItem[]>([]);
  const [frecLoading, setFrecLoading] = useState(false);
  const setFuneral = useWizardStore((s) => s.setFuneral);

  // ── Carga de planes de personas (ramo 9) ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);
    setPlansError(false);

    personasApi.planes(product.cramo)
      .then((res) => {
        if (cancelled) return;
        const mapped = (res.data.planes ?? []).map(apiPlanToWizardPlan);
        setApiPlans(mapped);
        const current = useWizardStore.getState().selectedPlan;
        const keep = current
          ? mapped.find(
              (p) =>
                planOptionKey(p) === planOptionKey(current)
                || (p.cplan === current.cplan && (current.ndias == null || p.ndias === current.ndias)),
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
    getFrecuenciasByPlan(planCode, planCramo(selectedPlan, product.cramo))
      .then((items) => {
        if (cancelled) return;
        const list = items.length ? items : FRECUENCIAS_PERSONAS_FALLBACK;
        setApiFrecuencias(list);
        const currentValid = list.find((i) => String(i.code) === funeral.frecuencia);
        if (!currentValid) {
          setFuneral({ frecuencia: String(list[0].code) });
        }
      })
      .catch((err) => {
        console.error('Error cargando frecuencias', err);
        if (cancelled) return;
        setApiFrecuencias(FRECUENCIAS_PERSONAS_FALLBACK);
        if (funeral.frecuencia !== 'A') setFuneral({ frecuencia: 'A' });
      })
      .finally(() => {
        if (!cancelled) setFrecLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedPlan?.cplan, selectedPlan?.cramo, product.cramo, setFuneral, funeral.frecuencia]);

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
  const titularSrc = sameInsured !== false ? tomador : asegurado;
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
  // SysIP calcPrima personas siempre cotiza ifrecuencia=A (prima anual).
  // Viajero: prima prorrata por ndias del plan elegido.
  const quoteSig = planCode
    ? `funeral|${planCode}|${planNdias ?? 'A'}|${aseguradosListos
        .map(({ a, idx }) => `${idx === 0 ? '1' : a.parentesco}:${a.identificacion}:${a.fechaNac}`)
        .join(',')}`
    : '';

  const activeSigRef = useRef('');

  useEffect(() => {
    if (!quoteSig || !planCode || aseguradosListos.length === 0) return;

    const snap = useWizardStore.getState();
    if (snap.quoteVehicleSignature === quoteSig) return;

    activeSigRef.current = quoteSig;
    snap.setQuoteState('loading');

    const snapPlan = useWizardStore.getState().selectedPlan;
    const vig = planNdias != null ? vigenciasDesdeNdias(planNdias) : null;
    personasApi.cotizar({
      cplan: planCode,
      cramo: planCramo(snapPlan, product.cramo),
      ifrecuencia: 'A',
      ...(vig ?? {}),
      asegurados: aseguradosListos.map(({ a, idx }) => ({
        parentesco: idx === 0 ? '1' : a.parentesco,
        identificacion: a.identificacion,
        fechaNac: a.fechaNac,
      })),
    })
      .then((r) => {
        if (activeSigRef.current !== quoteSig) return;
        useWizardStore.getState().setQuote(
          { mprima: r.data.mprima, mprimaext: r.data.mprimaext, ptasa: r.data.ptasa },
          quoteSig,
        );
      })
      .catch((err: unknown) => {
        if (activeSigRef.current !== quoteSig) return;
        const ax = err as { response?: { data?: { message?: string } }; message?: string };
        const message =
          ax.response?.data?.message?.trim()
          || ax.message
          || 'No pudimos obtener la tarifa.';
        useWizardStore.getState().setQuoteState('error', message);
        const ageIssue = /edad/i.test(message);
        toast.warning(
          ageIssue ? 'Edad fuera de rango del plan' : 'Cotización no disponible',
          message,
          9000,
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteSig]);

  const isLoadingQuote = quoteState === 'loading';
  const hasRealQuote = quoteState === 'ready' && Boolean(quote);
  const annualUsd = hasRealQuote ? quote!.mprimaext : 0;
  const planOptions = uniquePlansForSelect(apiPlans);
  const dayOptions = selectedPlan ? daysForPlan(apiPlans, selectedPlan.cplan) : [];
  const showDayPicker = dayOptions.length > 1;

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
      <div className="flex items-start justify-between gap-4 flex-wrap -mt-2">
        <p className="text-slate-500 text-sm leading-relaxed max-w-md">
          Selecciona el plan funerario que mejor se ajuste a tu grupo familiar.
        </p>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-xs font-bold text-indigo-700">
          <Users size={11} />
          {aseguradosListos.length} asegurado{aseguradosListos.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Selectores */}
      <div className={`grid grid-cols-1 gap-4 ${showDayPicker ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {/* Selector de plan */}
        <div>
          <label className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-2 inline-flex items-center gap-1.5">
            <Star size={11} className="text-violet-500" />
            Plan funerario
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
              value={selectedPlan ? selectedPlan.cplan : ''}
              onChange={(e) => {
                const code = e.target.value;
                const days = daysForPlan(apiPlans, code);
                const found = days[0]
                  ?? planOptions.find((p) => p.cplan === code)
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
                      <option key={p.cplan} value={p.cplan}>{cupo}</option>
                    );
                  })}
                </>
              )}
            </select>
            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
        </div>

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
        </div>
      </div>

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
                    {quoteError || 'Este plan no admite la edad o el parentesco del asegurado.'}
                  </p>
                )}
              </div>

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
                <p className="text-[0.7rem] text-slate-500 font-semibold mt-1 uppercase">/ año</p>
                {hasRealQuote && quote && quote.mprima > 0 && (
                  <p className="text-[0.65rem] font-bold text-indigo-700/80 mt-1.5 tabular-nums">
                    ≈ Bs {quote.mprima.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                )}
              </div>
            </div>

            <div className="divider-soft mb-5" />

            <p className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-3 inline-flex items-center gap-1.5">
              <Shield size={11} className="text-indigo-500" />
              Cobertura incluida
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
              {selectedPlan.benefits.map((b) => (
                <li key={b} className="flex items-start gap-2 text-xs text-slate-700">
                  <span className="w-4 h-4 rounded-full bg-emerald-500 text-white grid place-items-center flex-shrink-0 mt-0.5 shadow-[0_2px_8px_rgba(16,185,129,0.3)]">
                    <Check size={9} strokeWidth={3.5} />
                  </span>
                  <span className="leading-relaxed font-medium">{b}</span>
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
            {plansLoading ? 'Cargando planes disponibles...' : 'Elige un plan en el selector para ver la cotización.'}
          </p>
        </div>
      )}
    </div>
  );
}
