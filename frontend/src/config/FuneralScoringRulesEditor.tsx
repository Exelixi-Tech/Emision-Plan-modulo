import {
  Ban, CheckCircle2, Gauge, Layers, MessageSquare, ShieldAlert, Users,
} from 'lucide-react';
import type { HealthQuestionDraft } from './FuneralHealthQuestionsEditor';

export type ScoringBand = { min: number; max: number; message: string };

export type FuneralScoringRules = {
  rangesEnabled: boolean;
  ranges: {
    emit: ScoringBand;
    referred: ScoringBand;
    reject: ScoringBand;
  };
  concurrence: {
    enabled: boolean;
    minYesCount: number;
    extraPoints: number;
    questionIds: string[];
  };
  reviewerEmails: string[];
};

export const DEFAULT_FUNERAL_SCORING_RULES: FuneralScoringRules = {
  rangesEnabled: false,
  ranges: {
    emit: {
      min: 0,
      max: 29,
      message: 'Tus respuestas permiten continuar con la contratación.',
    },
    referred: {
      min: 30,
      max: 69,
      message: 'Un técnico revisará tu solicitud antes de continuar al pago.',
    },
    reject: {
      min: 70,
      max: 9999,
      message: 'Según tus respuestas no es posible emitir esta póliza en línea.',
    },
  },
  concurrence: {
    enabled: false,
    minYesCount: 2,
    extraPoints: 10,
    questionIds: [],
  },
  reviewerEmails: [],
};

export function parseFuneralScoringRules(raw: unknown): FuneralScoringRules {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const d = DEFAULT_FUNERAL_SCORING_RULES;
  const ranges = (src.ranges && typeof src.ranges === 'object' ? src.ranges : {}) as Record<string, ScoringBand>;
  const conc = (src.concurrence && typeof src.concurrence === 'object' ? src.concurrence : {}) as Record<string, unknown>;
  const band = (b: ScoringBand | undefined, fb: ScoringBand): ScoringBand => ({
    min: Number.isFinite(Number(b?.min)) ? Number(b.min) : fb.min,
    max: Number.isFinite(Number(b?.max)) ? Number(b.max) : fb.max,
    message: String(b?.message ?? fb.message),
  });
  return {
    rangesEnabled: src.rangesEnabled === true,
    ranges: {
      emit: band(ranges.emit, d.ranges.emit),
      referred: band(ranges.referred, d.ranges.referred),
      reject: band(ranges.reject, d.ranges.reject),
    },
    concurrence: {
      enabled: conc.enabled === true,
      minYesCount: Math.max(1, Number(conc.minYesCount) || d.concurrence.minYesCount),
      extraPoints: Number(conc.extraPoints) || 0,
      questionIds: Array.isArray(conc.questionIds)
        ? conc.questionIds.map((id) => String(id))
        : [],
    },
    reviewerEmails: Array.isArray(src.reviewerEmails)
      ? src.reviewerEmails.map((e) => String(e).trim()).filter(Boolean)
      : [],
  };
}

type BandKey = keyof FuneralScoringRules['ranges'];

const BAND_UI: Record<BandKey, {
  title: string;
  subtitle: string;
  Icon: typeof CheckCircle2;
  wrap: string;
  badge: string;
  bar: string;
  input: string;
}> = {
  emit: {
    title: 'Continúa',
    subtitle: 'Pasa a pago sin mesa técnica',
    Icon: CheckCircle2,
    wrap: 'border-emerald-200 bg-gradient-to-br from-emerald-50/90 to-white',
    badge: 'bg-emerald-600 text-white',
    bar: 'bg-emerald-500',
    input: 'focus:border-emerald-400',
  },
  referred: {
    title: 'Mesa técnica',
    subtitle: 'Un revisor autoriza o rechaza',
    Icon: ShieldAlert,
    wrap: 'border-amber-200 bg-gradient-to-br from-amber-50/90 to-white',
    badge: 'bg-amber-500 text-white',
    bar: 'bg-amber-400',
    input: 'focus:border-amber-400',
  },
  reject: {
    title: 'Rechazo',
    subtitle: 'No se emite en línea',
    Icon: Ban,
    wrap: 'border-rose-200 bg-gradient-to-br from-rose-50/80 to-white',
    badge: 'bg-rose-600 text-white',
    bar: 'bg-rose-500',
    input: 'focus:border-rose-400',
  },
};

const inpBase = 'w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none bg-white disabled:bg-slate-50 disabled:text-slate-400';

