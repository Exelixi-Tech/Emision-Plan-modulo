/**
 * Monitor de expedientes: campo opcional `expediente` del registro a Nexus.
 * - Apagado por defecto; con EXPEDIENTES_ENABLED=true arma el campo del contrato v1.
 * - Nunca lanza ni cambia el resto del registro.
 * - Si Nexus falla o tarda, la emisión responde igual (misma respuesta, sin post-emisión pendiente).
 */
process.env.NEXUS_API_URL = 'http://127.0.0.1:3092';
process.env.NEXUS_API_KEY = 'test-key';
delete process.env.EXPEDIENTE_EMPRESA_FALLBACK;
delete process.env.LAMUNDIAL_RAMO;
delete process.env.EXPEDIENTES_ENABLED;

const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { buildExpedienteFeed } = require('../src/services/expedienteFeed');
const { registerIssuedPolicy } = require('../src/services/nexusEmisionFeed');

const EMPRESA = 'La Mundial de Seguros';
const EMISION = {
  cnpoliza: '1100015737',
  cnrecibo: '2321234',
  fanopol: 2026,
  fmespol: 11,
  urlpoliza: 'https://x/poliza.pdf',
  quote: { mprima: 1234.5, mprimaext: 25, ptasa: 49.38 },
};

function rcvState(extra = {}) {
  return {
    tomador: {
      tipoDoc: 'V', identificacion: '12.345.678', nombre: 'Ana', apellido: 'Pérez',
      email: 'ana@example.test', telefono: '04141234567',
    },
    sameInsured: true,
    vehicle: { placa: 'ab123cd', marca: 'Toyota', modelo: 'Corolla', año: '2020', serial: 'SER1', color: 'Gris' },
    selectedPlan: { cplan: 'RCVBAS', name: 'RCV Básico' },
    metadataCanal: { centidad: 'c', citem: '501', ccanalalt: '45', cusuario: '7', cgestor: 'G-1', cproductor: '80080' },
    documents: {
      cedula: { file: { url: '/files/La%20Mundial%20de%20Seguros/12345678/pendiente/cedula.webp' } },
      licencia: { file: { url: '/files/La%20Mundial%20de%20Seguros/12345678/pendiente/licencia.pdf' } },
    },
    paymentVerified: true,
    ...extra,
  };
}

function withEnabled(fn) {
  return async (t) => {
    process.env.EXPEDIENTES_ENABLED = 'true';
    try {
      await fn(t);
    } finally {
      delete process.env.EXPEDIENTES_ENABLED;
    }
  };
}

// ── Armado del campo ──────────────────────────────────────────────────────────

test('apagado por defecto: sin EXPEDIENTES_ENABLED no arma nada', () => {
  assert.equal(buildExpedienteFeed({ producto: 'rcv', state: rcvState(), emission: EMISION }), undefined);
});

