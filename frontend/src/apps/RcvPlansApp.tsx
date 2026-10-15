import { useCallback, useEffect, useState } from 'react';
import { PlansStep } from '../features/plans/PlansStep';
import { useWizardStore } from '../store/wizardStore';
import { toast } from '../store/toastStore';
import { validatePlanReady } from '../lib/planContinue';
import { isCotizadorFlow } from '../lib/cotizador-flow';
import { continueTarjetaToPagos, shouldUseTarjetaPublicApi } from '../lib/rcv-tarjeta-flow';
import { EmissionPlanShell } from './EmissionPlanShell';
import { getEffectiveSsoMetadata, shouldShowProductorSelector } from '../lib/productor-selector';

/**
 * Paso 4 — RCV únicamente.
 * Sin imports de funerario, cuestionario de salud ni API /funeral.
 */
export default function RcvPlansApp() {
  const {
    category, selectedPlan, quoteState, quote, goTo,
  } = useWizardStore();
  const cotizador = isCotizadorFlow();
  // Flujo tarjeta: el plan lo define la tarjeta → no se muestra este paso.
  const [tarjetaAuto, setTarjetaAuto] = useState(() => !cotizador && shouldUseTarjetaPublicApi());

  const handleTarjetaAutoReady = useCallback(() => {
    const s = useWizardStore.getState();
    if (!validatePlanReady(s.category, s.selectedPlan, s.quoteState, s.quote)) {
      setTarjetaAuto(false);
      return;
    }
    continueTarjetaToPagos();
  }, []);
  const handleTarjetaAutoFallback = useCallback(() => setTarjetaAuto(false), []);

  useEffect(() => {
    if (cotizador) goTo(4);
  }, [cotizador, goTo]);

  function handleContinuar() {
    if (cotizador) {
      const meta = getEffectiveSsoMetadata();
    if (shouldShowProductorSelector(meta)) {
      const snap = useWizardStore.getState();
      const currentProductor = snap.rcv?.cproductor ?? snap.metadataCanal?.cproductor;
      if (!currentProductor || String(currentProductor).trim() === '80080') {
        toast.warning(
          'Productor requerido',
          'Selecciona el productor al que será asociada la póliza antes de continuar.',
        );
        return;
      }
    }

    if (!validatePlanReady(category, selectedPlan, quoteState, quote)) return;
      const usd = quote?.mprimaext ?? quote?.mprima;
      toast.success(
        'Cotización lista',
        `${selectedPlan!.name}: ${usd != null ? `$${Number(usd).toFixed(2)} USD` : 'prima calculada'}.`,
      );
      return;
    }

    if (!validatePlanReady(category, selectedPlan, quoteState, quote)) return;

    toast.success(
      '¡Plan seleccionado!',
      `Categoría ${category} · Plan ${selectedPlan!.name} listo para emitir.`,
    );
    if (shouldUseTarjetaPublicApi()) {
      continueTarjetaToPagos();
    } else {
      window.__bridgeAdvance?.();
    }
  }

  return (
    <EmissionPlanShell
      eyebrow={cotizador ? 'Paso 02 · Cotización' : undefined}
      title={cotizador ? 'Planes RCV disponibles' : (tarjetaAuto ? 'Preparando tu emisión' : undefined)}
      subtitle={
        cotizador
          ? 'Selecciona un plan para ver la prima cotizada en USD y Bs.'
          : tarjetaAuto
            ? 'Tu plan viene definido por la tarjeta de activación.'
            : 'Categorías diseñadas para cada perfil de uso del vehículo.'
      }
      helpSubject="Suscripción RCV - Soporte"
      onContinuar={handleContinuar}
      continuarLabel={cotizador ? 'Ver cotización' : undefined}
      hideContinuar={tarjetaAuto}
    >
      <PlansStep
        autoContinue={tarjetaAuto}
        onAutoReady={handleTarjetaAutoReady}
        onAutoFallback={handleTarjetaAutoFallback}
      />
    </EmissionPlanShell>
  );
}