function rangeWarning(ranges: FuneralScoringRules['ranges']): string | null {
  if (ranges.emit.max + 1 !== ranges.referred.min) {
    return 'Hay un hueco o solape entre Continúa y Mesa. El máximo de uno debe ser el mínimo del siguiente menos 1.';
  }
  if (ranges.referred.max + 1 !== ranges.reject.min) {
    return 'Hay un hueco o solape entre Mesa y Rechazo. Encadena los rangos (ej. 0–29, 30–69, 70+).';
  }
  if (ranges.emit.min > ranges.emit.max || ranges.referred.min > ranges.referred.max) {
    return 'Un rango tiene el mínimo mayor que el máximo.';
  }
  return null;
}

function barPercents(ranges: FuneralScoringRules['ranges']): Record<BandKey, number> {
  const cap = Math.max(100, ranges.reject.min + 10);
  const span = (min: number, max: number) => {
    const a = Math.max(0, min);
    const b = Math.min(cap, max === 9999 ? cap : max);
    return Math.max(6, ((b - a) / cap) * 100);
  };
  return {
    emit: span(ranges.emit.min, ranges.emit.max),
    referred: span(ranges.referred.min, ranges.referred.max),
    reject: span(ranges.reject.min, ranges.reject.max === 9999 ? cap : ranges.reject.max),
  };
}

type Props = {
  rules: FuneralScoringRules;
  questions: HealthQuestionDraft[];
  onChange: (next: FuneralScoringRules) => void;
};

