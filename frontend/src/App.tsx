import { useSessionTokenDelegation } from './hooks/useSessionTokenDelegation';
import { isFunerario, isPatrimonial } from './lib/product';
import { isExelixiCatalogFlow } from './lib/exelixi-catalog';
import RcvPlansApp from './apps/RcvPlansApp';
import FuneralPlansApp from './apps/FuneralPlansApp';
import PatrimonialPlansApp from './apps/PatrimonialPlansApp';
import ExelixiCatalogPlansApp from './apps/ExelixiCatalogPlansApp';

/**
 * Enrutador por producto — RCV, funerario, patrimonial y catálogo Exélixi en apps aisladas.
 */
export default function App() {
  useSessionTokenDelegation();
  if (isExelixiCatalogFlow()) return <ExelixiCatalogPlansApp />;
  if (isFunerario()) return <FuneralPlansApp />;
  if (isPatrimonial()) return <PatrimonialPlansApp />;
  return <RcvPlansApp />;
}

