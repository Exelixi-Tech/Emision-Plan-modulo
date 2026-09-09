import { useEffect, useRef, useState } from 'react';
import { useWizardStore } from '../../store/wizardStore';
import {
  Check, Star, ChevronDown, ShieldCheck,
  Loader2, Building2, CalendarClock,
} from 'lucide-react';
import type { Plan } from '../../types';
import { patrimonialApi, type PlanRcv, getFrecuenciasByPlan, type CatalogItem } from '../../lib/api';
import { getProductConfig } from '../../lib/product';
import { toast } from '../../store/toastStore';

const FREC_LABELS: Record<string, string> = {
  A: 'Pago Anual (1 Cuota)',
  S: 'Pago Semestral (2 Cuotas)',
  T: 'Pago Trimestral (4 Cuotas)',
  M: 'Pago Mensual (12 Cuotas)',
};

function apiPlanToWizardPlan(p: PlanRcv): Plan {
  return {
    cplan: p.cplan,
    name: (p.xplan_c || p.xplan || '').trim() || p.cplan,
    price: 'Tarifa La Mundial',
    priceNum: 0,
    tag: 'Patrimonial',
    desc: 'Cobertura de responsabilidad civil y daños a bienes patrimoniales e inmuebles.',
    benefits: [
      'Protección integral contra riesgos generales',
      'Cobertura patrimonial y de responsabilidad civil',
      'Asistencia y respaldo La Mundial de Seguros',
    ],
    sumaAsegurada: 0,
    cproducto: p.cproducto,
    coberturasAdicionales: p.coberturasAdicionales,
  };
}