export function FuneralScoringRulesEditor({ rules, questions, onChange }: Props) {
  const patch = (partial: Partial<FuneralScoringRules>) => onChange({ ...rules, ...partial });
  const patchBand = (key: BandKey, field: keyof ScoringBand, value: string) => {
    const band = { ...rules.ranges[key] };
    if (field === 'message') band.message = value;
    else band[field] = value === '' ? 0 : Number(value);
    patch({ ranges: { ...rules.ranges, [key]: band } });
  };

  const booleanQs = questions.filter((q) => q.type === 'boolean' && q.enabled !== false);
  const warn = rules.rangesEnabled ? rangeWarning(rules.ranges) : null;
  const widths = barPercents(rules.ranges);
  const concNone = rules.concurrence.questionIds.length === 0;

  return (
    <section className="rounded-2xl border border-indigo-100/80 bg-white shadow-sm overflow-hidden">
      <header className="px-4 sm:px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-indigo-50/80 via-white to-violet-50/40">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white grid place-items-center shrink-0 shadow-md shadow-indigo-500/25">
            <Gauge size={18} />
          </span>
          <div className="min-w-0">
            <h3 className="font-display font-black text-slate-900 text-base leading-tight">
              Qué pasa según el puntaje
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Cada respuesta suma %. Aquí defines el destino del cliente: pago, mesa técnica o rechazo.
            </p>
          </div>
        </div>
      </header>

      <div className="p-4 sm:p-5 space-y-4">
        <button
          type="button"
          role="switch"
          aria-checked={rules.rangesEnabled}
          onClick={() => patch({ rangesEnabled: !rules.rangesEnabled })}
          className={`w-full text-left rounded-2xl border px-4 py-3.5 transition-all ${
            rules.rangesEnabled
              ? 'border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50/70'
              : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-sm font-bold ${rules.rangesEnabled ? 'text-indigo-900' : 'text-slate-700'}`}>
                Usar rangos de puntaje
              </p>
              <p className={`text-[0.78rem] mt-0.5 leading-relaxed ${rules.rangesEnabled ? 'text-indigo-700/80' : 'text-slate-500'}`}>
                {rules.rangesEnabled
                  ? 'El total de % decide si continúa, va a mesa o se rechaza.'
                  : 'Apagado: casi todo llega a mesa técnica, salvo el rechazo inmediato de una pregunta.'}
              </p>
            </div>
            <span
              className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${
                rules.rangesEnabled ? 'bg-indigo-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${
                  rules.rangesEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </span>
          </div>
        </button>

        <div className={`space-y-4 ${rules.rangesEnabled ? '' : 'opacity-55 pointer-events-none'}`}>
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
              Escala de destino
            </p>
            <div className="flex h-3 rounded-full overflow-hidden bg-slate-200">
              {(['emit', 'referred', 'reject'] as const).map((key) => (
                <div
                  key={key}
                  className={`${BAND_UI[key].bar} transition-all`}
                  style={{ width: `${widths[key]}%` }}
                  title={`${BAND_UI[key].title} ${rules.ranges[key].min}–${rules.ranges[key].max}`}
                />
              ))}
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] font-bold text-slate-400 tabular-nums">
              <span>{rules.ranges.emit.min}</span>
              <span>{rules.ranges.referred.min}</span>
              <span>{rules.ranges.reject.min}+</span>
            </div>
          </div>

          {warn && (
            <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              {warn}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(['emit', 'referred', 'reject'] as const).map((key) => {
              const ui = BAND_UI[key];
              const band = rules.ranges[key];
              const Icon = ui.Icon;
              return (
                <article key={key} className={`rounded-2xl border p-3.5 flex flex-col gap-3 ${ui.wrap}`}>
                  <div className="flex items-start gap-2.5">
                    <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${ui.badge}`}>
                      <Icon size={15} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 leading-tight">{ui.title}</p>
                      <p className="text-[11px] text-slate-500 leading-snug">{ui.subtitle}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">
                        Desde
                      </span>
                      <input
                        type="number"
                        step="any"
                        className={`${inpBase} ${ui.input}`}
                        value={band.min}
                        disabled={!rules.rangesEnabled}
                        onChange={(e) => patchBand(key, 'min', e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">
                        Hasta
                      </span>
                      <input
                        type="number"
                        step="any"
                        className={`${inpBase} ${ui.input}`}
                        value={band.max}
                        disabled={!rules.rangesEnabled}
                        onChange={(e) => patchBand(key, 'max', e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="block mt-auto">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1 inline-flex items-center gap-1">
                      <MessageSquare size={10} />
                      Lo que lee el cliente
                    </span>
                    <textarea
                      rows={3}
                      className={`${inpBase} ${ui.input} mt-1 resize-none leading-relaxed`}
                      value={band.message}
                      disabled={!rules.rangesEnabled}
                      onChange={(e) => patchBand(key, 'message', e.target.value)}
                    />
                  </label>
                </article>
              );
            })}
          </div>
        </div>

        <div className={`rounded-2xl border p-4 ${
          rules.concurrence.enabled
            ? 'border-violet-200 bg-gradient-to-br from-violet-50/80 to-white'
            : 'border-slate-200 bg-slate-50/50'
        }`}>
          <button
            type="button"
            role="switch"
            aria-checked={rules.concurrence.enabled}
            onClick={() =>
              patch({ concurrence: { ...rules.concurrence, enabled: !rules.concurrence.enabled } })
            }
            className="w-full text-left flex items-start justify-between gap-3"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${
                rules.concurrence.enabled ? 'bg-violet-600 text-white' : 'bg-slate-200 text-slate-500'
              }`}>
                <Layers size={15} />
              </span>
              <div>
                <p className="text-sm font-black text-slate-900">Varios “Sí” suman extra</p>
                <p className="text-[0.78rem] text-slate-500 mt-0.5 leading-relaxed">
                  Si el cliente marca Sí en varias preguntas de riesgo, se agregan puntos al total.
                </p>
              </div>
            </div>
            <span
              className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${
                rules.concurrence.enabled ? 'bg-violet-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${
                  rules.concurrence.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </span>
          </button>

          {rules.concurrence.enabled && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block rounded-xl bg-white border border-violet-100 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">
                    Mínimo de Sí
                  </span>
                  <input
                    type="number"
                    min={1}
                    className={inpBase}
                    value={rules.concurrence.minYesCount}
                    onChange={(e) =>
                      patch({
                        concurrence: {
                          ...rules.concurrence,
                          minYesCount: Math.max(1, Number(e.target.value) || 1),
                        },
                      })
                    }
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block">A partir de cuántos Sí aplica</span>
                </label>
                <label className="block rounded-xl bg-white border border-violet-100 p-3">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">
                    Puntos extra
                  </span>
                  <input
                    type="number"
                    step="any"
                    className={inpBase}
                    value={rules.concurrence.extraPoints}
                    onChange={(e) =>
                      patch({
                        concurrence: {
                          ...rules.concurrence,
                          extraPoints: Number(e.target.value) || 0,
                        },
                      })
                    }
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block">Se suman al % total</span>
                </label>
              </div>
              {booleanQs.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2 inline-flex items-center gap-1">
                    <Users size={10} />
                    Preguntas que cuentan {concNone ? '· todas las Sí/No' : ''}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {booleanQs.map((q) => {
                      const on = concNone || rules.concurrence.questionIds.includes(q.id);
                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => {
                            const ids = new Set(rules.concurrence.questionIds);
                            if (concNone) {
                              booleanQs.forEach((x) => ids.add(x.id));
                            }
                            if (ids.has(q.id) && !concNone) ids.delete(q.id);
                            else if (on && !concNone) ids.delete(q.id);
                            else ids.add(q.id);
                            patch({
                              concurrence: { ...rules.concurrence, questionIds: [...ids] },
                            });
                          }}
                          className={`max-w-full truncate px-2.5 py-1.5 rounded-full text-[11px] font-bold border transition-colors ${
                            on
                              ? 'bg-violet-600 text-white border-violet-600'
                              : 'bg-white text-slate-600 border-slate-200'
                          }`}
                          title={q.label || q.id}
                        >
                          {q.label || q.id}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
