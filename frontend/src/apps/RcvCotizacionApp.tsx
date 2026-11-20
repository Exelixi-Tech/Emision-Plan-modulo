import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { EmissionPlanShell } from './EmissionPlanShell';
import { useWizardStore } from '../store/wizardStore';
import { toast } from '../store/toastStore';
import { isFrecuenciaFraccionada } from '../lib/frecuencia';
import { formatQuoteUsdMoney } from '../lib/money';
import { formatTelefono } from '../lib/phone';
import bridgeReady from '../lib/bridge';
import {
  CotizacionApiError,
  fetchCotizacionActual,
  prepararCheckoutCotizacion,
  type CheckoutCotizacion,
  type VistaCotizacion,
} from '../lib/rcv-cotizacion-api';
import {
  emptyPersona,
  normalizePlacaInput,
  validarDatosFaltantes,
  type DatosFaltantes,
} from '../lib/rcv-cotizacion-calc';
import { CotizacionResumenStep } from '../features/rcv-cotizacion/CotizacionResumenStep';
import { DatosFaltantesStep } from '../features/rcv-cotizacion/DatosFaltantesStep';
import { FrecuenciaResumenStep } from '../features/rcv-cotizacion/FrecuenciaResumenStep';
import { AlertBox } from '../features/rcv-cotizacion/parts';
import { Button } from '../components/ui/Button';
import type { PersonData, Plan, TomadorData, VehicleData } from '../types';

/**
 * Emitir RCV desde cotización de SysIP. Solo se abre si el nexus_token trae `cotizacionID` (App.tsx);
 * sin ese dato Emisión sigue exactamente igual. Aislado de RcvPlansApp/PlansStep: no los usa.
 *   1. Cotización  2. Datos que faltan  3. Frecuencia y resumen  → Pagos (1er recibo) → emisión post-pago.
 */

type Paso = 1 | 2 | 3;

const SIN_PAGO_TITULO = 'No se pudo conectar con el módulo de pagos';
const SIN_PAGO_DETALLE = 'Por ahora no se puede pagar esta cotización desde aquí. Avisa a soporte para habilitar el pago.';

/** Pagos solo se alcanza con la sesión encadenada de Nexus; sin ella el botón "Ir a pagar" no puede avanzar. */
function hayPagoEncadenado(): boolean {
  return typeof window.__bridgeAdvance === 'function';
}

const PASOS: Record<Paso, { eyebrow: string; title: string; subtitle: string; continuar: string }> = {
  1: {
    eyebrow: 'Paso 1 de 3 · Cotización',
    title: 'Tu cotización RCV',
    subtitle: 'Revisa la cotización. El plan, el vehículo, el tomador y la vigencia vienen de la cotización.',
    continuar: 'Continuar',
  },
  2: {
    eyebrow: 'Paso 2 de 3 · Datos',
    title: 'Completa los datos',
    subtitle: 'Solo te pedimos lo que la cotización no trae.',
    continuar: 'Continuar',
  },
  3: {
    eyebrow: 'Paso 3 de 3 · Pago',
    title: 'Frecuencia y resumen',
    subtitle: 'Elige cómo pagar. Hoy pagas el primer recibo y la póliza se emite al confirmar el pago.',
    continuar: 'Ir a pagar',
  },
};

function initialForm(): DatosFaltantes {
  const s = useWizardStore.getState();
  const t = s.tomador;
  const v = s.vehicle;
  return {
    placa: normalizePlacaInput(v?.placa ?? ''),
    serial: v?.serial ?? '',
    serialMotor: v?.serialMotor ?? '',
    color: v?.color ?? '',
    fechaNac: t?.fechaNac ?? '',
    sexo: t?.sexo ?? '',
    estadoCivil: t?.estadoCivil ?? '',
    direccion: t?.direccion ?? '',
    cestado: t?.cestado,
    estado: t?.estado ?? '',
    cciudad: t?.cciudad,
    ciudad: t?.ciudad ?? '',
    email: t?.email ?? '',
    telefono: t?.telefono ? formatTelefono(t.telefono) : '',
    sameInsured: s.sameInsured !== false,
    asegurado: emptyPersona(),
    hasDriver: false,
    conductor: emptyPersona(),
    personaPoliticamenteExpuesta: Boolean(t?.personaPoliticamenteExpuesta),
    aceptaTerminos: false,
  };
}

