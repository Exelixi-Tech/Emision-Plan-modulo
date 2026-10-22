import { useEffect, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { useWizardStore } from '../../store/wizardStore';
import { getBrokers, type CatalogItem } from '../../lib/api';
import { SearchSelect } from '../../components/ui/SearchSelect';
import {
  getEffectiveSsoMetadata,
  shouldShowProductorSelector,
  initialProductorId,
} from '../../lib/productor-selector';

export interface ProductorSelectorProps {
  /** Productor actualmente seleccionado (opcional; si no se pasa, se inicializa desde la sesión/store) */
  selectedProductorId?: string;
  /** Callback cuando el usuario selecciona un productor */
  onSelectProductor?: (productorId: string, label: string) => void;
  className?: string;
}

/**
 * Componente compartido para selección de Productor / Intermediario Sis2000.
 * Se muestra únicamente en sesiones Backoffice (roles internos no productores) o Marketplace
 * con productor genérico (80080 o vacío).
 */
export function ProductorSelector({
  selectedProductorId,
  onSelectProductor,
  className = '',
}: ProductorSelectorProps) {
  const metadataCanal = useWizardStore((s) => s.metadataCanal);
  const rcv = useWizardStore((s) => s.rcv);

  const effectiveMeta = {
    ...getEffectiveSsoMetadata(),
    ...(metadataCanal || {}),
  };
  const showSelector = shouldShowProductorSelector(effectiveMeta);

  const [brokers, setBrokers] = useState<CatalogItem[]>([]);
  const [brokersLoading, setBrokersLoading] = useState(false);

  useEffect(() => {
    if (!showSelector) return;
    let cancelled = false;
    setBrokersLoading(true);
    getBrokers()
      .then((items) => {
        if (!cancelled) setBrokers(items);
      })
      .catch((err) => {
        console.error('Error cargando productores:', err);
      })
      .finally(() => {
        if (!cancelled) setBrokersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showSelector]);

  if (!showSelector) return null;

  const currentId =
    selectedProductorId !== undefined
      ? selectedProductorId
      : initialProductorId(effectiveMeta, rcv?.cproductor);

  const handleSelect = (val: string, lbl: string) => {
    const store = useWizardStore.getState();
    store.setMetadataCanal({
      ...(store.metadataCanal || {}),
      cproductor: val,
      centidad: 'P',
      citem: val,
      xproductor: lbl,
      /** El servidor emite con este productor (no con el del token) si el rol es técnico. */
      productorSeleccionado: true,
    });
    store.setRcv({
      cproductor: val,
      xproductor: lbl,
    });
    store.setSelectedPlan(null);
    onSelectProductor?.(val, lbl);
  };

  return (
    <div
      className={`rounded-2xl border-2 border-indigo-100 bg-gradient-to-r from-indigo-50/60 via-white to-violet-50/40 p-4 sm:p-5 shadow-sm ${className}`.trim()}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <label className="text-[0.68rem] font-black text-indigo-950 uppercase tracking-widest inline-flex items-center gap-1.5">
          <UserCheck size={14} className="text-indigo-600" />
          Productor asociado a la póliza *
        </label>
        {currentId && (
          <span className="text-[0.65rem] font-bold text-indigo-700 bg-indigo-100/80 px-2 py-0.5 rounded-full">
            Cód: {currentId}
          </span>
        )}
      </div>
      <SearchSelect
        options={brokers.map((b) => ({ value: String(b.code), label: `${b.code} - ${b.label}` }))}
        value={currentId || undefined}
        onChange={(val, lbl) => handleSelect(val, lbl)}
        placeholder="Seleccione el productor..."
        loading={brokersLoading}
        disabled={brokersLoading}
        noOptionsText="No se encontraron productores"
      />
      {!currentId ? (
        <p className="text-[0.72rem] font-semibold text-amber-700 mt-2">
          Selecciona el productor para consultar y calcular los planes autorizados para la emisión.
        </p>
      ) : (
        <p className="text-[0.72rem] font-medium text-slate-500 mt-1.5">
          La póliza emitida quedará asociada a este productor en Sis2000.
        </p>
      )}
    </div>
  );
}
