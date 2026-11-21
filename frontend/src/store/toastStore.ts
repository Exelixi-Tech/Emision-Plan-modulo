/**
 * Wrapper fino sobre `sonner` que mantiene la misma API que el store anterior.
 * Todos los toast.success / toast.error / toast.warning / toast.info
 * del resto del código siguen funcionando sin cambios.
 * En marca neutra (?marca=neutra) se quita «La Mundial» de los textos (incluye errores del server).
 */
import { toast as sonnerToast } from 'sonner';
import { textoSinMarca } from '../lib/marca';

const DEFAULT_DURATION = 4500;

export const toast = {
  success: (title: string, description?: string, duration = DEFAULT_DURATION) =>
    sonnerToast.success(textoSinMarca(title), { description: textoSinMarca(description), duration }),

  error: (title: string, description?: string, duration = DEFAULT_DURATION) =>
    sonnerToast.error(textoSinMarca(title), { description: textoSinMarca(description), duration }),

  warning: (title: string, description?: string, duration = DEFAULT_DURATION) =>
    sonnerToast.warning(textoSinMarca(title), { description: textoSinMarca(description), duration }),

  info: (title: string, description?: string, duration = DEFAULT_DURATION) =>
    sonnerToast.info(textoSinMarca(title), { description: textoSinMarca(description), duration }),

  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
};
