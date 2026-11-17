import { useEffect, useState } from 'react';
import { ProveedorStep } from '../features/plans/ProveedorStep';
import { FuneralHealthModal } from '../features/plans/FuneralHealthModal';
import { FuneralSubmissionPending } from '../features/plans/FuneralSubmissionPending';
import { toastPersonasBlocked } from '../features/plans/personasBlockedToast';
import { useWizardStore } from '../store/wizardStore';
import { toast } from '../store/toastStore';
import { getProductConfig } from '../lib/product';
import {
  fetchFuneralHealthQuestions,
  saveFuneralHealthAnswers,
  submitFuneralPolicyReview,
  type HealthQuestion,
} from '../lib/api';
import {
  FREC_LABELS,
  getSessionId,
  insuredKey,
  insuredLabel,
  mapHealthToFuneral,
  planConProveedor,
  proveedorHealthPatch,
  proveedorQuestionnaireRequest,
} from '../lib/personas-health';
import { EmissionPlanShell } from './EmissionPlanShell';
import { CheckCircle, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/Button';
import type { Plan } from '../types';

/**
 * Paso 4 — Plan con Proveedor de Servicio.
 * Vista autónoma sin requerir tokens de autenticación para pruebas y validación.
 *
 * Cuestionario de salud: si el producto (Combinado Familiar, 51) tiene preguntas en el panel,
 * se responden al confirmar y aplica el mismo semáforo que personas (verde → Pagos, amarillo/rojo
 * → mesa técnica). Sin preguntas, sigue directo a Pagos como siempre.
 */
export default function ProveedorPlansApp() {
  const {
    selectedPlan,
    cproveedor,
    xproveedor,
    funeral,
    tomador,
    asegurado,
    sameInsured,
    hasBeneficiary,
    beneficiario,
    documents,
    metadataCanal,
    setFuneral,
    setMetadataCanal,
    funeralSubmission,
    setFuneralSubmission,
  } = useWizardStore();
  const product = getProductConfig();
  const questionnaire = proveedorQuestionnaireRequest(metadataCanal, product);

  const [confirmed, setConfirmed] = useState(false);
  const [healthModalOpen, setHealthModalOpen] = useState(false);
  const [healthQuestions, setHealthQuestions] = useState<HealthQuestion[]>([]);
  /** Plan al que corresponden `healthQuestions` ('' = sin consultar). */
  const [questionsPlan, setQuestionsPlan] = useState('');
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [savingHealth, setSavingHealth] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<{
    id: string;
    scoreTotal: number;
    verdict?: string;
    message?: string;
  } | null>(null);

  // Solicitud ya enviada a mesa técnica en esta sesión (igual que personas): se vuelve a mostrar
  // "en revisión" al recargar y no se puede responder de nuevo. Verde no bloquea.
  useEffect(() => {
    if (pendingSubmission) return;
    let lock = funeralSubmission;
    if (!lock) {
      try {
        const raw = sessionStorage.getItem(`emision_funeral_submission:${getSessionId()}`);
        if (raw) lock = JSON.parse(raw) as typeof funeralSubmission;
      } catch { /* ignore */ }
    }
    if (!lock || lock.verdict === 'emit') return;
    if (lock.sessionId !== getSessionId()) return;
    if (!funeralSubmission) setFuneralSubmission(lock);
    setPendingSubmission({
      id: lock.id,
      scoreTotal: lock.scoreTotal,
      verdict: lock.verdict,
      message: lock.message,
    });
    setHealthModalOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funeralSubmission]);

  // ¿El producto tiene preguntas para este plan? Sin preguntas el cuestionario se da por resuelto
  // (comportamiento de siempre). Con preguntas queda pendiente hasta responderlas al confirmar.
  useEffect(() => {
    const cplan = selectedPlan?.cplan;
    if (!cplan) return;
    let cancelled = false;
    fetchFuneralHealthQuestions(cplan, questionnaire.cramo, questionnaire.cproducto)
      .then((qs) => {
        if (cancelled) return;
        setHealthQuestions(qs);
        setQuestionsPlan(cplan);
        if (qs.length === 0) setFuneral(proveedorHealthPatch(false));
      })
      // Se vuelve a intentar al confirmar.
      .catch(() => { if (!cancelled) setQuestionsPlan(''); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlan?.cplan, questionnaire.cramo, questionnaire.cproducto]);

  const questionsKnown = Boolean(selectedPlan?.cplan) && questionsPlan === selectedPlan?.cplan;
  const planHasQuestions = questionsKnown ? healthQuestions.length > 0 : null;
  // Como personas: con cuestionario (o sin poder confirmarlo) no se muestra la prima; se ve al pagar.
  const hidePrice = Boolean(selectedPlan) && planHasQuestions !== false;

  const healthInsureds = (funeral.asegurados || [])
    .filter((a) => String(a.identificacion || '').trim())
    .map((a, idx) => ({
      key: insuredKey(a, idx),
      label: insuredLabel(a, idx),
    }));

  /** Datos del proveedor para el siguiente módulo (Pagos los usa para registrarlo en adproveedor). */
  function proveedorAdvancePatch(plan: Plan) {
    const snap = useWizardStore.getState();
    return {
      cproveedor: String(snap.cproveedor),
      xproveedor: snap.xproveedor,
      cplan_proveedor: snap.cplan_proveedor,
      cramo_proveedor: snap.cramo_proveedor,
      cclave_num: snap.cclave_num,
      itiposerv: snap.itiposerv,
      selectedProveedor: snap.selectedProveedor,
      selectedPlan: plan,
    };
  }

  /** Sin cuestionario: sigue a Pagos como siempre. */
  async function advanceSinCuestionario() {
    if (!selectedPlan) return;
    toast.success(
      '¡Plan y Proveedor listos!',
      `Plan: ${selectedPlan.name} · Proveedor: ${xproveedor || 'Proveedor de servicio'}`,
      6000,
    );

    if (typeof window !== 'undefined' && window.__bridgeAdvance) {
      await window.__bridgeAdvance(proveedorAdvancePatch(selectedPlan));
    } else {
      setConfirmed(true);
    }
  }

  async function loadQuestions(cplan: string): Promise<HealthQuestion[]> {
    const qs = await fetchFuneralHealthQuestions(cplan, questionnaire.cramo, questionnaire.cproducto);
    setHealthQuestions(qs);
    setQuestionsPlan(cplan);
    return qs;
  }

  async function handleContinuar() {
    if (pendingSubmission || (funeralSubmission && funeralSubmission.verdict !== 'emit')) {
      toast.warning('Solicitud en revisión', 'Esta solicitud ya fue enviada a mesa técnica. Un técnico te contactará.');
      return;
    }

    if (!selectedPlan) {
      toast.warning('Plan requerido', 'Por favor selecciona un plan para continuar.');
      return;
    }

    if (!cproveedor) {
      toast.warning('Proveedor requerido', 'Por favor selecciona un proveedor de servicio.');
      return;
    }

    const snap = useWizardStore.getState();
    // Sin cotización lista (o de otro plan) no se avanza: Pagos cobraría una prima que no corresponde.
    const quoteMatchesPlan = String(snap.quoteVehicleSignature ?? '').includes(`:${selectedPlan.cplan}|`);
    if (snap.quoteState === 'loading') {
      toast.warning('Cotización en proceso', 'Por favor espera mientras calculamos la prima...', 3000);
      return;
    }
    if (snap.quoteState !== 'ready' || !snap.quote || !quoteMatchesPlan) {
      toast.warning(
        'Cotización no disponible',
        snap.quoteError?.trim() || 'No pudimos obtener la tarifa de este plan. Revisa los datos de los asegurados.',
        6000,
      );
      return;
    }

    if (!snap.funeral.aceptaTerminos) {
      toast.warning('Términos y condiciones', 'Debes aceptar los términos y condiciones para continuar.');
      return;
    }

    setLoadingQuestions(true);
    let qs: HealthQuestion[];
    try {
      qs = questionsKnown ? healthQuestions : await loadQuestions(selectedPlan.cplan);
    } catch {
      toast.error(
        'Error al cargar preguntas',
        'No pudimos obtener el cuestionario de salud. Intenta de nuevo.',
      );
      return;
    } finally {
      setLoadingQuestions(false);
    }

    if (qs.length === 0) {
      setFuneral(proveedorHealthPatch(false));
      await advanceSinCuestionario();
      return;
    }
    setHealthModalOpen(true);
  }

  /** Mismo camino que personas: guarda respuestas, scoring y semáforo en el servidor (Nexus). */
  async function handleHealthConfirm(byInsured: Record<string, Record<string, unknown>>) {
    if (!selectedPlan?.cplan) return;
    const questions = healthQuestions;
    setSavingHealth(true);
    try {
      const sessionId = getSessionId();
      const packed = { byInsured };
      const snap = useWizardStore.getState();
      // El proveedor viaja dentro del plan para que la solicitud en mesa técnica lo conserve.
      const plan = planConProveedor(selectedPlan, snap.selectedProveedor, questionnaire.cproducto);
      const health = mapHealthToFuneral(byInsured, questions);

      await saveFuneralHealthAnswers({
        sessionId,
        cplan: selectedPlan.cplan,
        cramo: questionnaire.cramo,
        cproducto: questionnaire.cproducto,
        tomadorRif: `${tomador.tipoDoc}-${tomador.identificacion}`,
        planName: selectedPlan.name,
        answers: packed,
      });

      const canAdvance = typeof window.__bridgeAdvance === 'function' && sessionId !== 'standalone';
      const { submission, scoring, quote: quoteAjustada, premiumAdjust, directPay, checkoutPatch } = await submitFuneralPolicyReview({
        sessionId,
        cplan: selectedPlan.cplan,
        cramo: questionnaire.cramo,
        cproducto: questionnaire.cproducto,
        tomador: { ...tomador },
        asegurado: { ...asegurado },
        sameInsured,
        hasBeneficiary: hasBeneficiary || (funeral.beneficiarios?.length ?? 0) > 0,
        beneficiario: hasBeneficiary
          ? { ...beneficiario }
          : funeral.beneficiarios?.[0]
            ? { ...funeral.beneficiarios[0] }
            : undefined,
        funeral: { ...snap.funeral, ...health },
        selectedPlan: { ...plan },
        quote: snap.quote ? { ...snap.quote } : null,
        quoteState: snap.quoteState,
        healthAnswers: packed,
        documents: { ...documents },
        metadataCanal: metadataCanal ?? undefined,
        cproveedor: snap.cproveedor,
        directCheckout: canAdvance,
        priorSubmission: funeralSubmission
          ? { id: funeralSubmission.id, sessionId: funeralSubmission.sessionId, verdict: funeralSubmission.verdict }
          : null,
      });

      setFuneral(health);
      // Recargo/descuento por respuestas: Pagos cobra la prima ajustada (sin aviso de montos).
      if (premiumAdjust && quoteAjustada) {
        const cur = useWizardStore.getState();
        cur.setQuote({ ...(cur.quote ?? quoteAjustada), ...quoteAjustada }, cur.quoteVehicleSignature ?? '');
      }
      setHealthModalOpen(false);
      const verdict = (scoring as { verdict?: string }).verdict;
      const verdictMessage = (scoring as { verdictMessage?: string }).verdictMessage;

      if (directPay && checkoutPatch && canAdvance) {
        // Verde: a Pagos en la misma sesión con cobro obligatorio y los datos del proveedor.
        setMetadataCanal({ ...(metadataCanal ?? {}), funeralSubmissionId: submission.id });
        toast.success('Solicitud aprobada', 'Continúa con el pago.');
        await window.__bridgeAdvance?.({ ...proveedorAdvancePatch(plan), ...checkoutPatch });
        return;
      }

      setPendingSubmission({
        id: submission.id,
        scoreTotal: scoring.total ?? submission.scoreTotal,
        verdict,
        message: verdictMessage,
      });

      // Amarillo / rojo: queda bloqueado en esta sesión aunque recargue la página.
      if (verdict && verdict !== 'emit') {
        const lock = {
          id: submission.id,
          sessionId,
          cplan: selectedPlan.cplan,
          verdict,
          scoreTotal: scoring.total ?? submission.scoreTotal,
          message: verdictMessage,
          createdAt: new Date().toISOString(),
        };
        setFuneralSubmission(lock);
        try { sessionStorage.setItem(`emision_funeral_submission:${sessionId}`, JSON.stringify(lock)); } catch { /* ignore */ }
        try { await window.__bridge?.save?.(); } catch { /* ignore */ }
      }

      toast.success(
        verdict === 'emit' ? 'Puedes continuar al pago' : 'Solicitud enviada',
        verdictMessage || 'Un técnico revisará tu caso.',
      );
    } catch (err: unknown) {
      toastPersonasBlocked(err);
    } finally {
      setSavingHealth(false);
    }
  }

  return (
    <>
      <EmissionPlanShell
        eyebrow="Paso 04 · Plan y Proveedor"
        title="Planes con Proveedor de Servicio"
        subtitle="Selecciona el plan que mejor se adapte a tus necesidades y elige tu proveedor de salud o asistencia."
        helpSubject="Suscripción Proveedor - Soporte"
        onContinuar={() => { void handleContinuar(); }}
        continuarLabel="Confirmar y Continuar"
        hideContinuar={Boolean(pendingSubmission)}
        continuarBusy={loadingQuestions}
      >
        <ProveedorStep hidePrice={hidePrice} />

        {confirmed && (
          <div className="mt-6 p-5 rounded-2xl bg-emerald-50 border-2 border-emerald-200 text-emerald-950 animate-spring-in">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white grid place-items-center shrink-0 shadow-md shadow-emerald-200">
                <CheckCircle size={22} strokeWidth={2.5} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-base text-emerald-900 flex items-center gap-2">
                  <ShieldCheck size={18} className="text-emerald-600" />
                  Plan y Proveedor Seleccionados
                </h4>
                <p className="text-xs text-emerald-800 mt-1 leading-relaxed">
                  Resumen de la selección para continuar con el flujo:
                </p>
                <div className="mt-3 p-3 bg-white/80 rounded-xl border border-emerald-200/80 font-mono text-xs text-slate-800 space-y-1">
                  <div><strong>cplan:</strong> <span className="text-indigo-600 font-bold">"{selectedPlan?.cplan}"</span> ({selectedPlan?.name})</div>
                  <div><strong>cproveedor:</strong> <span className="text-emerald-700 font-bold">"{String(cproveedor)}"</span> ({xproveedor || 'Proveedor'})</div>
                  <div><strong>frecuencia:</strong> <span className="text-violet-600 font-bold">"{funeral.frecuencia}"</span></div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmed(false)}
                    className="border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                  >
                    Modificar selección
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </EmissionPlanShell>

      {selectedPlan && (
        <FuneralHealthModal
          open={healthModalOpen}
          plan={selectedPlan}
          quote={null /* con cuestionario la prima se ve al pagar */}
          frecuenciaLabel={FREC_LABELS[funeral.frecuencia ?? 'A'] ?? 'Pago anual'}
          questions={healthQuestions}
          loadingQuestions={false}
          insureds={healthInsureds}
          initialByInsured={funeral.healthAnswersByInsured}
          saving={savingHealth}
          onClose={() => !savingHealth && setHealthModalOpen(false)}
          onConfirm={(byInsured) => { void handleHealthConfirm(byInsured); }}
        />
      )}

      {pendingSubmission && (
        <FuneralSubmissionPending
          tomadorEmail={tomador.email}
          planName={selectedPlan?.name}
          verdict={pendingSubmission.verdict}
          message={pendingSubmission.message}
        />
      )}
    </>
  );
}
