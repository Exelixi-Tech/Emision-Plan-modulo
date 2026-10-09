import { useState, useEffect } from 'react';
import { useSessionTokenDelegation } from './hooks/useSessionTokenDelegation';
import { isFunerario, isPatrimoniales } from './lib/product';
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
  return isFunerario() ? 'funerario' : 'rcv';
}

/**
 * Enrutador por producto.
 */
export default function App() {
  useSessionTokenDelegation();

  const [activeFlow, setActiveFlow] = useState<FlowType>(resolveInitialFlow);

  useEffect(() => {
    const onPopState = () => {
      setActiveFlow(resolveInitialFlow());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleSelectFlow = (flow: FlowType) => {
    setActiveFlow(flow);

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('flow', flow);
      window.history.pushState({}, '', url.toString());
    } catch {
      /* ignore */
    }
  };

  const renderApp = () => {
    switch (activeFlow) {
      case 'proveedor':
        return <ProveedorPlansApp />;
      case 'exelixi':
        return <ExelixiCatalogPlansApp />;
      case 'funerario':
        return <FuneralPlansApp />;
      case 'rcv':
      default:
        return <RcvPlansApp />;
    }
  };

  return (
    <>
      {renderApp()}
      {import.meta.env.DEV && (
        <DevFlowSwitcher currentFlow={activeFlow} onSelectFlow={handleSelectFlow} />
      )}
    </>
  );
}
