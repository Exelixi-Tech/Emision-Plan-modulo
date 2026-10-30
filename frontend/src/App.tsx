import { useState } from 'react';
import { useSessionTokenDelegation } from './hooks/useSessionTokenDelegation';
import { isFunerarioLike, isPatrimoniales } from './lib/product';
import { getProductId, isCombinadoFamiliar } from './lib/product';
import { isExelixiCatalogFlow } from './lib/exelixi-catalog';
import { resolveSsoCproducto } from './lib/api';
import RcvPlansApp from './apps/RcvPlansApp';
import FuneralPlansApp from './apps/FuneralPlansApp';
import PatrimonialPlansApp from './apps/PatrimonialPlansApp';
import ExelixiCatalogPlansApp from './apps/ExelixiCatalogPlansApp';
import ProveedorPlansApp from './apps/ProveedorPlansApp';
import { DevFlowSwitcher } from './components/DevFlowSwitcher';

type FlowType = 'proveedor' | 'funerario' | 'rcv' | 'exelixi';

const PROVEEDOR_PRODUCTS = new Set(['proveedor', 'combinado_familiar']);
/**
 * cproducto Sis2000 que abren Plan Proveedor (Combinado Familiar = 51).
 * Interruptor del flujo: VACIO por defecto => desactivado y todo sigue igual que antes (Combinado
 * se emite por el flujo de personas). En QA se activa con VITE_LAMUNDIAL_PRODUCTOS_PROVEEDOR=51 en
 * frontend/.env.production.local (no versionado) y se recompila; produccion, cuando se apruebe.
 */
const PROVEEDOR_CPRODUCTOS = new Set(
  String(import.meta.env.VITE_LAMUNDIAL_PRODUCTOS_PROVEEDOR || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

/** Plan Proveedor / Combinado Familiar: cproducto SSO 51, producto proveedor/combinado familiar o `?flow=proveedor`. */
function isProveedorFlow(): boolean {
  // Desactivado (variable vacia): ni el cproducto, ni el producto, ni ?flow= abren el flujo nuevo.
  if (PROVEEDOR_CPRODUCTOS.size === 0) return false;
  if (PROVEEDOR_CPRODUCTOS.has(resolveSsoCproducto())) return true;
  if (PROVEEDOR_PRODUCTS.has(getProductId())) return true;
  if (isCombinadoFamiliar()) return true;
  try {
    const flow = (new URLSearchParams(window.location.search).get('flow') || '').toLowerCase();
    return flow === 'proveedor' || flow === 'plan-proveedor' || flow === 'proveedores' || flow === 'combinado_familiar';
  } catch {
    return false;
  }
}

/** Solo desarrollo local: selector manual de flujo (no se compila en QA/producción). */
function DevApp() {
  const [flow, setFlow] = useState<FlowType>(isProveedorFlow() ? 'proveedor' : 'rcv');
  const app = {
    proveedor: <ProveedorPlansApp />,
    exelixi: <ExelixiCatalogPlansApp />,
    funerario: <FuneralPlansApp />,
    rcv: <RcvPlansApp />,
  }[flow];
  return (
    <>
      {app}
      <DevFlowSwitcher currentFlow={flow} onSelectFlow={setFlow} />
    </>
  );
}

/**
 * Enrutador por producto — RCV, funerario/vida/AP, patrimoniales y catálogo Exélixi en apps aisladas.
 * Plan proveedor / Combinado Familiar: solo si VITE_LAMUNDIAL_PRODUCTOS_PROVEEDOR esta activa.
 * El flujo La Mundial no importa lógica del catálogo Exélixi.
 * Productos personas (wizard FuneralPlansApp): funerario (57), vida (76), ap (78), ap79 (79).
 */
export default function App() {
  useSessionTokenDelegation();
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('devflow')) return <DevApp />;
  if (isExelixiCatalogFlow()) return <ExelixiCatalogPlansApp />;
  if (isProveedorFlow()) return <ProveedorPlansApp />;
  if (isFunerarioLike()) return <FuneralPlansApp />;
  if (isPatrimoniales()) return <PatrimonialPlansApp />;
  return <RcvPlansApp />;
}