export function PatrimonialPlansStep() {
  const {
    patrimoniales, selectedPlan, setSelectedPlan, setCategory,
    quote, quoteState, rcv, setRcv,
  } = useWizardStore();

  const product = getProductConfig();

  const [apiPlans, setApiPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  const [apiFrecuencias, setApiFrecuencias] = useState<CatalogItem[]>([]);
  const [frecLoading, setFrecLoading] = useState(false);

  const activeFrecuencia = rcv?.frecuencia || 'A';

  // ── Carga de planes patrimoniales (ramo 20) ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);

    patrimonialApi.planes(product.cramo || 20)
      .then((res) => {
        if (cancelled) return;
        const mapped = (res.data.planes ?? []).map(apiPlanToWizardPlan);
        setApiPlans(mapped);
        if (mapped.length > 0 && !selectedPlan) {
          // Seleccionar por defecto el plan RCE9 o el primero
          const defaultP = mapped.find((p) => p.cplan?.toUpperCase() === 'RCE9') || mapped[0];
          setSelectedPlan(defaultP);
          setCategory(defaultP.name);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Error al cargar planes patrimoniales:', err);
        // Plan fallback garantizado
        const fallbackPlans: Plan[] = [
          {
            cplan: 'RCE9',
            name: 'Responsabilidad Civil Embarcación / Inmueble (RCE9)',
            price: 'Tarifa La Mundial',
            priceNum: 0,
            tag: 'Patrimonial',
            desc: 'Cobertura integral de riesgos generales y responsabilidad civil.',
            benefits: [
              'Protección de bienes patrimoniales',
              'Responsabilidad civil general',
              'Respaldo garantizado',
            ],
            sumaAsegurada: 0,
          },
        ];
        setApiPlans(fallbackPlans);
        if (!selectedPlan) {
          setSelectedPlan(fallbackPlans[0]);
          setCategory(fallbackPlans[0].name);
        }
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
      setApiFrecuencias([
        { code: 'A', label: 'Anual' },
      ]);
      return;
    }

    let cancelled = false;
    setFrecLoading(true);
    getFrecuenciasByPlan(planCode, product.cramo || 20)
      .then((items) => {
        if (!cancelled) {
          const list = items.length > 0 ? items : [{ code: 'A', label: 'Anual' }];
          setApiFrecuencias(list);
          const currentValid = list.find((i) => String(i.code) === activeFrecuencia);
          if (!currentValid && list.length > 0) {
            setRcv({ frecuencia: String(list[0].code) });
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApiFrecuencias([{ code: 'A', label: 'Anual' }]);
        }
      })
      .finally(() => {
        if (!cancelled) setFrecLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedPlan?.cplan, product.cramo, setRcv, activeFrecuencia]);

  // ── Cotización contra quote-generalRisks ────────────────────────────────────
  const planCode = selectedPlan?.cplan ?? '';
  const quoteSig = planCode
    ? `patrimonial|${planCode}|${activeFrecuencia}|${product.cramo || 20}`
    : '';

  const activeSigRef = useRef('');

  useEffect(() => {
    if (!quoteSig || !planCode) return;

    const snap = useWizardStore.getState();
    if (snap.quoteVehicleSignature === quoteSig) return;

    activeSigRef.current = quoteSig;
    snap.setQuoteState('loading');

    patrimonialApi.cotizar({
      cplan: planCode,
      cramo: product.cramo || 20,
      ifrecuencia: activeFrecuencia,
      pdescuento: 0,
      precargo: 0,
    })
      .then((r) => {
        if (activeSigRef.current !== quoteSig) return;
        useWizardStore.getState().setQuote(
          {
            mprima: r.data.mprima,
            mprimaext: r.data.mprimaext,
            ptasa: r.data.ptasa,
            coberturas: r.data.coberturas,
          },
          quoteSig,
        );
      })
      .catch((err: unknown) => {
        if (activeSigRef.current !== quoteSig) return;
        const ax = err as { response?: { data?: { message?: string } }; message?: string };
        const message =
          ax.response?.data?.message?.trim()
          || ax.message
          || 'No pudimos obtener la tarifa patrimonial.';
        useWizardStore.getState().setQuoteState('error', message);
        toast.warning('Cotización no disponible', message, 8000);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteSig]);

  const isLoadingQuote = quoteState === 'loading';
  const hasRealQuote = quoteState === 'ready' && Boolean(quote);
  const annualUsd = hasRealQuote ? quote!.mprimaext : 0;
  const annualBs = hasRealQuote ? quote!.mprima : 0;
  const ptasa = hasRealQuote ? quote!.ptasa : 0;

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header Info */}
      <div className="flex items-start justify-between gap-4 flex-wrap -mt-2">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            Planes de Seguro Patrimonial
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold">
              Riesgos Generales
            </span>
          </h2>
          <p className="text-slate-500 text-sm leading-relaxed mt-1 max-w-lg">
            Selecciona el plan patrimonial para asegurar el bien o inmueble con cotización en tiempo real.
          </p>
        </div>

        {patrimoniales?.datosBien && (
          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-700">
            <Building2 size={15} className="text-indigo-600 flex-shrink-0" />
            <div className="truncate max-w-[200px]">
              <span className="font-bold">{patrimoniales.datosBien}</span>
              {patrimoniales.tipo && <span className="text-slate-400"> · {patrimoniales.tipo}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Selectores de Plan y Frecuencia */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Selector de plan */}
        <div>
          <label className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-2 inline-flex items-center gap-1.5">
            <Star size={11} className="text-indigo-500" />
            Plan patrimonial
          </label>
          <div className="relative group">
            <div className={`absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg grid place-items-center pointer-events-none transition-all ${
              selectedPlan
                ? 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-[0_4px_14px_rgba(99,102,241,0.3)]'
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
              }}
              disabled={plansLoading}
              className="w-full h-14 pl-14 pr-10 rounded-2xl border border-slate-200 bg-white font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all appearance-none cursor-pointer shadow-sm hover:border-slate-300"
            >
              {apiPlans.length === 0 && (
                <option value="">{plansLoading ? 'Cargando planes...' : 'No hay planes disponibles'}</option>
              )}
              {apiPlans.map((p) => (
                <option key={p.cplan} value={p.cplan}>
                  {p.cplan} — {p.name}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>

        {/* Frecuencia de pago */}
        <div>
          <label className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-2 inline-flex items-center gap-1.5">
            <CalendarClock size={11} className="text-indigo-500" />
            Frecuencia de pago
          </label>
          <div className="relative group">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg bg-slate-100 grid place-items-center pointer-events-none text-slate-600">
              {frecLoading ? <Loader2 size={14} className="animate-spin text-indigo-500" /> : <CalendarClock size={15} />}
            </div>
            <select
              value={activeFrecuencia}
              onChange={(e) => setRcv({ frecuencia: e.target.value })}
              disabled={frecLoading || !selectedPlan}
              className="w-full h-14 pl-14 pr-10 rounded-2xl border border-slate-200 bg-white font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all appearance-none cursor-pointer shadow-sm hover:border-slate-300"
            >
              {apiFrecuencias.map((f) => (
                <option key={String(f.code)} value={String(f.code)}>
                  {FREC_LABELS[String(f.code)] || f.label || String(f.code)}
                </option>
              ))}
            </select>
            <ChevronDown size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Tarjeta de Cotización y Beneficios */}
      {selectedPlan && (
        <div className="rounded-3xl border border-indigo-100 bg-gradient-to-b from-indigo-50/40 via-white to-white p-6 shadow-sm relative overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-100">
            <div>
              <span className="px-2.5 py-1 rounded-lg bg-indigo-100/80 text-indigo-800 text-[0.65rem] font-extrabold uppercase tracking-wider">
                Plan Seleccionado
              </span>
              <h3 className="text-lg font-bold text-slate-900 mt-1.5">{selectedPlan.name}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{selectedPlan.desc}</p>
            </div>

            {/* Price Box */}
            <div className="bg-white rounded-2xl p-4 border border-indigo-100 shadow-sm min-w-[220px] text-right">
              <span className="text-[0.65rem] font-bold text-slate-400 uppercase tracking-wider block">
                Prima {FREC_LABELS[activeFrecuencia]?.split(' ')[1] || 'Total'}
              </span>
              <div className="flex items-baseline justify-end gap-1 mt-0.5">
                {isLoadingQuote ? (
                  <div className="flex items-center gap-2 text-indigo-600 text-sm py-1 font-semibold">
                    <Loader2 size={16} className="animate-spin" />
                    <span>Cotizando...</span>
                  </div>
                ) : hasRealQuote ? (
                  <>
                    <span className="text-2xl font-black text-slate-900 tracking-tight">
                      ${annualUsd.toFixed(2)}
                    </span>
                    <span className="text-xs font-bold text-slate-500">USD</span>
                  </>
                ) : (
                  <span className="text-sm font-semibold text-slate-400">Tarifa según consulta</span>
                )}
              </div>
              {hasRealQuote && annualBs > 0 && (
                <p className="text-[0.7rem] text-slate-500 mt-1 font-medium">
                  ≈ Bs. {annualBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  {ptasa > 1 && <span className="text-slate-400"> (Tasa: {ptasa.toFixed(2)})</span>}
                </p>
              )}
            </div>
          </div>

          {/* Coberturas del plan */}
          <div className="mt-6">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3.5 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-indigo-600" />
              Coberturas y beneficios incluidos
            </h4>

            {quote?.coberturas && quote.coberturas.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {quote.coberturas.map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50/80 border border-slate-100 text-xs">
                    <span className="font-semibold text-slate-800 flex items-center gap-2">
                      <Check size={13} className="text-indigo-600 flex-shrink-0" strokeWidth={2.5} />
                      {c.name}
                    </span>
                    {c.sumaAsegurada != null && c.sumaAsegurada > 0 && (
                      <span className="font-bold text-indigo-700 ml-2">
                        ${c.sumaAsegurada.toLocaleString('en-US')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs text-slate-600">
                {selectedPlan.benefits.map((b, idx) => (
                  <li key={idx} className="flex items-start gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <Check size={14} className="text-indigo-600 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
