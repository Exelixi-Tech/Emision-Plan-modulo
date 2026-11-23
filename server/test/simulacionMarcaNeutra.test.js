/**
 * Marca neutra: criterio de la simulación y rutas de prueba (RCV + Funerario).
 * Sin el header todo sigue por las rutas reales; pedida y no permitida, la emisión da 403.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
/** El router necesita express: si server/node_modules no está instalado, esas pruebas se saltan. */
let express = null;
try {
  express = require('express');
} catch {
  express = null;
}
const SIN_EXPRESS = express ? false : 'express no instalado en server/node_modules';
const { evaluarSimulacionMarcaNeutra } = require('../src/services/simulacionMarcaNeutra');
const { crearRouterSimulacionMarcaNeutra } = express ? require('../src/routes/simulacionMarcaNeutra') : {};
const datos = require('../src/lib/datosPruebaMarcaNeutra');

const ENV_OK = { EMISION_SIMULADA_MARCA_NEUTRA: '1' };
const NEUTRA = { 'x-exelixi-marca': 'neutra', host: 'cierrelmds.exelixitech.com' };

test('criterio: sin marca neutra no simula', () => {
  assert.deepEqual(evaluarSimulacionMarcaNeutra({ env: ENV_OK, headers: {} }), {
    permitido: false,
    motivo: 'sin_marca_neutra',
  });
});

test('criterio: header o query neutra + flag + 120 → permitido', () => {
  assert.equal(evaluarSimulacionMarcaNeutra({ env: ENV_OK, headers: NEUTRA }).permitido, true);
  assert.equal(
    evaluarSimulacionMarcaNeutra({ env: ENV_OK, headers: { host: 'localhost:4004' }, query: { marca: 'neutra' } }).permitido,
    true,
  );
});

test('criterio: sin flag no simula (nunca por defecto)', () => {
  assert.equal(evaluarSimulacionMarcaNeutra({ env: {}, headers: NEUTRA }).motivo, 'variable_desactivada');
  assert.equal(
    evaluarSimulacionMarcaNeutra({ env: { EMISION_SIMULADA_MARCA_NEUTRA: '0' }, headers: NEUTRA }).motivo,
    'variable_desactivada',
  );
});

test('criterio: ENTORNO/APP_ENV de producción no simula', () => {
  for (const env of [{ ...ENV_OK, ENTORNO: 'produccion' }, { ...ENV_OK, APP_ENV: 'production' }]) {
    assert.equal(evaluarSimulacionMarcaNeutra({ env, headers: NEUTRA }).motivo, 'entorno_produccion');
  }
});

test('criterio: host de producción (emision/pagos/extra) no simula', () => {
  const casos = [
    { host: 'emision.exelixitech.com' },
    { host: 'localhost:4004', 'x-forwarded-host': 'pagos.exelixitech.com' },
    { origin: 'https://emision.exelixitech.com' },
    { referer: 'https://pagos.exelixitech.com/pagos/?marca=neutra' },
    { host: 'otro.prod.local' },
  ];
  const env = { ...ENV_OK, EMISION_HOSTS_PRODUCCION: 'otro.prod.local' };
  for (const h of casos) {
    const r = evaluarSimulacionMarcaNeutra({ env, headers: { 'x-exelixi-marca': 'neutra', ...h } });
    assert.deepEqual(r, { permitido: false, motivo: 'host_produccion' }, JSON.stringify(h));
  }
});

test('datos: planes RCV y funerario neutros, sin La Mundial', () => {
  const rcv = datos.planesRcvPrueba();
  assert.deepEqual(rcv.map((p) => p.xplan), ['Plan Prueba RCV Básico', 'Plan Prueba RCV Plus']);
  const fun = datos.planesPersonasPrueba(9);
  assert.equal(fun[0].xplan, 'Plan Prueba Funerario');
  assert.equal(fun[0].cramo, 9);
  assert.doesNotMatch(JSON.stringify([rcv, fun]), /mundial|LM-/i);
});

