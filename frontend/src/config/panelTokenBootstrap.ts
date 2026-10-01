/**
 * Iframe SysIP: el ?token= del config.json suele estar firmado con un JWT_SECRET
 * viejo. Emisión pide uno fresco a Nexus (vía emision-api + NEXUS_API_KEY).
 */
import { moduleApiBase } from '../lib/app-base';

export type PanelBootstrapKind = 'revision' | 'preguntas' | 'config';

export async function bootstrapPanelToken(opts: {
  panel: PanelBootstrapKind;
  empresaId?: number;
}): Promise<string | null> {
  try {
    const panel =
      opts.panel === 'config' || opts.panel === 'preguntas' ? 'preguntas' : 'revision';
    const qs = new URLSearchParams({
      panel,
      empresaId: String(opts.empresaId && opts.empresaId > 0 ? opts.empresaId : 1),
      producto: 'funerario',
      modulo: 'emision',
    });
    const res = await fetch(`${moduleApiBase()}/revision/panel-token?${qs}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    const token = typeof data.token === 'string' ? data.token.trim() : '';
    if (!res.ok || !token) return null;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('token', token);
      window.history.replaceState({}, '', url.toString());
    } catch {
      /* ignore */
    }
    return token;
  } catch {
    return null;
  }
}
