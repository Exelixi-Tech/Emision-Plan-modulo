import { useState, useEffect } from 'react';
import { useSessionTokenDelegation } from './hooks/useSessionTokenDelegation';
import { isCombinadoFamiliar, isFunerarioLike, isPatrimoniales } from './lib/product';
import { isExelixiCatalogFlow } from './lib/exelixi-catalog';
import RcvPlansApp from './apps/RcvPlansApp';
import FuneralPlansApp from './apps/FuneralPlansApp';
import PatrimonialPlansApp from './apps/PatrimonialPlansApp';
import ExelixiCatalogPlansApp from './apps/ExelixiCatalogPlansApp';
import ProveedorPlansApp from './apps/ProveedorPlansApp';
import { DevFlowSwitcher } from './components/DevFlowSwitcher';

type FlowType = 'proveedor' | 'funerario' | 'rcv' | 'exelixi';

function resolveInitialFlow(): FlowType {
  // El selector por query param solo está habilitado en modo desarrollo
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const flow = (params.get('flow') || params.get('view') || params.get('preview') || '').toLowerCase();
    if (flow === 'proveedor' || flow === 'plan-proveedor' || flow === 'proveedores') return 'proveedor';
    if (flow === 'funerario' || flow === 'funeral') return 'funerario';
    if (flow === 'rcv' || flow === 'auto') return 'rcv';
    if (flow === 'exelixi' || flow === 'exelixi-catalog') return 'exelixi';
  }

  if (isExelixiCatalogFlow()) return 'exelixi';
  return isFunerarioLike() ? 'funerario' : 'rcv';
}

/**
 * Enrutador por producto — RCV, funerario/vida/AP, patrimoniales y catálogo Exélixi en apps aisladas.
 * El flujo La Mundial no importa lógica del catálogo Exélixi.
 * Productos personas (wizard FuneralPlansApp): funerario (57), vida (76), ap (78), ap79 (79).
 */
export default function App() {
  useSessionTokenDelegation();
  if (isExelixiCatalogFlow()) return <ExelixiCatalogPlansApp />;
  if (isFunerarioLike()) return <FuneralPlansApp />;
  if (isPatrimoniales()) return <PatrimonialPlansApp />;
  if (isCombinadoFamiliar()) return <ProveedorPlansApp />;
  return <RcvPlansApp />;
}