function profesionDelForm(form: DatosFaltantes) {
  return {
    cprofesion: form.cprofesion,
    xprofesion: form.xprofesion,
    cocupacion: form.cocupacion,
    xocupacion: form.xocupacion,
    cactividad: form.cactividad,
    xactividad: form.xactividad,
  };
}

/** Deja el wizard como lo espera Pagos (mismo shape que el RCV de siempre) + comprobante de la cotización. */
function aplicarAlWizard(vista: VistaCotizacion, form: DatosFaltantes, co: CheckoutCotizacion) {
  const s = useWizardStore.getState();
  const contacto = {
    direccion: form.direccion.trim(),
    cestado: form.cestado,
    estado: form.estado,
    cciudad: form.cciudad,
    ciudad: form.ciudad,
    telefono: form.telefono,
    email: form.email.trim(),
  };
  const tomador: TomadorData & { aceptaTerminos: boolean; declaraVeracidad: boolean } = {
    ...s.tomador,
    ...co.bloqueados.tomador,
    ...contacto,
    email2: contacto.email,
    fechaNac: form.fechaNac,
    sexo: form.sexo,
    estadoCivil: form.estadoCivil,
    personaPoliticamenteExpuesta: form.personaPoliticamenteExpuesta,
    aceptaTerminos: form.aceptaTerminos,
    declaraVeracidad: form.aceptaTerminos,
    // Profesión (maprofes) y ocupación (maocupac) por separado, como las captura Formulario.
    ...profesionDelForm(form),
    ocupacionSeparada: true,
  };
  const asegurado: PersonData = form.sameInsured
    ? s.asegurado
    : { ...s.asegurado, ...form.asegurado, ...contacto };
  const conductor: PersonData = form.hasDriver ? { ...s.conductor, ...form.conductor } : s.conductor;
  const vehicle: VehicleData = {
    ...s.vehicle,
    ...(co.bloqueados.vehicle as Partial<VehicleData>),
    placa: normalizePlacaInput(form.placa),
    serial: form.serial,
    serialMotor: form.serialMotor,
    color: form.color.trim(),
  };
  const annual = co.montos.annualUsd;
  const selectedPlan: Plan = {
    cplan: co.bloqueados.selectedPlan.cplan,
    name: co.bloqueados.selectedPlan.name,
    price: formatQuoteUsdMoney(annual),
    priceNum: annual,
    tag: 'Cotización SysIP',
    desc: `Cotización ${vista.cotizacion.codigo || vista.cotizacion.cproces} · opción ${co.opcion}`,
    benefits: [],
    sumaAsegurada: 0,
  };

  useWizardStore.setState({
    tomador,
    sameInsured: form.sameInsured,
    asegurado,
    hasDriver: form.hasDriver,
    conductor,
    hasBeneficiary: false,
    vehicle,
    category: 'RCV',
    selectedPlan,
    rcv: {
      ...s.rcv,
      frecuencia: co.frecuencia,
      ndias: co.ndias,
      vigenciaExt: null,
      coberAdicional: 'RC',
      coberAdicionales: [],
      // Comprobante firmado por el server: Pagos lo reenvía en state.rcv al emitir.
      cotizacionRcv: { ticket: co.ticket, cproces: String(vista.cotizacion.cproces), opcion: co.opcion },
    } as typeof s.rcv,
    fraccionado: isFrecuenciaFraccionada(co.frecuencia),
  });
  useWizardStore.getState().setQuote(co.quote, `rcv-cotizacion|${vista.cotizacion.cproces}|${co.opcion}|${co.frecuencia}`);
}

