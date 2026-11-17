import { CalendarClock, ChevronDown, ShieldCheck } from 'lucide-react';
import type { OpcionVista, VistaCotizacion } from '../../lib/rcv-cotizacion-api';
import { computePrimerRecibo, type DatosFaltantes } from '../../lib/rcv-cotizacion-calc';
import { formatQuoteTasa, formatQuoteUsdMoney, formatQuoteVesLabel } from '../../lib/money';
import { InfoCard, InfoRow, SectionTitle, fmtFecha } from './parts';

interface Props {
  vista: VistaCotizacion;
  opcion: OpcionVista;
  frecuencia: string;
  onFrecuencia: (code: string) => void;
  form: DatosFaltantes;
}

/** Pantalla 3 — Frecuencia de pago y resumen; el monto a pagar es el del primer recibo. */
export function FrecuenciaResumenStep({ vista, opcion, frecuencia, onFrecuencia, form }: Props) {
  const c = vista.cotizacion;
  const frec = vista.frecuencias.find((f) => f.code === frecuencia);
  const m = computePrimerRecibo({
    annualUsd: opcion.primaUsd,
    rcvBasicoUsd: opcion.rcvBasicoUsd,
    frecuencia,
    ptasa: vista.ptasa,
  });
  const hasVes = m.ptasa > 0;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <label className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-2 inline-flex items-center gap-1.5">
          <CalendarClock size={11} className="text-emerald-500" />
          Frecuencia de pago
        </label>
        <div className="relative">
          <select
            value={frecuencia}
            onChange={(e) => onFrecuencia(e.target.value)}
            className="w-full pl-4 pr-10 py-3.5 rounded-xl border-2 border-slate-200 bg-white text-sm font-bold text-slate-900 appearance-none cursor-pointer hover:border-indigo-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all"
          >
            {vista.frecuencias.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
          </select>
          <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        </div>
      </div>

      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-700 p-5 sm:p-6 text-white shadow-[0_18px_40px_rgba(79,70,229,0.35)]">
        <div className="flex items-center justify-between mb-4">
          <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest">
            <ShieldCheck size={14} /> Total a pagar hoy
          </span>
          <span className="text-[0.65rem] font-black text-emerald-200 bg-emerald-500/25 px-2.5 py-1 rounded-md ring-1 ring-emerald-300/40 tracking-wider">
            {m.cuotas > 1 ? '1ER RECIBO' : 'PAGO ÚNICO'}
          </span>
        </div>
        <p className="font-display font-black text-[2.3rem] leading-none tabular-nums">{formatQuoteUsdMoney(m.primerUsd)}</p>
        {hasVes && <p className="text-sm font-bold text-indigo-200 tabular-nums mt-1">≈ {formatQuoteVesLabel(m.primerVes)}</p>}
        <div className="space-y-2 text-sm mt-4">
          <div className="flex justify-between"><span className="text-white/75">Prima anual cotizada</span><span className="font-bold tabular-nums">{formatQuoteUsdMoney(m.annualUsd)}</span></div>
          {m.cuotas > 1 && (
            <>
              {m.rcvInicialUsd > 0 && (
                <div className="flex justify-between"><span className="text-white/75">RCV básico (completo en el 1er recibo)</span><span className="font-bold tabular-nums">{formatQuoteUsdMoney(m.rcvInicialUsd)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-white/75">Recibos 2 a {m.cuotas}</span><span className="font-bold tabular-nums">{formatQuoteUsdMoney(m.siguienteUsd)} c/u</span></div>
            </>
          )}
          {hasVes && (
            <div className="flex justify-between pt-2 border-t border-white/15"><span className="text-white/65">Tasa de cambio (referencial)</span><span className="tabular-nums">{formatQuoteTasa(m.ptasa)}</span></div>
          )}
        </div>
        <p className="text-[0.7rem] text-white/60 mt-3">El monto en Bs se confirma con la tasa del día al pasar al pago.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <InfoCard title="Póliza" locked>
          <InfoRow label="Plan" value={c.plan?.nombre} />
          <InfoRow label="Opción" value={`${opcion.opcion} · Solo RCV`} />
          <InfoRow label="Vigencia" value={`${fmtFecha(vista.vigenciaEmision.fdesde)} al ${fmtFecha(vista.vigenciaEmision.fhasta)}`} />
          <InfoRow label="Frecuencia" value={frec?.label ?? frecuencia} />
        </InfoCard>
        <InfoCard title="Vehículo">
          <InfoRow label="Vehículo" value={`${c.vehiculo.marca?.nombre ?? ''} ${c.vehiculo.modelo?.nombre ?? ''} ${c.vehiculo.anio ?? ''}`.trim()} />
          <InfoRow label="Placa" value={form.placa} />
          <InfoRow label="Serial carrocería" value={form.serial} />
          <InfoRow label="Color" value={form.color} />
        </InfoCard>
        <InfoCard title="Tomador">
          <InfoRow label="Documento" value={`${c.tomador?.tipoDoc}-${c.tomador?.documento}`} />
          <InfoRow label="Nombre" value={c.tomador?.nombre} />
          <InfoRow label="Correo" value={form.email} />
          <InfoRow label="Teléfono" value={form.telefono} />
        </InfoCard>
        <InfoCard title="Asegurado y conductor">
          <InfoRow label="Asegurado" value={form.sameInsured ? 'El mismo tomador' : `${form.asegurado.nombre} ${form.asegurado.apellido} (${form.asegurado.tipoDoc}-${form.asegurado.identificacion})`} />
          <InfoRow label="Conductor habitual" value={form.hasDriver ? `${form.conductor.nombre} ${form.conductor.apellido}` : 'No'} />
          <InfoRow label="Dirección" value={[form.direccion, form.ciudad, form.estado].filter(Boolean).join(', ')} />
        </InfoCard>
      </div>

      <SectionTitle>La póliza se emite al confirmar el pago.</SectionTitle>
    </div>
  );
}
