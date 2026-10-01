import { useSessionTokenDelegation } from './hooks/useSessionTokenDelegation';
import { isFunerario, isPatrimoniales } from './lib/product';
import { isExelixiCatalogFlow } from './lib/exelixi-catalog';
import RcvPlansApp from './apps/RcvPlansApp';
import FuneralPlansApp from './apps/FuneralPlansApp';
import PatrimonialPlansApp from './apps/PatrimonialPlansApp';
import ExelixiCatalogPlansApp from './apps/ExelixiCatalogPlansApp';

/**
 * Enrutador por producto — RCV, funerario, patrimoniales y catálogo Exélixi en apps aisladas.
 * El flujo La Mundial no importa lógica del catálogo Exélixi.
 */
export default function App() {
  useSessionTokenDelegation();
  if (isExelixiCatalogFlow()) return <ExelixiCatalogPlansApp />;
  if (isFunerario()) return <FuneralPlansApp />;
  if (isPatrimoniales()) return <PatrimonialPlansApp />;
  return <RcvPlansApp />;
}
