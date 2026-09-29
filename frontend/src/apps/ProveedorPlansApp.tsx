import { useState } from 'react';
import { ProveedorStep } from '../features/plans/ProveedorStep';
import { useWizardStore } from '../store/wizardStore';
import { toast } from '../store/toastStore';
import { EmissionPlanShell } from './EmissionPlanShell';
import { CheckCircle, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/Button';

/**
 * Paso 4 — Plan con Proveedor de Servicio.
 * Vista autónoma sin requerir tokens de autenticación para pruebas y validación.
 */
export default function ProveedorPlansApp() {
  const {
    selectedPlan,
    cproveedor,
    xproveedor,
    funeral,
  } = useWizardStore();

  const [confirmed, setConfirmed] = useState(false);

  function handleContinuar() {
    if (!selectedPlan) {
      toast.warning('Plan requerido', 'Por favor selecciona un plan para continuar.');
      return;
    }

    if (!cproveedor) {
      toast.warning('Proveedor requerido', 'Por favor selecciona un proveedor de servicio.');
      return;
    }

    toast.success(
      '¡Plan y Proveedor listos!',
      `Plan: ${selectedPlan.name} · Proveedor: ${xproveedor || cproveedor} (cproveedor: ${cproveedor})`,
      6000,
    );

    if (typeof window !== 'undefined' && window.__bridgeAdvance) {
      void window.__bridgeAdvance({
        cproveedor: String(cproveedor),
        xproveedor,
        selectedPlan,
      });
    } else {
      setConfirmed(true);
    }
  }

  return (
    <>
      <EmissionPlanShell
        eyebrow="Paso 04 · Plan y Proveedor"
        title="Planes con Proveedor de Servicio"
        subtitle="Selecciona el plan que mejor se adapte a tus necesidades y elige tu proveedor de salud o asistencia."
        helpSubject="Suscripción Proveedor - Soporte"
        onContinuar={handleContinuar}
        continuarLabel="Confirmar y Continuar"
      >
        <ProveedorStep />

        {confirmed && (
          <div className="mt-6 p-5 rounded-2xl bg-emerald-50 border-2 border-emerald-200 text-emerald-950 animate-spring-in">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white grid place-items-center shrink-0 shadow-md shadow-emerald-200">
                <CheckCircle size={22} strokeWidth={2.5} />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-base text-emerald-900 flex items-center gap-2">
                  <ShieldCheck size={18} className="text-emerald-600" />
                  Emisión Validada Correctamente
                </h4>
                <p className="text-xs text-emerald-800 mt-1 leading-relaxed">
                  Los datos del formulario fueron preparados y empaquetados para el envío:
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
    </>
  );
}