test('datos: cotización RCV con tasa fija y prorrateo de placa extranjera', () => {
  const q = datos.cotizacionRcvPrueba({ vehicle: { marca: 'FORD', modelo: 'FIESTA' } }, 'PRUEBA-RCV-BAS');
  assert.equal(q.mprimaext, 30);
  assert.equal(q.ptasa, datos.TASA_PRUEBA);
  assert.equal(q.mprima, 3000);
  assert.equal(q.coberturas.reduce((s, c) => s + c.prima, 0), 30);
  assert.equal(q.metadata.vehicleLabel, 'FORD / FIESTA');
  const ext = datos.cotizacionRcvPrueba(
    { vehicle: { tipoPlaca: 'extranjera' }, rcv: { vigenciaExt: { nvalor: 0.4 } } },
    'PRUEBA-RCV-PLUS',
  );
  assert.equal(ext.mprimaext, 22);
});

test('datos: cotización funeraria por asegurados y póliza PRUEBA- sin PDF', () => {
  assert.equal(datos.cotizacionPersonasPrueba(1).mprimaext, 60);
  assert.equal(datos.cotizacionPersonasPrueba(3).mprimaext, 120);
  const p = datos.polizaPrueba('FUN', { mprima: 6000, mprimaext: 60, ptasa: 100 }, new Date('2026-11-21T12:00:00Z'));
  assert.match(p.cnpoliza, /^PRUEBA-FUN-20261121-\d{6}$/);
  assert.match(p.cnrecibo, /^PRUEBA-REC-20261121-\d{6}$/);
  assert.equal(p.urlpoliza, '');
  assert.equal(p.number, p.cnpoliza);
  assert.equal(p.metadata.simulacion, true);
  assert.equal(p.ifrecuencia, 'A');
  assert.equal(p.ncuotas, 1);
  const m = datos.polizaPrueba('FUN', { mprima: 6000, mprimaext: 60, ptasa: 100 }, new Date(), 'M');
  assert.equal(m.ifrecuencia, 'M');
  assert.equal(m.ncuotas, 12);
  assert.equal(datos.frecuenciaPrueba('X'), 'A');
});

test('datos: la emisión conserva la prima ya cobrada del wizard', () => {
  const fb = datos.cotizacionPersonasPrueba(1);
  assert.deepEqual(datos.quoteDesdeState({ quote: { mprimaext: 75, ptasa: 100 } }, fb), {
    mprima: 7500,
    mprimaext: 75,
    ptasa: 100,
  });
  assert.deepEqual(datos.quoteDesdeState({}, fb), { mprima: 6000, mprimaext: 60, ptasa: 100 });
});

/** App con el router de simulación + rutas "reales" falsas para ver si se cae a ellas. */
async function levantar(env) {
  const app = express();
  app.use(express.json());
  let authCalls = 0;
  const auth = (req, _res, next) => {
    authCalls += 1;
    req.nexusMetadata = {};
    next();
  };
  app.use('/api', crearRouterSimulacionMarcaNeutra({ auth, env }));
  const real = (req, res) => res.json({ real: true, sim: req.simulacionMarcaNeutra ?? null });
  app.get('/api/catalogo/planes', real);
  app.post('/api/policies/quote', real);
  app.post('/api/policies/emit', real);
  app.post('/api/personas/emision', real);
  app.post('/api/funeral/submissions', real);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, { headers = {}, body } = {}) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  return { call, close: () => new Promise((r) => server.close(r)), authCalls: () => authCalls };
}

const H_NEUTRA = { 'X-Exelixi-Marca': 'neutra' };
const STATE_RCV = {
  vehicle: { marca: 'TOYOTA', modelo: 'COROLLA', año: '2020', tipoPlaca: 'nacional' },
  tomador: { nombre: 'Ana', apellido: 'Prueba', identificacion: '12345678' },
  selectedPlan: { cplan: 'PRUEBA-RCV-PLUS' },
};

