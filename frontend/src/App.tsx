import { useSessionTokenDelegation } from './hooks/useSessionTokenDelegation';
import { isFunerarioLike, isPatrimoniales } from './lib/product';
import { isExelixiCatalogFlow } from './lib/exelixi-catalog';
import RcvPlansApp from './apps/RcvPlansApp';
import FuneralPlansApp from './apps/FuneralPlansApp';
import PatrimonialPlansApp from './apps/PatrimonialPlansApp';
import ExelixiCatalogPlansApp from './apps/ExelixiCatalogPlansApp';

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
  return <RcvPlansApp />;
}
