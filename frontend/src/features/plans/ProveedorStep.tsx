import { useEffect, useRef, useState } from 'react';
import { useWizardStore } from '../../store/wizardStore';
import {
  Check, Star, Shield, ChevronDown, ShieldCheck,
  Loader2, AlertTriangle, Users, CalendarClock, Building2,
  Sparkles, CheckCircle2
} from 'lucide-react';
import type { Plan, ProveedorItem } from '../../types';
import {
  personasApi,
  type PlanPer,
  getFrecuenciasByPlan,
  type CatalogItem,
  getProveedores,
} from '../../lib/api';
import { decodeNexusTokenMetadata, getNexusToken } from '../../lib/nexus-token-client';
import { getProductConfig } from '../../lib/product';
import { AnimatedCounter } from '../../components/ui/AnimatedCounter';
import { toast } from '../../store/toastStore';

/** Convierte un PlanPer de la API al tipo Plan del wizard. */
function apiPlanToWizardPlan(p: PlanPer): Plan {
  return {
    cplan: p.cplan,
    name: (p.xplan ?? '').trim() || p.cplan,
    price: 'Tarifa La Mundial',
    priceNum: 0,
    tag: 'Plan con Proveedor',
    desc: 'Cobertura integral con red de proveedores de servicio calificados.',
    benefits: [
      'Atención médica y asistencia personalizada',
      'Red de clínicas y proveedores autorizados',
      'Cobertura para el grupo familiar asegurado',
      'Atención y coordinación de emergencias 24/7',
    ],
    sumaAsegurada: 0,
  };
}

const FALLBACK_DEV_PLANS: Plan[] = [
  {
    cplan: 'PLAN-PROV-01',
    name: 'Plan Salud y Asistencia Familiar',
    price: 'Tarifa La Mundial',
    priceNum: 45,
    tag: 'Plan con Proveedor',
    desc: 'Cobertura médica y asistencial completa con red de proveedores calificados.',
    benefits: [
      'Atención médica y emergencias 24/7',
      'Red de clínicas y proveedores autorizados',
      'Cobertura para el grupo familiar asegurado',
      'Asistencia médica domiciliaria y traslados',
    ],
    sumaAsegurada: 5000,
  },
  {
    cplan: 'PLAN-PROV-02',
    name: 'Plan Cobertura Integral Plus',
    price: 'Tarifa La Mundial',
    priceNum: 80,
    tag: 'Plan Especial',
    desc: 'Servicio ampliado con cobertura especializada y atención preferencial.',
    benefits: [
      'Acceso a red preferencial de proveedores',
      'Atención de urgencias ambulatorias y hospitalarias',
      'Consultas con especialistas y laboratorio',
      'Asistencia y orientación telefónica 24/7',
    ],
    sumaAsegurada: 10000,
  },
];

const FALLBACK_FRECUENCIAS: CatalogItem[] = [
  { code: 'A', label: 'Pago anual' },
  { code: 'S', label: 'Pago semestral' },
  { code: 'T', label: 'Pago trimestral' },
  { code: 'M', label: 'Pago mensual' },
];