test('rutas: sin header todo sigue por la ruta real (sin pasar por auth del router)', { skip: SIN_EXPRESS }, async () => {
  const srv = await levantar(ENV_OK);
  try {
    const planes = await srv.call('GET', '/catalogo/planes');
    assert.equal(planes.body.real, true);
    assert.equal(planes.body.sim.pedida, false);
    const emit = await srv.call('POST', '/policies/emit', { body: { state: STATE_RCV } });
    assert.equal(emit.body.real, true);
    assert.equal(srv.authCalls(), 0);
  } finally {
    await srv.close();
  }
});

test('rutas RCV permitidas: planes, frecuencia, cotización y póliza PRUEBA-', { skip: SIN_EXPRESS }, async () => {
  const srv = await levantar(ENV_OK);
  try {
    const planes = await srv.call('GET', '/catalogo/planes?ctipo=1&iplaca=N', { headers: H_NEUTRA });
    assert.equal(planes.status, 200);
    assert.deepEqual(planes.body.planes.map((p) => p.xplan), ['Plan Prueba RCV Básico', 'Plan Prueba RCV Plus']);
    assert.equal(planes.headers.get('x-exelixi-simulacion'), 'marca-neutra');

    const frec = await srv.call('POST', '/valrep/frecuencia', { headers: H_NEUTRA, body: { cplan: 'PRUEBA-RCV-BAS', cramo: 18 } });
    assert.deepEqual(frec.body.items.map((i) => i.code), ['A', 'S', 'T', 'M']);

    const quote = await srv.call('POST', '/policies/quote', { headers: H_NEUTRA, body: { state: STATE_RCV, plan: 'PRUEBA-RCV-PLUS' } });
    assert.equal(quote.body.success, true);
    assert.equal(quote.body.mprimaext, 55);
    assert.equal(quote.body.ptasa, 100);
    assert.equal(quote.body.mprima, 5500);
    assert.equal(quote.body.coberturas.length, 2);
    assert.equal(quote.body.metadata.vehicleLabel, 'TOYOTA / COROLLA');

    const emit = await srv.call('POST', '/policies/emit', { headers: H_NEUTRA, body: { state: { ...STATE_RCV, rcv: { frecuencia: 'T' } }, plan: 'PRUEBA-RCV-PLUS' } });
    assert.equal(emit.status, 201);
    assert.equal(emit.body.policy.ifrecuencia, 'T');
    assert.equal(emit.body.policy.ncuotas, 4);
    assert.match(emit.body.policy.cnpoliza, /^PRUEBA-RCV-\d{8}-\d{6}$/);
    assert.equal(emit.body.policy.number, emit.body.policy.cnpoliza);
    assert.equal(emit.body.policy.urlpoliza, '');
    assert.equal(emit.body.policy.quote.mprimaext, 55);
    assert.doesNotMatch(JSON.stringify(emit.body), /LM-|La Mundial/);
  } finally {
    await srv.close();
  }
});

test('rutas RCV: placa extranjera prorratea por vigencia y la emisión usa la prima cobrada', { skip: SIN_EXPRESS }, async () => {
  const srv = await levantar(ENV_OK);
  try {
    const state = {
      ...STATE_RCV,
      vehicle: { ...STATE_RCV.vehicle, tipoPlaca: 'extranjera' },
      rcv: { vigenciaExt: { cvigencia: 1, nvalor: 0.2 } },
    };
    const quote = await srv.call('POST', '/policies/quote', { headers: H_NEUTRA, body: { state, plan: 'PRUEBA-RCV-PLUS' } });
    assert.equal(quote.body.mprimaext, 11);
    const emit = await srv.call('POST', '/policies/emit', {
      headers: H_NEUTRA,
      body: { state: { ...STATE_RCV, quote: { mprima: 3000, mprimaext: 30, ptasa: 100 } } },
    });
    assert.equal(emit.body.policy.quote.mprimaext, 30);
  } finally {
    await srv.close();
  }
});