test('RCV pagada: forma del contrato v1', withEnabled(() => {
  const exp = buildExpedienteFeed({
    producto: 'rcv', state: rcvState(), emission: EMISION, empresaId: 1, empresaNombre: EMPRESA,
    nexusMetadata: { xlogin: 'vend01' }, planNombre: 'RCVBAS', frecuencia: 'A',
  });
  const carpeta = 'La Mundial de Seguros/12345678/2321234-26-11-1100015737';
  assert.equal(exp.version, 1);
  assert.equal(exp.centidad, 'C');
  assert.equal(exp.citem, '501');
  assert.equal(exp.cgestor, 'G-1');
  assert.equal(exp.ccanalalt, '45');
  assert.equal(exp.cusuario, '7');
  assert.equal(exp.xlogin, 'vend01');
  assert.equal(exp.producto, 'rcv');
  assert.equal(exp.cramo, 18);
  assert.equal(exp.estadoPago, 'pagada');
  assert.deepEqual(exp.asegurado, {
    tipoDoc: 'V', documento: '12345678', nombre: 'Ana', apellido: 'Pérez',
    email: 'ana@example.test', telefono: '04141234567',
  });
  assert.deepEqual(exp.snapshot.tomador, { tipoDoc: 'V', documento: '12345678', nombre: 'Ana', apellido: 'Pérez' });
  assert.equal(exp.snapshot.vehiculo.placa, 'AB123CD');
  assert.equal(exp.snapshot.vehiculo.anio, 2020);
  assert.equal(exp.snapshot.plan, 'RCVBAS');
  assert.equal(exp.snapshot.prima, 25);
  assert.equal(exp.carpetaExpediente, carpeta);
  // Mismas 8 claves que la mesa técnica (state.documents).
  assert.deepEqual(Object.keys(exp.documentos), [
    'cedula', 'cedula_titular', 'cedula_beneficiario', 'licencia', 'certificado', 'rif', 'pasaporte', 'factura',
  ]);
  assert.deepEqual(exp.documentos.cedula, {
    recibido: true,
    ref: `${carpeta}/cedula.webp`,
    url: '/files/La%20Mundial%20de%20Seguros/12345678/pendiente/cedula.webp',
  });
  assert.equal(exp.documentos.licencia.ref, `${carpeta}/licencia.pdf`);
  assert.deepEqual(exp.documentos.certificado, { recibido: false });
  assert.deepEqual(exp.documentos.factura, { recibido: false });
  assert.equal(exp.documentosEnWizard, true);
  assert.ok(JSON.stringify(exp).length < 10000, 'el campo debe ser liviano');
}));

test('RCV emitida como pendiente de cobro → estadoPago pendiente', withEnabled(() => {
  const exp = buildExpedienteFeed({ producto: 'rcv', state: rcvState({ paymentVerified: false }), emission: EMISION });
  assert.equal(exp.estadoPago, 'pendiente');
}));

test('tarjeta pagada en farmacia (bfactura + nfactura) → pagada aunque paymentVerified sea false', withEnabled(() => {
  const state = rcvState({ paymentVerified: false });
  state.metadataCanal = { ...state.metadataCanal, flujo: 'tarjeta', bfactura: '1', nfactura: '000123' };
  const exp = buildExpedienteFeed({ producto: 'rcv', state, emission: EMISION });
  assert.equal(exp.estadoPago, 'pagada');
}));

test('personas: titular = 1er asegurado (carpeta con su cédula), contacto del tomador', withEnabled(() => {
  const state = {
    tomador: { tipoDoc: 'V', identificacion: '11111111', nombre: 'Tom', apellido: 'Ador', email: 't@example.test', telefono: '0412' },
    sameInsured: false,
    funeral: { asegurados: [{ tipoDoc: 'V', identificacion: '22222222', nombre: 'Titu', apellido: 'Lar' }] },
    selectedPlan: { cplan: 'VIDA01', name: 'Vida 1' },
    metadataCanal: { centidad: 'G', citem: '9', cgestor_in: 'G-9' },
    documents: {
      cedula: { file: { url: '/files/x/11111111/pendiente/cedula.webp' } },
      cedula_titular: { file: { url: '/files/x/22222222/pendiente/cedula_titular.webp' } },
    },
    paymentVerified: false,
  };
  const exp = buildExpedienteFeed({ producto: 'personas', cramo: 9, state, emission: EMISION, empresaId: 1, empresaNombre: EMPRESA });
  const carpeta = 'La Mundial de Seguros/22222222/2321234-26-11-1100015737';
  assert.equal(exp.producto, 'personas');
  assert.equal(exp.cramo, 9);
  assert.equal(exp.centidad, 'G');
  assert.equal(exp.cgestor, 'G-9');
  assert.equal(exp.estadoPago, 'pendiente');
  assert.equal(exp.asegurado.documento, '22222222');
  assert.equal(exp.asegurado.email, 't@example.test');
  assert.equal(exp.snapshot.vehiculo, null);
  assert.equal(exp.carpetaExpediente, carpeta);
  assert.equal(exp.documentos.cedula.ref, `${carpeta}/cedula.webp`);
  assert.equal(exp.documentos.cedula_titular.ref, `${carpeta}/cedula_titular.webp`);
  assert.deepEqual(exp.documentos.licencia, { recibido: false });
}));

