import { useState } from 'react';
import { FuneralPlansStep } from '../features/plans/FuneralPlansStep';
import { FuneralHealthModal } from '../features/plans/FuneralHealthModal';
import { FuneralSubmissionPending } from '../features/plans/FuneralSubmissionPending';
import { useWizardStore } from '../store/wizardStore';
import { getProductConfig } from '../lib/product';
import { toast } from '../store/toastStore';
import { validatePlanReady } from '../lib/planContinue';
import {
  fetchFuneralHealthQuestions,
  saveFuneralHealthAnswers,
  submitFuneralPolicyReview,
  validateFuneralEmission,
  PolicyEmitError,
  type HealthQuestion,
} from '../lib/api';
import { EmissionPlanShell } from './EmissionPlanShell';
import { isFuneralInsuredComplete } from '../features/plans/FuneralInsuredsEditor';

const FREC_LABELS: Record<string, string> = {
  M: 'Pago mensual',
  T: 'Pago trimestral',
  C: 'Pago cuatrimestral',
  S: 'Pago semestral',
  A: 'Pago anual',
};

function getSessionId(): string {
  try {
    return new URLSearchParams(window.location.search).get('sid') || 'standalone';
  } catch {
    return 'standalone';
  }
}

function insuredKey(person: { tipoDoc?: string; identificacion?: string }, idx: number) {
  const id = String(person.identificacion ?? '').replace(/\D/g, '');
  if (id) return `${String(person.tipoDoc || 'V').trim()}-${id}`;
  return `aseg-${idx}`;
}

function insuredLabel(person: { nombre?: string; apellido?: string; identificacion?: string }, idx: number) {
  const name = [person.nombre, person.apellido].filter(Boolean).join(' ').trim();
  return name || String(person.identificacion || '').trim() || `Asegurado ${idx + 1}`;
}

function mapHealthToFuneral(byInsured: Record<string, Record<string, unknown>>) {
  const first = Object.values(byInsured)[0] ?? {};
  return {
    diagnosticoEnfermedad: first.diagnosticoEnfermedad === true,
    descripcionEnfermedad: String(first.descripcionEnfermedad ?? ''),
    aceptaTerminos: first.aceptaTerminos === true,
    healthAnswers: first,
    healthAnswersByInsured: byInsured,
    healthQuestionnaireDone: true,
  };
}

/**
 * Paso 4 — Funerario únicamente.
 * Cuestionario de salud → confirmación al cliente (correo con link de pago) — no avanza a Pagos directo.
 */
