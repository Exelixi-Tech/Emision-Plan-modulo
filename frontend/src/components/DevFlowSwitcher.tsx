import { useState } from 'react';
import { Layers, Check, Sparkles, Building2, Car, Shield, Package, X } from 'lucide-react';

interface Props {
  currentFlow: 'proveedor' | 'funerario' | 'rcv' | 'exelixi';
  onSelectFlow: (flow: 'proveedor' | 'funerario' | 'rcv' | 'exelixi') => void;
}

const FLOWS = [
  {
    id: 'proveedor' as const,
    label: 'Plan Proveedor',
    tag: 'Nuevo',
    desc: 'Selector de plan + Proveedor de Servicio (valrep/proveedores)',
    icon: Building2,
    color: 'from-indigo-500 to-violet-600',
  },
  {
    id: 'funerario' as const,
    label: 'Funerario',
    tag: 'Ramo 9',
    desc: 'Planes de personas La Mundial + Cuestionario',
    icon: Shield,
    color: 'from-violet-500 to-fuchsia-600',
  },
  {
    id: 'rcv' as const,
    label: 'RCV Automóvil',
    tag: 'Ramo 18',
    desc: 'Planes vehiculares y categorías',
    icon: Car,
    color: 'from-blue-500 to-cyan-600',
  },
  {
    id: 'exelixi' as const,
    label: 'Catálogo Exélixi',
    tag: 'Product Builder',
    desc: 'Emisión genérica basada en catálogo',
    icon: Package,
    color: 'from-emerald-500 to-teal-600',
  },
];

export function DevFlowSwitcher({ currentFlow, onSelectFlow }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-[9999] font-sans">
      {open ? (
        <div className="bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl shadow-2xl p-4 w-80 text-white animate-spring-in">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
                <Layers size={16} />
              </span>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-200">
                  Selector de Vistas
                </h4>
                <p className="text-[0.65rem] text-slate-400">Pruebas locales sin tokens SSO</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-1.5">
            {FLOWS.map((f) => {
              const Icon = f.icon;
              const isActive = currentFlow === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    onSelectFlow(f.id);
                    setOpen(false);
                  }}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                    isActive
                      ? 'border-indigo-500 bg-indigo-950/60 text-white shadow-sm'
                      : 'border-slate-800 bg-slate-800/40 hover:bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg grid place-items-center text-white bg-gradient-to-br ${f.color} shadow-xs shrink-0`}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold truncate">{f.label}</span>
                        <span
                          className={`text-[0.6rem] font-bold px-1.5 py-0.2 rounded-md ${
                            isActive
                              ? 'bg-indigo-500 text-white'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {f.tag}
                        </span>
                      </div>
                      <p className="text-[0.65rem] text-slate-400 truncate">{f.desc}</p>
                    </div>
                  </div>
                  {isActive && (
                    <span className="w-5 h-5 rounded-full bg-indigo-500 text-white grid place-items-center shrink-0">
                      <Check size={12} strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-[0.65rem] text-slate-400 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Sparkles size={11} className="text-amber-400" />
              URL: <code className="text-slate-300">?flow={currentFlow}</code>
            </span>
            <span className="text-emerald-400 font-medium">Modo Standalone</span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-slate-900/90 hover:bg-slate-900 text-white border border-slate-700/80 shadow-xl backdrop-blur-md transition-all hover:scale-105 active:scale-95"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-bold flex items-center gap-1.5">
            <Building2 size={13} className="text-indigo-400" />
            Vista: <span className="text-indigo-300 capitalize">{currentFlow}</span>
          </span>
          <span className="text-[0.65rem] font-bold px-1.5 py-0.5 rounded-md bg-indigo-600/80 text-white ml-1">
            Cambiar
          </span>
        </button>
      )}
    </div>
  );
}
