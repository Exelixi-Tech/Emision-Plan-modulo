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
    min: Number.isFinite(Number(b?.min)) ? Number(b?.min) : fb.min,
    max: Number.isFinite(Number(b?.max)) ? Number(b?.max) : fb.max,
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

const inp = 'w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-400 bg-white';
const lbl = 'text-[10px] font-bold text-slate-500 uppercase tracking-wide block mb-1';

type Props = {
  rules: FuneralScoringRules;
  questions: HealthQuestionDraft[];
  onChange: (next: FuneralScoringRules) => void;
};

export function FuneralScoringRulesEditor({ rules, questions, onChange }: Props) {
  const patch = (partial: Partial<FuneralScoringRules>) => onChange({ ...rules, ...partial });
  const patchBand = (key: keyof FuneralScoringRules['ranges'], field: keyof ScoringBand, value: string) => {
    const band = { ...rules.ranges[key] };
    if (field === 'message') band.message = value;
    else band[field] = value === '' ? 0 : Number(value);
    patch({ ranges: { ...rules.ranges, [key]: band } });
  };

  const booleanQs = questions.filter((q) => q.type === 'boolean' && q.enabled !== false);

  return (
    <div className="rounded-xl border border-indigo-100 bg-white p-3 space-y-3">
      <p className="text-xs font-black text-indigo-700 uppercase tracking-widest">
        Reglas de scoring
      </p>
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <input
          type="checkbox"
          className="rounded text-indigo-600"
          checked={rules.rangesEnabled}
          onChange={(e) => patch({ rangesEnabled: e.target.checked })}
        />
        Clasificar por rangos (exitosa / referida / rechazo)
      </label>
      <p className="text-[11px] text-slate-500 -mt-1">
        Si está apagado, todo va a mesa técnica (salvo rechazo de una pregunta).
      </p>
      {(['emit', 'referred', 'reject'] as const).map((key) => {
        const title =
          key === 'emit' ? 'Emisión exitosa' : key === 'referred' ? 'Referida (mesa técnica)' : 'Rechazo inmediato';
        const band = rules.ranges[key];
        return (
          <div key={key} className="grid grid-cols-[4.5rem_4.5rem_1fr] gap-2 items-end">
            <div>
              <label className={lbl}>{title} mín</label>
              <input
                type="number"
                step="any"
                className={inp}
                value={band.min}
                disabled={!rules.rangesEnabled}
                onChange={(e) => patchBand(key, 'min', e.target.value)}
              />
            </div>
            <div>
              <label className={lbl}>Máx</label>
              <input
                type="number"
                step="any"
                className={inp}
                value={band.max}
                disabled={!rules.rangesEnabled}
                onChange={(e) => patchBand(key, 'max', e.target.value)}
              />
            </div>
            <div>
              <label className={lbl}>Mensaje al cliente</label>
              <input
                className={inp}
                value={band.message}
                disabled={!rules.rangesEnabled}
                onChange={(e) => patchBand(key, 'message', e.target.value)}
              />
            </div>
          </div>
        );
      })}

      <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 pt-1">
        <input
          type="checkbox"
          className="rounded text-indigo-600"
          checked={rules.concurrence.enabled}
          onChange={(e) =>
            patch({ concurrence: { ...rules.concurrence, enabled: e.target.checked } })
          }
        />
        Concurrencia: sumar extra si hay varios Sí
      </label>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={lbl}>Sí mínimos</label>
          <input
            type="number"
            min={1}
            className={inp}
            disabled={!rules.concurrence.enabled}
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
        </div>
        <div>
          <label className={lbl}>Puntos extra</label>
          <input
            type="number"
            step="any"
            className={inp}
            disabled={!rules.concurrence.enabled}
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
        </div>
      </div>
      {rules.concurrence.enabled && booleanQs.length > 0 && (
        <div className="space-y-1">
          <p className={lbl}>Preguntas que cuentan (vacío = todas las Sí/No)</p>
          {booleanQs.map((q) => {
            const on = rules.concurrence.questionIds.includes(q.id);
            const none = rules.concurrence.questionIds.length === 0;
            return (
              <label key={q.id} className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="rounded text-indigo-600"
                  checked={none || on}
                  onChange={() => {
                    const ids = new Set(rules.concurrence.questionIds);
                    if (none) {
                      booleanQs.forEach((x) => ids.add(x.id));
                    }
                    if (ids.has(q.id) && !none) ids.delete(q.id);
                    else if (on) ids.delete(q.id);
                    else ids.add(q.id);
                    patch({
                      concurrence: { ...rules.concurrence, questionIds: [...ids] },
                    });
                  }}
                />
                {q.label || q.id}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