test('sin documents en el state (personas desde Pagos): todo recibido false y documentosEnWizard false', withEnabled(() => {
  const exp = buildExpedienteFeed({ producto: 'rcv', state: rcvState({ documents: undefined }), emission: EMISION });
  assert.ok(Object.values(exp.documentos).every((d) => d.recibido === false));
  assert.equal(Object.keys(exp.documentos).length, 8);
  assert.equal(exp.documentosEnWizard, false);
}));

test('state roto: no lanza, devuelve undefined y no loguea datos personales', withEnabled(() => {
  const state = rcvState();
  Object.defineProperty(state, 'documents', { get() { throw new Error('boom 12345678 ana@example.test'); } });
  const logs = [];
  const orig = console.warn;
  console.warn = (...a) => logs.push(a.join(' '));
  try {
    assert.equal(buildExpedienteFeed({ producto: 'rcv', state, emission: EMISION }), undefined);
  } finally {
    console.warn = orig;
  }
  assert.ok(!logs.join('\n').includes('12345678'));
  assert.ok(!logs.join('\n').includes('ana@example.test'));
}));

// ── registerIssuedPolicy ──────────────────────────────────────────────────────

function mockFetch(impl) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return impl(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

const okResponse = () => new Response(JSON.stringify({ success: true, data: { id: 1 } }), { status: 201 });

function feedOpts(extra = {}) {
  return {
    empresaId: 1, producto: 'rcv', emission: EMISION, state: rcvState(),
    planNombre: 'RCVBAS', frecuencia: 'A', ...extra,
  };
}

test('registro: con EXPEDIENTES_ENABLED agrega solo el campo expediente; el resto queda igual', withEnabled(async () => {
  const m = mockFetch(okResponse);
  try {
    await registerIssuedPolicy(feedOpts());
    await registerIssuedPolicy(feedOpts({ expedienteCtx: { producto: 'rcv', empresaNombre: EMPRESA } }));
  } finally {
    m.restore();
  }
  const [sin, con] = m.calls.map((c) => c.body);
  assert.equal(sin.expediente, undefined);
  assert.equal(con.expediente.version, 1);
  const { expediente, ...resto } = con;
  assert.deepEqual(resto, sin);
}));

test('registro: apagado, el payload es idéntico al de siempre', async () => {
  const m = mockFetch(okResponse);
  try {
    await registerIssuedPolicy(feedOpts());
    await registerIssuedPolicy(feedOpts({ expedienteCtx: { producto: 'rcv', empresaNombre: EMPRESA } }));
  } finally {
    m.restore();
  }
  assert.deepEqual(m.calls[1].body, m.calls[0].body);
  assert.equal(m.calls[1].body.expediente, undefined);
});

test('registro: si el armado falla, el registro sale igual sin el campo', withEnabled(async () => {
  const state = rcvState();
  Object.defineProperty(state, 'documents', { get() { throw new Error('boom'); } });
  const m = mockFetch(okResponse);
  let out;
  try {
    out = await registerIssuedPolicy(feedOpts({ state, expedienteCtx: { producto: 'rcv' } }));
  } finally {
    m.restore();
  }
  assert.deepEqual(out, { id: 1 });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].body.expediente, undefined);
  assert.equal(m.calls[0].body.polizaNumero, '1100015737');
}));

test('registro: Nexus caído → devuelve null sin lanzar', withEnabled(async () => {
  const m = mockFetch(async () => { throw new Error('ECONNREFUSED'); });
  try {
    const out = await registerIssuedPolicy(feedOpts({ expedienteCtx: { producto: 'rcv' } }));
    assert.equal(out, null);
  } finally {
    m.restore();
  }
}));

