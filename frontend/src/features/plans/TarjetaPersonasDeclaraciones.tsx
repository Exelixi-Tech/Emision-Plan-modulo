import { useState } from 'react';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { getTarjetaTerminosUrl } from '../../lib/tarjeta-terminos';

/**
 * Declaraciones de la emisión de personas por tarjeta (definición La Mundial, 22-oct-2026).
 * Reemplazan al cuestionario de salud: es el único "scoring" del flujo de tarjeta.
 * Mismos campos que SysIP (ventacards): dec_persona_politica, dec_term_y_cod,
 * dec_diagnos_enferm y dec_descrip_enferm → @cpersona_politica, @cterm_y_cod,
 * @cdiagnos_enferm y @xdiagnos_enferm del pre-SP de personas.
 */
export interface TarjetaPersonasDeclaracionesResult {
  personaPoliticamenteExpuesta: boolean;
  aceptaMecanismos: boolean;
  buenaSalud: boolean;
  detalleSalud: string;
}

export const TARJETA_DECLARACIONES_PENDIENTES =
  'Para emitir debes responder la pregunta 1, aceptar los mecanismos electrónicos y los términos, y aceptar la declaración de salud.';

const PEP_CONCEPTO_URL = 'https://es.wikipedia.org/wiki/Persona_expuesta_pol%C3%ADticamente';
const DETALLE_MAX = 1000;

type Props = {
  open: boolean;
  saving?: boolean;
  onClose: () => void;
  onConfirm: (result: TarjetaPersonasDeclaracionesResult) => void;
};

export function TarjetaPersonasDeclaraciones({ open, saving = false, onClose, onConfirm }: Props) {
  const [pep, setPep] = useState<'si' | 'no' | ''>('');
  const [aceptaMecanismos, setAceptaMecanismos] = useState(false);
  const [buenaSalud, setBuenaSalud] = useState(false);
  const [detalleSalud, setDetalleSalud] = useState('');

  if (!open) return null;

  const terminosUrl = getTarjetaTerminosUrl();
  // Para emitir: responder la pregunta 1 (Sí o No, queda registrada) y aceptar las dos declaraciones.
  const listo = pep !== '' && aceptaMecanismos && buenaSalud;

  function confirmar() {
    onConfirm({
      personaPoliticamenteExpuesta: pep === 'si',
      aceptaMecanismos,
      buenaSalud,
      detalleSalud: detalleSalud.trim().slice(0, DETALLE_MAX),
    });
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#091133]/50 backdrop-blur-sm">
      <div className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl animate-fade-in">
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-3 border-b border-slate-100">
          <div>
            <p className="text-[0.62rem] font-black text-indigo-600 uppercase tracking-widest">Declaraciones</p>
            <h2 className="text-lg font-black text-slate-900">Antes de emitir tu póliza</h2>
          </div>
          <button type="button" onClick={() => !saving && onClose()} className="p-2 rounded-xl hover:bg-slate-100" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-4 space-y-4">
          {/* Pregunta 1 · PEP */}
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-5">
            <p className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-1">Pregunta 1 de 3</p>
            <p className="text-sm font-bold text-slate-900 mb-3">
              ¿Es usted o alguien de su círculo cercano una persona expuesta políticamente?{' '}
              <a href={PEP_CONCEPTO_URL} target="_blank" rel="noopener noreferrer" className="font-bold text-indigo-600 underline">
                Ver concepto
              </a>
            </p>
            <div role="radiogroup" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                { value: 'no', label: 'No' },
                { value: 'si', label: 'Sí' },
              ] as const).map((op) => (
                <label
                  key={op.value}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-sm font-bold cursor-pointer transition-all ${
                    pep === op.value
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="tarjeta-pep"
                    value={op.value}
                    checked={pep === op.value}
                    onChange={() => setPep(op.value)}
                    className="h-4 w-4 accent-indigo-600"
                  />
                  {op.label}
                </label>
              ))}
            </div>
          </div>

          {/* Pregunta 2 · Mecanismos electrónicos */}
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-5">
            <p className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-2">Pregunta 2 de 3 · Mecanismos electrónicos</p>
            <label className="flex gap-3 items-start cursor-pointer">
              <input
                type="checkbox"
                checked={aceptaMecanismos}
                onChange={(e) => setAceptaMecanismos(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-indigo-600"
              />
              <span className="text-sm text-slate-700 leading-relaxed">
                Declaro que acepto todos los mecanismos electrónicos dispuestos por La Mundial de Seguros C.A.,
                para la contratación de la presente póliza.
                {terminosUrl && (
                  <>
                    {' '}
                    <a
                      href={terminosUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-indigo-600 underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Ver términos y condiciones
                    </a>
                  </>
                )}
              </span>
            </label>
          </div>

          {/* Pregunta 3 · Salud */}
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 sm:p-5">
            <p className="text-[0.62rem] font-black text-slate-500 uppercase tracking-widest mb-2">Pregunta 3 de 3 · Declaración de salud</p>
            <label className="flex gap-3 items-start cursor-pointer">
              <input
                type="checkbox"
                checked={buenaSalud}
                onChange={(e) => setBuenaSalud(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-indigo-600"
              />
              <span className="text-sm text-slate-700 leading-relaxed">
                Declaro que no conozco, ni he sido diagnosticado con alguna enfermedad o condición grave de salud
                que ponga en riesgo mi integridad física o mi vida. Por lo que afirmo que me encuentro en buen
                Estado de Salud.
              </span>
            </label>
            <textarea
              value={detalleSalud}
              onChange={(e) => setDetalleSalud(e.target.value.slice(0, DETALLE_MAX))}
              rows={3}
              placeholder="Información declarada por el asegurado (opcional)"
              className="mt-3 w-full rounded-xl border-2 border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            />
          </div>

          {!listo && (
            <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-600" />
              <p>{TARJETA_DECLARACIONES_PENDIENTES}</p>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex flex-col-reverse sm:flex-row gap-3 justify-end px-5 sm:px-6 py-4 border-t border-slate-100 bg-white">
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="px-4 py-3 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Volver
          </button>
          <button
            type="button"
            disabled={saving || !listo}
            onClick={confirmar}
            className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-black text-white ${
              listo ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-400'
            } disabled:opacity-60`}
          >
            <ShieldCheck size={16} />
            {saving ? 'Procesando…' : 'Confirmar declaraciones'}
          </button>
        </div>
      </div>
    </div>
  );
}
