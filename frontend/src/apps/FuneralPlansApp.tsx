import { useEffect, useState } from 'react';
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
import { syncTitularFromTomador } from '../lib/funeral-sync';

const FREC_LABELS: Record<string, string> = {
  M: 'Pago mensual',
  T: 'Pago trimestral',
  C: 'Pago cuatrimestral',
  S: 'Pago semestral',
  A: 'Pago anual',
};

function questionnaireForPlan(
  planCramo: number | undefined,
  meta: { cproducto?: unknown; xproducto?: unknown; cramo?: unknown } | null | undefined,
  fallbackCproducto: string | undefined,
  fallbackCramo: number,
): { cramo: number; cproducto: string } {
  const label = String(meta?.xproducto ?? '').toLowerCase();
  let cproducto = String(meta?.cproducto ?? fallbackCproducto ?? '').trim();
  if (label && !label.includes('funer') && (!cproducto || cproducto === '57')) {
    cproducto = 'otro';
  }
  const plan = Number(planCramo);
  const sso = meta?.cramo != null ? Number(meta.cramo) : NaN;
  const cramo = Number.isFinite(plan) && plan > 0
    ? plan
    : (Number.isFinite(sso) && sso > 0 ? sso : fallbackCramo);
  return { cramo, cproducto };
}


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

/**
 * Como SysIP: los términos solo se exigen si el cuestionario del producto los pregunta.
 * Producto sin pregunta `aceptaTerminos` (ej. Salud Individual) no bloquea en Pagos.
 */
function mapHealthToFuneral(
  byInsured: Record<string, Record<string, unknown>>,
  questions: HealthQuestion[],
) {
  const first = Object.values(byInsured)[0] ?? {};
  const pideTerminos = questions.some((q) => q.id === 'aceptaTerminos');
  return {
    diagnosticoEnfermedad: first.diagnosticoEnfermedad === true,
    descripcionEnfermedad: String(first.descripcionEnfermedad ?? ''),
    aceptaTerminos: pideTerminos ? first.aceptaTerminos === true : true,
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

  useEffect(() => {
    syncTitularFromTomador();
  }, [
    sameInsured,
    tomador.identificacion,
    tomador.nombre,
    tomador.apellido,
    tomador.fechaNac,
    tomador.sexo,
    tomador.telefono,
    tomador.email,
    tomador.estadoCivil,
    tomador.cestado,
    tomador.cciudad,
    tomador.direccion,
    asegurado.identificacion,
    asegurado.nombre,
    asegurado.apellido,
    asegurado.fechaNac,
    asegurado.sexo,
    asegurado.telefono,
    asegurado.email,
    asegurado.estadoCivil,
    asegurado.cestado,
    asegurado.cciudad,
    asegurado.direccion,
    asegurado.peso,
    asegurado.estatura,
  ]);

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

  function emptyAnswersByInsured() {
    const people = healthInsureds.length
      ? healthInsureds
      : [{ key: 'aseg-0', label: 'Asegurado' }];
    const byInsured: Record<string, Record<string, unknown>> = {};
    for (const person of people) byInsured[person.key] = {};
    return byInsured;
  }

  async function openHealthModal() {
    if (!selectedPlan?.cplan) return;
    setLoadingQuestions(true);
    try {
      const { cramo: effectiveCramo, cproducto: effectiveCproducto } = questionnaireForPlan(
        selectedPlan.cramo,
        metadataCanal,
        product.cproducto,
        product.cramo,
      );
      const qs = await fetchFuneralHealthQuestions(selectedPlan.cplan, effectiveCramo, effectiveCproducto);
      setHealthQuestions(qs);
      if (qs.length === 0) {
        setHealthModalOpen(false);
        await handleHealthConfirm(emptyAnswersByInsured(), qs);
        return;
      }
      setHealthModalOpen(true);
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

  async function handleHealthConfirm(
    byInsured: Record<string, Record<string, unknown>>,
    questions: HealthQuestion[] = healthQuestions,
  ) {
    if (!selectedPlan?.cplan) return;
    setSavingHealth(true);
    try {
      const sessionId = getSessionId();
      const packed = { byInsured };

      const { cramo: effectiveCramo, cproducto: effectiveCproducto } = questionnaireForPlan(
        selectedPlan.cramo,
        metadataCanal,
        product.cproducto,
        product.cramo,
      );

      await saveFuneralHealthAnswers({
        sessionId,
        cplan: selectedPlan.cplan,
        cramo: effectiveCramo,
        cproducto: effectiveCproducto,
        tomadorRif: `${tomador.tipoDoc}-${tomador.identificacion}`,
        planName: selectedPlan.name,
        answers: packed,
      });

      const { submission, scoring, quote: quoteAjustada, premiumAdjust } = await submitFuneralPolicyReview({
        sessionId,
        cplan: selectedPlan.cplan,
        cramo: effectiveCramo,
        cproducto: effectiveCproducto,
        tomador: { ...tomador },
        asegurado: { ...asegurado },
        sameInsured,
        hasBeneficiary: hasBeneficiary || (funeral.beneficiarios?.length ?? 0) > 0,
        beneficiario: hasBeneficiary
          ? { ...beneficiario }
          : funeral.beneficiarios?.[0]
            ? { ...funeral.beneficiarios[0] }
            : undefined,
        funeral: { ...funeral, ...mapHealthToFuneral(byInsured, questions) },
        selectedPlan: { ...selectedPlan },
        quote: quote ? { ...quote } : null,
        quoteState,
        healthAnswers: packed,
        documents: { ...documents },
        metadataCanal: metadataCanal ?? undefined,
      });

      setFuneral(mapHealthToFuneral(byInsured, questions));
      // Recargo/descuento por respuestas: Pagos cobra la prima ajustada (misma que emite el servidor).
      if (premiumAdjust && quoteAjustada) {
        const snap = useWizardStore.getState();
        snap.setQuote({ ...(snap.quote ?? quoteAjustada), ...quoteAjustada }, snap.quoteVehicleSignature ?? '');
        const netos = premiumAdjust.porAsegurado.filter((p) => p.netoPct !== 0);
        toast.info(
          'Prima ajustada por el cuestionario',
          netos
            .map((p) => `${p.label}: ${p.netoPct > 0 ? '+' : ''}${p.netoPct}%`)
            .join(' · ') + ` → total ${premiumAdjust.quote.mprimaext.toFixed(2)}`,
          8000,
        );
      }
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
          onConfirm={(byInsured) => handleHealthConfirm(byInsured)}
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