export default function FuneralPlansApp() {
  const {
    category, selectedPlan, quoteState, quote, funeral,
    tomador, asegurado, sameInsured, hasBeneficiary, beneficiario,
    documents, metadataCanal, setFuneral,
  } = useWizardStore();
  const product = getProductConfig();

  const [healthModalOpen, setHealthModalOpen] = useState(false);
  const [healthQuestions, setHealthQuestions] = useState<HealthQuestion[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [savingHealth, setSavingHealth] = useState(false);
  const [validatingEmit, setValidatingEmit] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<{
    id: string;
    scoreTotal: number;
    verdict?: string;
    message?: string;
  } | null>(null);

  const healthInsureds = (funeral.asegurados || [])
    .filter((a) => String(a.identificacion || '').trim())
    .map((a, idx) => ({
      key: insuredKey(a, idx),
      label: insuredLabel(a, idx),
    }));

  function toastPersonasBlocked(err: unknown) {
    const code = err instanceof PolicyEmitError ? err.code : '';
    const msg =
      err instanceof Error
        ? err.message
        : 'Ya existe una póliza funeraria activa para este asegurado.';
    if (code === 'PERSONAS_DUPLICATE' || /póliza vigente|mismo asegurado/i.test(msg)) {
      toast.warning(
        'Póliza vigente',
        'Este asegurado ya tiene una póliza activa. No se envía al técnico ni se continúa al pago.',
        8000,
      );
      return;
    }
    if (code === 'HEALTH_BLOCKED') {
      toast.warning(
        'Cuestionario de salud',
        msg || 'Según tus respuestas, la solicitud no puede continuar en línea.',
        9000,
      );
      return;
    }
    toast.error('No se puede continuar', msg);
  }

  async function handleContinuar() {
    if (!validatePlanReady(category, selectedPlan, quoteState, quote)) return;
    if (!selectedPlan?.cplan) return;
    const incomplete = (funeral.asegurados || []).findIndex(
      (a, idx) => !isFuneralInsuredComplete(a, idx === 0),
    );
    if (incomplete >= 0) {
      toast.warning(
        incomplete === 0 ? 'Faltan datos del titular' : 'Faltan datos del asegurado',
        incomplete === 0
          ? 'Completa estatura, peso, dirección y contacto del titular en el formulario.'
          : 'Completa todos los datos del asegurado adicional (como en SysIP) antes de continuar.',
        7000,
      );
      return;
    }
    setValidatingEmit(true);
    try {
      await validateFuneralEmission({
        state: {
          tomador,
          funeral,
          selectedPlan,
          sameInsured,
          asegurado,
          metadataCanal,
        },
        plan: selectedPlan.cplan,
      });
      await openHealthModal();
    } catch (err) {
      toastPersonasBlocked(err);
    } finally {
      setValidatingEmit(false);
    }
  }

  async function openHealthModal() {
    if (!selectedPlan?.cplan) return;
    setHealthModalOpen(true);
    setLoadingQuestions(true);
    try {
      const qs = await fetchFuneralHealthQuestions(selectedPlan.cplan);
      setHealthQuestions(qs);
    } catch {
      toast.error(
        'Error al cargar preguntas',
        'No pudimos obtener el cuestionario de salud. Intenta de nuevo.',
      );
      setHealthModalOpen(false);
    } finally {
      setLoadingQuestions(false);
    }
  }

  async function handleHealthConfirm(byInsured: Record<string, Record<string, unknown>>) {
    if (!selectedPlan?.cplan) return;
    setSavingHealth(true);
    try {
      const sessionId = getSessionId();
      const packed = { byInsured };

      await saveFuneralHealthAnswers({
        sessionId,
        cplan: selectedPlan.cplan,
        cramo: product.cramo,
        tomadorRif: `${tomador.tipoDoc}-${tomador.identificacion}`,
        planName: selectedPlan.name,
        answers: packed,
      });

      const { submission, scoring } = await submitFuneralPolicyReview({
        sessionId,
        cplan: selectedPlan.cplan,
        cramo: product.cramo,
        tomador: { ...tomador },
        asegurado: { ...asegurado },
        sameInsured,
        hasBeneficiary: hasBeneficiary || (funeral.beneficiarios?.length ?? 0) > 0,
        beneficiario: hasBeneficiary
          ? { ...beneficiario }
          : funeral.beneficiarios?.[0]
            ? { ...funeral.beneficiarios[0] }
            : undefined,
        funeral: { ...funeral, ...mapHealthToFuneral(byInsured) },
        selectedPlan: { ...selectedPlan },
        quote: quote ? { ...quote } : null,
        quoteState,
        healthAnswers: packed,
        documents: { ...documents },
        metadataCanal: metadataCanal ?? undefined,
      });

      setFuneral(mapHealthToFuneral(byInsured));
      setHealthModalOpen(false);
      const verdict = (scoring as { verdict?: string }).verdict;
      const verdictMessage = (scoring as { verdictMessage?: string }).verdictMessage;
      setPendingSubmission({
        id: submission.id,
        scoreTotal: scoring.total ?? submission.scoreTotal,
        verdict,
        message: verdictMessage,
      });

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
        subtitle="Planes funerarios para proteger a tu grupo familiar."
        helpSubject="Suscripción Funerario - Soporte"
        onContinuar={() => { void handleContinuar(); }}
        hideContinuar={Boolean(pendingSubmission)}
        continuarBusy={validatingEmit}
      >
        <FuneralPlansStep />
      </EmissionPlanShell>

      {selectedPlan && (
        <FuneralHealthModal
          open={healthModalOpen}
          plan={selectedPlan}
          quote={quote}
          frecuenciaLabel={FREC_LABELS[funeral.frecuencia ?? 'A'] ?? 'Pago anual'}
          questions={healthQuestions}
          loadingQuestions={loadingQuestions}
          insureds={healthInsureds}
          initialByInsured={funeral.healthAnswersByInsured}
          saving={savingHealth}
          onClose={() => !savingHealth && setHealthModalOpen(false)}
          onConfirm={handleHealthConfirm}
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
