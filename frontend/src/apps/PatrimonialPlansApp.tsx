import { useEffect } from 'react';
import { PatrimonialPlansStep } from '../features/plans/PatrimonialPlansStep';
import { useWizardStore } from '../store/wizardStore';
import { toast } from '../store/toastStore';
import { validatePlanReady } from '../lib/planContinue';
import { isCotizadorFlow } from '../lib/cotizador-flow';
import { EmissionPlanShell } from './EmissionPlanShell';

/**
 * Paso 4 — Patrimonial (Riesgos Generales, ramo 20).
 * Flujo de selección de plan y cotización con quote-generalRisks.
 */
export default function PatrimonialPlansApp() {
  const {
    category, selectedPlan, quoteState, quote, goTo,
  } = useWizardStore();
  const cotizador = isCotizadorFlow();

  useEffect(() => {
    if (cotizador) goTo(4);
  }, [cotizador, goTo]);

  function handleContinuar() {
    if (cotizador) {
      if (!validatePlanReady(category, selectedPlan, quoteState, quote)) return;
      const usd = quote?.mprimaext ?? quote?.mprima;
      toast.success(
        'Cotización patrimonial lista',
        `${selectedPlan!.name}: ${usd != null ? `$${Number(usd).toFixed(2)} USD` : 'prima calculada'}.`,
      );
      return;
    }

    if (!validatePlanReady(category, selectedPlan, quoteState, quote)) return;

    toast.success(
      '¡Plan patrimonial seleccionado!',
      `Plan ${selectedPlan!.name} listo para emitir.`,
    );
    window.__bridgeAdvance?.();
  }

  return (
    <EmissionPlanShell
      eyebrow={cotizador ? 'Paso 02 · Cotización' : undefined}
      title={cotizador ? 'Planes Patrimoniales disponibles' : undefined}
      subtitle={
        cotizador
          ? 'Selecciona un plan patrimonial para ver la prima cotizada en USD y Bs.'
          : 'Planes diseñados para proteger tus bienes patrimoniales e inmuebles.'
      }
      helpSubject="Suscripción Patrimonial - Soporte"
      onContinuar={handleContinuar}
      continuarLabel={cotizador ? 'Ver cotización' : undefined}
    >
      <PatrimonialPlansStep />
    </EmissionPlanShell>
  );
}