export function ProveedorStep() {
  const {
    funeral,
    selectedPlan,
    setSelectedPlan,
    setCategory,
    quote,
    quoteState,
    quoteError,
    cproveedor,
    xproveedor,
    setCproveedor,
    metadataCanal,
  } = useWizardStore();

  const product = getProductConfig();

  const [apiPlans, setApiPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState(false);

  const [apiFrecuencias, setApiFrecuencias] = useState<CatalogItem[]>([]);
  const [frecLoading, setFrecLoading] = useState(false);
  const setFuneral = useWizardStore((s) => s.setFuneral);

  // ── Proveedores de Servicio ───────────────────────────────────────────────
  const [proveedores, setProveedores] = useState<ProveedorItem[]>([]);
  const [loadingProveedores, setLoadingProveedores] = useState(false);

  // ── Carga de planes de personas / salud ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);
    setPlansError(false);

    personasApi.planes(product.cramo)
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.planes ?? [];
        if (list.length > 0) {
          const mapped = list.map(apiPlanToWizardPlan);
          setApiPlans(mapped);
        } else {
          // Fallback para testing sin backend/token
          setApiPlans(FALLBACK_DEV_PLANS);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // En caso de error o sin token, cargar planes de desarrollo
        setApiPlans(FALLBACK_DEV_PLANS);
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
    getFrecuenciasByPlan(planCode, product.cramo)
      .then((items) => {
        if (!cancelled) {
          const result = items.length > 0 ? items : FALLBACK_FRECUENCIAS;
          setApiFrecuencias(result);
          const currentValid = result.find((i) => String(i.code) === funeral.frecuencia);
          if (!currentValid && result.length > 0) {
            setFuneral({ frecuencia: String(result[0].code) });
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApiFrecuencias(FALLBACK_FRECUENCIAS);
          setFuneral({ frecuencia: 'A' });
        }
      })
      .finally(() => {
        if (!cancelled) setFrecLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedPlan?.cplan, product.cramo, setFuneral, funeral.frecuencia]);

  // ── Consulta API valrep/proveedores al seleccionar plan ────────────────────
  useEffect(() => {
    const planCode = selectedPlan?.cplan;
    if (!planCode) {
      setProveedores([]);
      setCproveedor(undefined, undefined);
      return;
    }

    let cancelled = false;
    setLoadingProveedores(true);

    // Obtener centidad y citem desde metadataCanal o token SSO
    const token = getNexusToken('nexus_access_token_emision') || getNexusToken('nexus_access_token');
    const tokenMeta = token ? decodeNexusTokenMetadata(token) : null;
    const centidad = String(metadataCanal?.centidad ?? tokenMeta?.centidad ?? '').trim();
    const citem = String(
      metadataCanal?.citem ??
      tokenMeta?.citem ??
      (centidad === 'P' ? tokenMeta?.cproductor : null) ??
      (centidad === 'C' ? (tokenMeta?.ccanalalt_in ?? tokenMeta?.ccanalalt) : null) ??
      ''
    ).trim();

    getProveedores({
      cplan: planCode,
      cramo: product.cramo,
      centidad: centidad || undefined,
      citem: citem || undefined,
    })
      .then((items) => {
        if (cancelled) return;
        setProveedores(items);
        if (items.length > 0) {
          // Si el proveedor actual no está en la lista o no hay ninguno, auto-seleccionar el primero
          const currentMatch = items.find((p) => String(p.cci_rif) === String(cproveedor));
          if (!currentMatch) {
            const first = items[0];
            setCproveedor(String(first.cci_rif), first.xproveedor);
          }
        } else {
          setCproveedor(undefined, undefined);
        }
      })
      .catch((err) => {
        console.error('Error al consultar proveedores:', err);
        if (!cancelled) {
          // Fallback seguro a los mocks requeridos
          const fallback = [
            { xproveedor: 'Venemergencia', cci_rif: 1152516 },
            { xproveedor: 'Clinicas del Este', cci_rif: 5521516 },
          ];
          setProveedores(fallback);
          setCproveedor(String(fallback[0].cci_rif), fallback[0].xproveedor);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingProveedores(false);
      });

    return () => { cancelled = true; };
  }, [selectedPlan?.cplan, product.cramo, metadataCanal, setCproveedor]);

  // ── Cotización contra getCotizacionPer ─────────────────────────────────────
  const aseguradosListos = funeral.asegurados.filter(
    (a) => (a.identificacion || '').toString().trim() && (a.fechaNac || '').toString().trim(),
  );
  const planCode = selectedPlan?.cplan ?? '';
  const quoteSig = planCode
    ? `proveedor|${planCode}|${funeral.frecuencia}|${aseguradosListos
        .map((a) => `${a.parentesco}:${a.identificacion}:${a.fechaNac}`)
        .join(',')}`
    : '';

  const activeSigRef = useRef('');

  useEffect(() => {
    if (!quoteSig || !planCode || aseguradosListos.length === 0) return;

    const snap = useWizardStore.getState();
    if (snap.quoteVehicleSignature === quoteSig) return;

    activeSigRef.current = quoteSig;
    snap.setQuoteState('loading');

    personasApi.cotizar({
      cplan: planCode,
      cramo: product.cramo,
      ifrecuencia: funeral.frecuencia,
      asegurados: aseguradosListos.map((a) => ({
        parentesco: a.parentesco,
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

  const currentProveedorObj = proveedores.find((p) => String(p.cci_rif) === String(cproveedor));

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap -mt-2">
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-indigo-600" />
            Selección de Plan y Proveedor
          </h2>
          <p className="text-slate-500 text-sm leading-relaxed max-w-md mt-0.5">
            Selecciona el plan y el proveedor de servicio de tu preferencia para tu póliza.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-xs font-bold text-indigo-700">
          <Users size={11} />
          {aseguradosListos.length} asegurado{aseguradosListos.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Selectores */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Selector de plan */}
        <div>
          <label className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-2 inline-flex items-center gap-1.5">
            <Star size={11} className="text-violet-500" />
            Plan de Servicio
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
              value={selectedPlan?.cplan ?? ''}
              onChange={(e) => {
                const found = apiPlans.find((p) => p.cplan === e.target.value);
                if (found) setCategory(found.name);
                setSelectedPlan(found ?? null);
                if (found) {
                  setFuneral({
                    healthQuestionnaireDone: false,
                    healthAnswers: {},
                    diagnosticoEnfermedad: false,
                    descripcionEnfermedad: '',
                    aceptaTerminos: false,
                  });
                }
              }}
              disabled={plansLoading || apiPlans.length === 0}
              className="w-full pl-14 pr-10 py-3.5 rounded-xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-900 appearance-none cursor-pointer hover:border-indigo-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50"
            >
              {plansLoading ? (
                <option value="">Cargando planes...</option>
              ) : plansError ? (
                <option value="">Error al cargar planes</option>
              ) : apiPlans.length === 0 ? (
                <option value="">Sin planes disponibles</option>
              ) : (
                <>
                  <option value="" disabled>— Elige un plan —</option>
                  {apiPlans.map((p) => (
                    <option key={p.cplan} value={p.cplan ?? ''}>{p.name}</option>
                  ))}
                </>
              )}
            </select>
            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
        </div>

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
                <option value="">Cargando frecuencias...</option>
              ) : !selectedPlan ? (
                <option value="">Selecciona un plan primero</option>
              ) : apiFrecuencias.length === 0 ? (
                <option value="">Sin frecuencias disponibles</option>
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

      {/* Selector Desplegable de Proveedor de Servicio (Aparece al seleccionar plan) */}
      {selectedPlan && (
        <div className="animate-spring-in rounded-2xl border-2 border-indigo-200/80 bg-gradient-to-r from-indigo-50/70 via-white to-violet-50/50 p-4.5 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <label className="text-[0.68rem] font-black text-indigo-900 uppercase tracking-wider inline-flex items-center gap-1.5">
              <Building2 size={13} className="text-indigo-600" />
              Proveedor de Servicio
            </label>
            {cproveedor && (
              <span className="inline-flex items-center gap-1 text-[0.68rem] font-bold text-indigo-700 bg-white px-2.5 py-0.5 rounded-lg border border-indigo-200 shadow-xs">
                <CheckCircle2 size={11} className="text-emerald-500" />
                cproveedor: {String(cproveedor)}
              </span>
            )}
          </div>

          <div className="relative group">
            <div className={`absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg grid place-items-center pointer-events-none transition-all ${
              cproveedor
                ? 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-[0_4px_14px_rgba(79,70,229,0.3)]'
                : 'bg-slate-100 text-slate-500'
            }`}>
              {loadingProveedores ? (
                <Loader2 size={14} className="animate-spin text-indigo-600" />
              ) : (
                <Building2 size={15} strokeWidth={2.5} />
              )}
            </div>

            <select
              value={cproveedor ? String(cproveedor) : ''}
              onChange={(e) => {
                const val = e.target.value;
                const found = proveedores.find((p) => String(p.cci_rif) === val);
                if (found) {
                  setCproveedor(String(found.cci_rif), found.xproveedor);
                  toast.success('Proveedor seleccionado', `${found.xproveedor} (RIF: ${found.cci_rif})`);
                } else {
                  setCproveedor(undefined, undefined);
                }
              }}
              disabled={loadingProveedores || proveedores.length === 0}
              className="w-full pl-14 pr-10 py-3.5 rounded-xl border-2 border-indigo-200 bg-white text-sm font-bold text-slate-900 appearance-none cursor-pointer hover:border-indigo-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50"
            >
              {loadingProveedores ? (
                <option value="">Consultando valrep/proveedores...</option>
              ) : proveedores.length === 0 ? (
                <option value="">Sin proveedores disponibles</option>
              ) : (
                <>
                  <option value="" disabled>— Selecciona un Proveedor de Servicio —</option>
                  {proveedores.map((p) => (
                    <option key={String(p.cci_rif)} value={String(p.cci_rif)}>
                      {p.xproveedor} — (RIF/ID: {p.cci_rif})
                    </option>
                  ))}
                </>
              )}
            </select>
            <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>

          <p className="text-[0.72rem] text-slate-500 mt-2 flex items-center gap-1.5">
            <Sparkles size={12} className="text-amber-500 shrink-0" />
            El proveedor seleccionado se vinculará a la emisión como <code className="px-1 py-0.5 rounded bg-indigo-100/70 font-mono text-[0.68rem] text-indigo-900">cproveedor: {cproveedor ? String(cproveedor) : '---'}</code>.
          </p>
        </div>
      )}

      {/* Detalle del plan + prima */}
      {selectedPlan ? (
        <article className="relative rounded-2xl border-2 border-indigo-500/40 bg-gradient-to-br from-indigo-50/90 via-violet-50/40 to-white p-4 sm:p-6 shadow-[0_24px_48px_-12px_rgba(15,26,90,0.22)] animate-spring-in overflow-hidden">
          <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-fuchsia-500/12 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="inline-block px-2 py-0.5 rounded-md bg-white text-slate-600 text-[0.62rem] font-bold uppercase tracking-wider border border-slate-200 shadow-xs">
                    {selectedPlan.tag}
                  </span>
                  {currentProveedorObj && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-[0.65rem] font-black uppercase tracking-wider shadow-xs">
                      <Building2 size={10} />
                      {currentProveedorObj.xproveedor}
                    </span>
                  )}
                </div>
                <h3 className="font-display font-black text-slate-900 text-xl sm:text-2xl leading-tight break-words">{selectedPlan.name}</h3>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed max-w-md">{selectedPlan.desc}</p>
                {quoteState === 'error' && (
                  <p className="mt-3 text-xs font-semibold text-rose-700 bg-rose-50 px-3 py-2 rounded-md border border-rose-200 leading-relaxed normal-case">
                    <AlertTriangle size={12} strokeWidth={2.4} className="inline mr-1 -mt-0.5" />
                    {quoteError || 'Este plan no admite los parámetros del asegurado.'}
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
              Cobertura y Servicios Incluidos
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
                Plan y Proveedor seleccionados
              </div>
              {cproveedor && (
                <div className="text-[0.7rem] font-semibold text-slate-600">
                  Proveedor asignado: <strong className="text-indigo-700">{xproveedor || currentProveedorObj?.xproveedor}</strong>
                </div>
              )}
            </div>
          </div>
        </article>
      ) : (
        <div className="text-center py-14 px-4 rounded-2xl border-2 border-dashed border-slate-200 bg-gradient-to-br from-slate-50/70 to-white">
          <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 grid place-items-center mx-auto mb-3 shadow-sm">
            <Building2 size={22} className="text-slate-400" />
          </div>
          <p className="text-sm text-slate-500 font-medium">
            {plansLoading ? 'Cargando planes disponibles...' : 'Elige un plan en el selector para habilitar el proveedor de servicio y cotización.'}
          </p>
        </div>
      )}
    </div>
  );
}

export default ProveedorStep;