test('registro: Nexus no responde → corta en el timeout de siempre (8 s) y devuelve null', withEnabled(async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const m = mockFetch((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  try {
    const p = registerIssuedPolicy(feedOpts({ expedienteCtx: { producto: 'rcv' } }));
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(8000);
    assert.equal(await p, null);
  } finally {
    m.restore();
  }
}));

// ── Ruta POST /policies/emit (RCV): la respuesta no cambia ────────────────────

test('emisión RCV: misma respuesta con Nexus OK, caído, con error o lento; sin post-emisión pendiente', async () => {
  const policyService = require('../src/services/policyService');
  const expedienteArchive = require('../src/services/expedienteArchive');
  // postEmisionPendiente existe en main (no en qa): si está, un fallo de Nexus no debe registrar pendiente.
  let postEmision = { registrarPendiente: undefined };
  try { postEmision = require('../src/services/postEmisionPendiente'); } catch { /* rama sin post-emisión */ }
  const origQuoteAndEmit = policyService.quoteAndEmit;
  const origArchive = expedienteArchive.archiveExpedienteAfterEmit;
  const origRegistrar = postEmision.registrarPendiente;
  let pendientes = 0;
  policyService.quoteAndEmit = async () => ({
    ...EMISION,
    internalPolicyId: 'INT-1',
    emittedAt: '2026-11-07T12:00:00.000Z',
    metadata: { internalPolicyId: 'INT-1' },
  });
  expedienteArchive.archiveExpedienteAfterEmit = async () => undefined;
  postEmision.registrarPendiente = () => { pendientes += 1; return null; };

  // La ruta toma las funciones al cargarse: cargarla después de los mocks.
  delete require.cache[require.resolve('../src/routes/emision')];
  const router = require('../src/routes/emision');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.empresa = { id: 1, nombre: EMPRESA };
    req.nexusMetadata = { centidad: 'C', citem: '501', cusuario: '7' };
    next();
  });
  app.use('/api', router);
  const server = app.listen(0);
  const { port } = server.address();

  const emit = () => new Promise((resolve, reject) => {
    const body = JSON.stringify({ state: rcvState(), plan: 'RCVBAS', frecuencia: 'A' });
    const r = http.request({
      host: '127.0.0.1', port, path: '/api/policies/emit', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    r.on('error', reject);
    r.end(body);
  });

  const escenarios = {
    ok: okResponse,
    caido: async () => { throw new Error('ECONNREFUSED'); },
    error500: async () => new Response(JSON.stringify({ message: 'x' }), { status: 500 }),
    lento: () => new Promise((r) => setTimeout(() => r(okResponse()), 300)),
  };

  const respuestas = {};
  try {
    for (const enabled of [false, true]) {
      if (enabled) process.env.EXPEDIENTES_ENABLED = 'true';
      else delete process.env.EXPEDIENTES_ENABLED;
      for (const [nombre, impl] of Object.entries(escenarios)) {
        const m = mockFetch(impl);
        try {
          respuestas[`${enabled ? 'on' : 'off'}-${nombre}`] = await emit();
        } finally {
          m.restore();
        }
        if (enabled && nombre === 'ok') {
          assert.equal(m.calls[0].body.expediente.estadoPago, 'pagada');
          assert.equal(m.calls[0].body.expediente.centidad, 'C');
        }
      }
    }
  } finally {
    delete process.env.EXPEDIENTES_ENABLED;
    server.close();
    policyService.quoteAndEmit = origQuoteAndEmit;
    expedienteArchive.archiveExpedienteAfterEmit = origArchive;
    postEmision.registrarPendiente = origRegistrar;
    delete require.cache[require.resolve('../src/routes/emision')];
  }

  const base = respuestas['off-ok'];
  assert.equal(base.status, 201);
  assert.equal(base.body.policy.cnpoliza, '1100015737');
  for (const [k, r] of Object.entries(respuestas)) {
    assert.deepEqual(r, base, `respuesta distinta en ${k}`);
  }
  assert.equal(pendientes, 0, 'un fallo de Nexus no debe registrar post-emisión pendiente');
});