test('rutas Funerario permitidas: planes, cotización, vigente, validación y emisión de prueba', { skip: SIN_EXPRESS }, async () => {
  const srv = await levantar(ENV_OK);
  try {
    const planes = await srv.call('GET', '/personas/planes?cramo=9', { headers: H_NEUTRA });
    assert.equal(planes.body.planes[0].xplan, 'Plan Prueba Funerario');
    assert.equal(planes.body.planes[0].cramo, 9);
    assert.equal(planes.body.planes[0].parentescos[0].cparen, 1);

    const cot = await srv.call('POST', '/personas/cotizacion', {
      headers: H_NEUTRA,
      body: { cplan: 'PRUEBA-FUN', asegurados: [{ parentesco: 1 }, { parentesco: 3 }], ifrecuencia: 'A' },
    });
    assert.equal(cot.body.mprimaext, 90);
    assert.equal(cot.body.ptasa, 100);

    const vig = await srv.call('POST', '/personas/poliza-vigente', { headers: H_NEUTRA, body: { rif: '12345678' } });
    assert.equal(vig.body.blocked, false);

    const val = await srv.call('POST', '/personas/validacion', { headers: H_NEUTRA, body: { state: { tomador: {} } } });
    assert.equal(val.body.success, true);

    const emit = await srv.call('POST', '/personas/emision', {
      headers: H_NEUTRA,
      body: { state: { tomador: {}, selectedPlan: { cplan: 'PRUEBA-FUN' }, funeral: { asegurados: [{}, {}, {}] } } },
    });
    assert.equal(emit.status, 201);
    assert.match(emit.body.policy.cnpoliza, /^PRUEBA-FUN-/);
    assert.equal(emit.body.policy.quote.mprimaext, 120);
  } finally {
    await srv.close();
  }
});

test('rutas: neutra pedida y NO permitida → lecturas reales, emisión 403 SIMULACION_NO_PERMITIDA', { skip: SIN_EXPRESS }, async () => {
  const srv = await levantar({});
  try {
    const planes = await srv.call('GET', '/catalogo/planes', { headers: H_NEUTRA });
    assert.equal(planes.body.real, true);
    assert.deepEqual(planes.body.sim, { pedida: true, permitido: false, motivo: 'variable_desactivada' });
    // La lectura cae a la ruta real sin pasar por el auth del router (no se duplica nexusAuth).
    assert.equal(srv.authCalls(), 0);

    for (const path of ['/policies/emit', '/personas/emision', '/exelixi/emit', '/patrimonial/emision']) {
      const r = await srv.call('POST', path, { headers: H_NEUTRA, body: { state: STATE_RCV } });
      assert.equal(r.status, 403, path);
      assert.equal(r.body.code, 'SIMULACION_NO_PERMITIDA', path);
    }
  } finally {
    await srv.close();
  }
});

test('rutas: neutra en host de producción también bloquea la emisión', { skip: SIN_EXPRESS }, async () => {
  const srv = await levantar(ENV_OK);
  try {
    const r = await srv.call('POST', '/policies/emit', {
      headers: { ...H_NEUTRA, 'X-Forwarded-Host': 'pagos.exelixitech.com' },
      body: { state: STATE_RCV },
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.motivo, 'host_produccion');
  } finally {
    await srv.close();
  }
});

test('rutas: patrimonial en neutra permitida no emite (422) y su cotización sigue por la real', { skip: SIN_EXPRESS }, async () => {
  const srv = await levantar(ENV_OK);
  try {
    const body = { state: { ...STATE_RCV, product: 'patrimoniales' } };
    const emit = await srv.call('POST', '/policies/emit', { headers: H_NEUTRA, body });
    assert.equal(emit.status, 422);
    assert.equal(emit.body.code, 'SIMULACION_PRODUCTO_NO_SOPORTADO');
    const quote = await srv.call('POST', '/policies/quote', { headers: H_NEUTRA, body });
    assert.equal(quote.body.real, true);
  } finally {
    await srv.close();
  }
});

test('funeral/submissions recibe el flag de simulación', { skip: SIN_EXPRESS }, async () => {
  const srv = await levantar(ENV_OK);
  try {
    const r = await srv.call('POST', '/funeral/submissions', { headers: H_NEUTRA, body: {} });
    assert.equal(r.body.real, true);
    assert.equal(r.body.sim.permitido, true);
  } finally {
    await srv.close();
  }
});