export default function RcvCotizacionApp() {
  const [vista, setVista] = useState<VistaCotizacion | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paso, setPaso] = useState<Paso>(1);
  const [opcion, setOpcion] = useState<number | null>(null);
  const [frecuencia, setFrecuencia] = useState<string>('A');
  const [form, setForm] = useState<DatosFaltantes>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // null mientras el bridge resuelve el auto-arranque con Nexus; después, si hay o no sesión hacia Pagos.
  const [sinPago, setSinPago] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    bridgeReady
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) setSinPago(!hayPagoEncadenado());
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchCotizacionActual()
      .then((v) => {
        if (cancelled) return;
        setVista(v);
        if (v.opciones.length === 1) setOpcion(v.opciones[0].opcion);
        const stored = useWizardStore.getState().rcv?.frecuencia;
        const codes = v.frecuencias.map((f) => f.code);
        setFrecuencia(stored && codes.includes(stored) ? stored : (codes[0] ?? 'A'));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'No pudimos cargar la cotización.');
      });
    return () => { cancelled = true; };
  }, []);

  const opcionSel = useMemo(
    () => vista?.opciones.find((o) => o.opcion === opcion) ?? null,
    [vista, opcion],
  );

  function patchForm(patch: Partial<DatosFaltantes>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function irAPagar() {
    if (!vista || !opcionSel) return;
    if (!hayPagoEncadenado()) {
      setSinPago(true);
      toast.error(SIN_PAGO_TITULO, SIN_PAGO_DETALLE, 8000);
      return;
    }
    setBusy(true);
    try {
      const co = await prepararCheckoutCotizacion({
        opcion: opcionSel.opcion,
        frecuencia,
        vehicle: { placa: normalizePlacaInput(form.placa), serial: form.serial, serialMotor: form.serialMotor },
        tomador: profesionDelForm(form),
      });
      aplicarAlWizard(vista, form, co);
      toast.success('Todo listo', `Primer recibo: ${formatQuoteUsdMoney(co.montos.primerUsd)}. Te llevamos al pago.`);
      await window.__bridgeAdvance();
    } catch (err) {
      const e = err as CotizacionApiError;
      if (e.code === 'LAMUNDIAL_PLATE_ALREADY_INSURED' || e.code === 'INVALID_PLACA_FORMAT' || e.code === 'INVALID_SERIAL_FORMAT') {
        setErrors({ [e.code === 'INVALID_SERIAL_FORMAT' ? 'serial' : 'placa']: e.message });
        setPaso(2);
        toast.warning('Revisa el vehículo', e.message, 9000);
      } else {
        toast.error('No pudimos preparar el pago', e.message || 'Intenta de nuevo.', 9000);
      }
    } finally {
      setBusy(false);
    }
  }

  function handleContinuar() {
    if (!vista) return;
    if (paso === 1) {
      if (!vista.emitible) {
        toast.warning('No se puede emitir', vista.motivos.map((m) => m.mensaje).join(' '), 8000);
        return;
      }
      if (!opcionSel) {
        toast.warning('Elige una opción', 'Selecciona la opción de la cotización que quieres emitir.');
        return;
      }
      setPaso(2);
      return;
    }
    if (paso === 2) {
      const errs = validarDatosFaltantes(form, { tomadorTipoDoc: vista.cotizacion.tomador?.tipoDoc });
      setErrors(errs);
      if (Object.keys(errs).length > 0) {
        toast.warning('Faltan datos', Object.values(errs)[0], 6000);
        return;
      }
      setPaso(3);
      return;
    }
    void irAPagar();
  }

  const cfg = PASOS[paso];
  const ready = Boolean(vista);

  return (
    <EmissionPlanShell
      eyebrow={cfg.eyebrow}
      title={cfg.title}
      subtitle={cfg.subtitle}
      helpSubject="Emisión RCV desde cotización - Soporte"
      onContinuar={handleContinuar}
      continuarLabel={cfg.continuar}
      continuarBusy={busy}
      hideContinuar={!ready || sinPago !== false || (paso === 1 && !vista?.emitible)}
    >
      {ready && sinPago === true && (
        <div className="mb-4">
          <AlertBox title={SIN_PAGO_TITULO} tone="amber">{SIN_PAGO_DETALLE}</AlertBox>
        </div>
      )}
      {!ready && !loadError && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center">
          <Loader2 size={18} className="animate-spin text-indigo-500" />
          Cargando la cotización…
        </div>
      )}
      {loadError && (
        <AlertBox title="No pudimos abrir la cotización">{loadError}</AlertBox>
      )}
      {vista && (
        <>
          {paso > 1 && (
            <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => setPaso((p) => (p - 1) as Paso)} disabled={busy}>
              <ArrowLeft size={14} /> Volver
            </Button>
          )}
          {paso === 1 && <CotizacionResumenStep vista={vista} opcion={opcion} onOpcion={setOpcion} />}
          {paso === 2 && <DatosFaltantesStep vista={vista} form={form} onChange={patchForm} errors={errors} />}
          {paso === 3 && opcionSel && (
            <FrecuenciaResumenStep vista={vista} opcion={opcionSel} frecuencia={frecuencia} onFrecuencia={setFrecuencia} form={form} />
          )}
        </>
      )}
    </EmissionPlanShell>
  );
}
