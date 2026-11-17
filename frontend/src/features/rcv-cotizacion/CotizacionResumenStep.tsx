import { Car, CalendarRange, FileText, ShieldCheck, User, Check } from 'lucide-react';
import type { VistaCotizacion } from '../../lib/rcv-cotizacion-api';
import { formatQuoteUsdMoney } from '../../lib/money';
import { AlertBox, InfoCard, InfoRow, SectionTitle, fmtFecha } from './parts';

interface Props {
  vista: VistaCotizacion;
  opcion: number | null;
  onOpcion: (opcion: number) => void;
}

/** Pantalla 1 — Resumen de la cotización (plan, vehículo, tomador, vigencia y opciones con prima). */
export function CotizacionResumenStep({ vista, opcion, onOpcion }: Props) {
  const c = vista.cotizacion;
  const v = c.vehiculo;
  const vig = vista.vigenciaEmision;

  return (
    <div className="animate-fade-in space-y-6">
      {!vista.emitible && (
        <AlertBox title="Esta cotización no se puede emitir aquí">
          <ul className="list-disc pl-5 space-y-1">
            {vista.motivos.map((m) => <li key={`${m.codigo}-${m.mensaje}`}>{m.mensaje}</li>)}
          </ul>
        </AlertBox>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <InfoCard title="Cotización" icon={<FileText size={11} className="text-indigo-500" />}>
          <InfoRow label="Número" value={c.codigo || String(c.cproces)} />
          <InfoRow label="Creada" value={fmtFecha(c.creadaEn)} />
          <InfoRow label="Vence" value={c.venceEl ? `${fmtFecha(c.venceEl)}${c.vencida ? ' (vencida)' : ''}` : '—'} />
          {c.productor?.nombre && <InfoRow label="Asesor de seguros" value={c.productor.nombre} />}
        </InfoCard>

        <InfoCard title="Plan" icon={<ShieldCheck size={11} className="text-emerald-500" />} locked>
          <InfoRow label="Plan" value={c.plan?.nombre || String(c.plan?.codigo ?? '')} />
          <InfoRow label="Código" value={String(c.plan?.codigo ?? '')} />
        </InfoCard>

        <InfoCard title="Vehículo" icon={<Car size={11} className="text-indigo-500" />} locked>
          <InfoRow label="Marca / modelo" value={`${v.marca?.nombre ?? ''} ${v.modelo?.nombre ?? ''}`.trim()} />
          <InfoRow label="Versión" value={v.version?.nombre} />
          <InfoRow label="Año" value={String(v.anio ?? '')} />
          {v.uso?.nombre && <InfoRow label="Uso" value={v.uso.nombre} />}
          {v.tipo?.nombre && <InfoRow label="Tipo" value={v.tipo.nombre} />}
          {Number(v.puestos) > 0 && <InfoRow label="Puestos" value={String(v.puestos)} />}
        </InfoCard>

        <InfoCard title="Tomador" icon={<User size={11} className="text-indigo-500" />} locked>
          <InfoRow label="Documento" value={`${c.tomador?.tipoDoc ?? ''}-${c.tomador?.documento ?? ''}`} />
          <InfoRow label="Nombre" value={c.tomador?.nombre} />
        </InfoCard>

        <InfoCard title="Vigencia" icon={<CalendarRange size={11} className="text-emerald-500" />} locked>
          <InfoRow label="Desde" value={fmtFecha(vig.fdesde)} />
          <InfoRow label="Hasta" value={fmtFecha(vig.fhasta)} />
          {vig.ajustada && (
            <p className="text-[0.72rem] text-amber-700 font-semibold pt-1">
              La vigencia cotizada empezaba el {fmtFecha(c.vigencia?.desde)}; la póliza inicia hoy por el mismo plazo ({vig.dias} días).
            </p>
          )}
        </InfoCard>
      </div>

      {vista.opciones.length > 0 && (
        <div>
          <SectionTitle icon={<ShieldCheck size={11} className="text-indigo-500" />}>
            {vista.opciones.length > 1 ? 'Elige la opción a emitir' : 'Opción cotizada'}
          </SectionTitle>
          <div className="grid gap-3">
            {vista.opciones.map((o) => {
              const selected = opcion === o.opcion;
              return (
                <button
                  key={o.opcion}
                  type="button"
                  disabled={!vista.emitible}
                  onClick={() => onOpcion(o.opcion)}
                  className={`text-left rounded-2xl border-2 p-4 sm:p-5 transition-all ${
                    selected
                      ? 'border-indigo-500 bg-gradient-to-br from-indigo-50 to-violet-50 shadow-[0_8px_22px_rgba(79,70,229,0.15)]'
                      : 'border-slate-200 bg-white hover:border-indigo-300'
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <span className="inline-flex items-center gap-2 font-black text-slate-900">
                      <span className={`w-6 h-6 rounded-full grid place-items-center ${selected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        <Check size={13} strokeWidth={3} />
                      </span>
                      Opción {o.opcion} · Solo RCV
                    </span>
                    <span className="font-display font-black text-xl text-slate-900 tabular-nums">
                      {formatQuoteUsdMoney(o.primaUsd)}
                      <span className="text-xs text-slate-500 font-semibold"> / año</span>
                    </span>
                  </div>
                  <div className="space-y-1">
                    {o.coberturas.map((cob) => (
                      <div key={`${o.opcion}-${cob.codigo}`} className="flex items-center justify-between gap-3 text-[0.8rem]">
                        <span className="text-slate-600 min-w-0 truncate">{cob.nombre}</span>
                        <span className="tabular-nums font-semibold text-slate-800">{formatQuoteUsdMoney(cob.primaUsd)}</span>
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
