/**
 * Registra póliza emitida en Nexus (admin Tráfico).
 * No debe tumbar la emisión si Nexus falla.
 */

function nexusBases() {
  const primary = (process.env.NEXUS_API_URL || 'http://127.0.0.1:3092').replace(/\/$/, '');
  const bases = [primary];
  if (!primary.includes('127.0.0.1') && !primary.includes('localhost')) {
    bases.push('http://127.0.0.1:3092');
  }
  return bases;
}

function getApiKey() {
  return process.env.NEXUS_API_KEY || process.env.NEXUS_SERVICE_API_KEY || '';
}

function tomadorNombre(state) {
  const t = state?.tomador || {};
  return [t.nombre, t.apellido].filter(Boolean).join(' ').trim() || undefined;
}

function tomadorIdentificacion(state) {
  const t = state?.tomador || {};
  const doc = [t.tipoDoc, t.identificacion].filter(Boolean).join('-').trim();
  return doc || undefined;
}

/**
 * @param {object} opts
 * @param {number} [opts.empresaId]
 * @param {'rcv'|'funerario'} opts.producto
 * @param {object} opts.emission
 * @param {object} [opts.state]
 * @param {string} [opts.planNombre]
 * @param {string} [opts.frecuencia]
 */
async function registerIssuedPolicy(opts) {
  const empresaId = Number(opts.empresaId);
  const polizaNumero = String(opts.emission?.cnpoliza || opts.emission?.number || '').trim();
  if (!empresaId || !polizaNumero) {
    console.warn('[nexusEmisionFeed] omitido: falta empresaId o cnpoliza');
    return null;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[nexusEmisionFeed] NEXUS_API_KEY ausente: no se registra en Tráfico');
    return null;
  }

  const quote = opts.emission?.quote || {};
  const payload = {
    empresaId,
    producto: opts.producto,
    polizaNumero,
    cnrecibo: opts.emission?.cnrecibo || undefined,
    urlpoliza: opts.emission?.urlpoliza || undefined,
    tomadorNombre: tomadorNombre(opts.state),
    tomadorIdentificacion: tomadorIdentificacion(opts.state),
    planNombre: opts.planNombre || opts.state?.selectedPlan?.name || undefined,
    frecuencia: opts.frecuencia || opts.state?.rcv?.frecuencia || undefined,
    monto: quote.mprimaext != null ? Number(quote.mprimaext) : undefined,
    jsonData: {
      producto: opts.producto,
      cnrecibo: opts.emission?.cnrecibo ?? null,
      urlpoliza: opts.emission?.urlpoliza ?? null,
    },
  };

  let lastErr = '';
  for (const base of nexusBases()) {
    const url = `${base}/api/emisiones`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastErr = body?.message || `HTTP ${res.status}`;
        continue;
      }
      console.log(
        `[nexusEmisionFeed] ok producto=${opts.producto} poliza=${polizaNumero} empresa=${empresaId} via ${base}`,
      );
      return body.data ?? body;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  console.warn(`[nexusEmisionFeed] no se pudo registrar ${polizaNumero}: ${lastErr}`);
  return null;
}

module.exports = { registerIssuedPolicy };
