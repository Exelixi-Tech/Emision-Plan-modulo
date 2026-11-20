/**
 * Emitir RCV desde cotización de SysIP (cotizacionID en la metadata del token).
 * - Sin cotizacionID en el token: las rutas nuevas responden 403 y POST /policies/emit sigue al RCV de siempre.
 * - Cotización no emitible (casco, emitida): no deja preparar el pago.
 * - Mapper: plan/vehículo/tomador/vigencia de la cotización + cproces, ccerti_cotizacion, mprima_esperada, itipoEmi NU.
 * - Primer recibo: RCV básico completo + resto ÷ cuotas, USD a 2 decimales antes de Bs.
 * nest-api (GET /cotizaciones-auto/:cproces) se simula: el endpoint aún no está desplegado.
 */
process.env.TENANT_TOKEN_SECRET = 'test-secret-cotizacion';
delete process.env.RCV_COTIZACION_TICKET_SECRET;
delete process.env.LAMUNDIAL_RAMO;

const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const lib = require('../src/lib/rcvCotizacion');
const { buildCotizacionEmission } = require('../src/services/rcvCotizacionMapper');
const { validateEmissionPayload } = require('../src/services/policyValidator');
const { _internal: { todayYmd } } = require('../src/services/policyMapper');

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const HOY = todayYmd();

function cotizacionMock(extra = {}) {
  return {
    cproces: 4512345,
    codigo: 'COT-4512345',
    creadaEn: '2026-11-15',
    venceEl: addDays(HOY, 20),
    vencida: false,
    ramo: 18,
    plan: { codigo: 'RCVBAS', nombre: 'RCV Básico' },
    productor: { codigo: '1234', nombre: 'Productor Prueba' },
    usuario: 'jperez',
    vigencia: { desde: addDays(HOY, 1), hasta: addDays(HOY, 366), dias: 365 },
    tomador: { tipoDoc: 'V', documento: '12345678', nombre: 'ANA MARIA PEREZ GOMEZ' },
    vehiculo: {
      marca: { codigo: '021', nombre: 'TOYOTA' },
      modelo: { codigo: '045', nombre: 'COROLLA' },
      version: { codigo: '003', nombre: 'XEI 1.8' },
      anio: 2020,
      tipo: { codigo: 'AU', nombre: 'AUTOMOVIL' },
      uso: { codigo: 1, nombre: 'PARTICULAR' },
      puestos: 5,
      toneladas: 0,
      tipoPlaca: 'N',
    },
    opciones: [{
      opcion: 1,
      primaUsd: 120.5,
      soloRcv: true,
      coberturas: [
        { codigo: '1', nombre: 'DAÑOS A PERSONAS', primaUsd: 20.48, sumaAseguradaUsd: 1000, ajustePorcentaje: 0 },
        { codigo: '2', nombre: 'DAÑOS A COSAS', primaUsd: 16.5, sumaAseguradaUsd: 1000, ajustePorcentaje: 0 },
        { codigo: '3', nombre: 'APOV', primaUsd: 83.52, sumaAseguradaUsd: 5000, ajustePorcentaje: 0 },
      ],
    }],
    emitida: false,
    poliza: null,
    opcionEmitida: null,
    emitible: true,
    motivos: [],
    ...extra,
  };
}

function clientState(extra = {}) {
  return {
    tomador: {
      // Identidad manipulada en el navegador: debe ganar la de la cotización.
      tipoDoc: 'E', identificacion: '99999999', nombre: 'Hacker', apellido: 'X',
      fechaNac: '1985-04-12', sexo: 'F', estadoCivil: 'C',
      direccion: 'Av. Principal, Chacao', cestado: 13, estado: 'MIRANDA', cciudad: 101, ciudad: 'CHACAO',
      telefono: '(0414) 123-4567', email: 'ana@example.test',
      personaPoliticamenteExpuesta: false, aceptaTerminos: true, declaraVeracidad: true,
      cprofesion: 12, cocupacion: 34, ocupacionSeparada: true,
    },
    sameInsured: true,
    hasDriver: false,
    // Marca/modelo manipulados: deben ganar los códigos INMA de la cotización.
    vehicle: { placa: 'ab-123-cd', serial: '9BRBL3HE0L0123456', serialMotor: '2ZR1234567', color: 'Gris', cmarca: '999', marca: 'OTRA' },
    rcv: { frecuencia: 'M', ndias: null },
    metadataCanal: { centidad: 'P', citem: '80080', cproductor: '80080', cusuario: '7' },
    ...extra,
  };
}

// ── Puras ────────────────────────────────────────────────────────────────────

test('readCotizacionId: solo número válido de la metadata', () => {
  assert.equal(lib.readCotizacionId({ cotizacionID: '4512345' }), '4512345');
  assert.equal(lib.readCotizacionId({ cotizacionID: 4512345 }), '4512345');
  assert.equal(lib.readCotizacionId({}), null);
  assert.equal(lib.readCotizacionId(null), null);
  assert.equal(lib.readCotizacionId({ cotizacionID: 'abc' }), null);
  assert.equal(lib.readCotizacionId({ cotizacionID: '0' }), null);
  assert.equal(lib.readCotizacionId({ cotizacionID: '12345678901234' }), null);
});

test('primer recibo mensual: RCV básico completo + resto ÷ 12, USD a 2 decimales antes de Bs', () => {
  const { annualUsd, rcvBasicoUsd } = lib.resumenOpcion(cotizacionMock().opciones[0]);
  assert.equal(annualUsd, 120.5);
  assert.equal(rcvBasicoUsd, 36.98);
  const m = lib.computePrimerRecibo({ annualUsd, rcvBasicoUsd, frecuencia: 'M', ptasa: 250.1234 });
  assert.equal(m.cuotas, 12);
  assert.equal(m.siguienteUsd, 6.96); // (120.50 − 36.98) / 12 = 6.96
  assert.equal(m.primerUsd, 43.94); // 36.98 + 6.96
  assert.equal(m.primerVes, 10990.42); // ROUND(43.94 × 250.1234, 2)
  assert.equal(m.siguienteVes, 1740.86); // ROUND(6.96 × 250.1234, 2)
});

test('primer recibo: anual = prima completa; solo RCV básico = un único recibo', () => {
  const a = lib.computePrimerRecibo({ annualUsd: 120.5, rcvBasicoUsd: 36.98, frecuencia: 'A', ptasa: 100 });
  assert.equal(a.cuotas, 1);
  assert.equal(a.primerUsd, 120.5);
  assert.equal(a.primerVes, 12050);
  const solo = lib.computePrimerRecibo({ annualUsd: 36.98, rcvBasicoUsd: 36.98, frecuencia: 'T', ptasa: 100 });
  assert.equal(solo.cuotas, 1);
  assert.equal(solo.primerUsd, 36.98);
  const sinRcv = lib.computePrimerRecibo({ annualUsd: 100, rcvBasicoUsd: 0, frecuencia: 'T', ptasa: 10 });
  assert.equal(sinRcv.primerUsd, 25);
});

test('vigencia: la de la cotización; si ya empezó, desde hoy por el mismo plazo', () => {
  const v = lib.resolveVigenciaEmision({ desde: '2027-01-10', hasta: '2028-01-10', dias: 365 }, '2026-11-17');
  assert.deepEqual(v, { fdesde: '2027-01-10', fhasta: '2028-01-10', dias: 365, ajustada: false });
  const p = lib.resolveVigenciaEmision({ desde: '2026-11-01', hasta: '2027-11-01', dias: 365 }, '2026-11-17');
  assert.deepEqual(p, { fdesde: '2026-11-17', fhasta: '2027-11-17', dias: 365, ajustada: true });
});

test('nombre completo → nombres / apellidos', () => {
  assert.deepEqual(lib.splitNombreCompleto('ANA MARIA PEREZ GOMEZ', 'V'), { nombre: 'ANA MARIA', apellido: 'PEREZ GOMEZ' });
  assert.deepEqual(lib.splitNombreCompleto('ANA PEREZ', 'V'), { nombre: 'ANA', apellido: 'PEREZ' });
  assert.deepEqual(lib.splitNombreCompleto('JUAN PEREZ GOMEZ', 'E'), { nombre: 'JUAN', apellido: 'PEREZ GOMEZ' });
  assert.deepEqual(lib.splitNombreCompleto('INVERSIONES XYZ, C.A.', 'J'), { nombre: 'INVERSIONES XYZ, C.A.', apellido: '' });
});

test('motivos: casco → Auto Casco; emitida; emitible sin opción Solo RCV', () => {
  const casco = lib.motivosNoEmitible(cotizacionMock({ emitible: false, motivos: [{ codigo: 'INCLUYE_CASCO', mensaje: 'tiene casco' }] }));
  assert.match(casco[0].mensaje, /Auto Casco/);
  const emitida = lib.motivosNoEmitible(cotizacionMock({ emitible: false, emitida: true, poliza: '18-1-123' }));
  assert.ok(emitida.some((m) => m.codigo === 'COTIZACION_EMITIDA' && /18-1-123/.test(m.mensaje)));
  const sinSoloRcv = lib.motivosNoEmitible(cotizacionMock({ opciones: [{ opcion: 1, primaUsd: 300, soloRcv: false, coberturas: [] }] }));
  assert.match(sinSoloRcv[0].mensaje, /Auto Casco/);
  assert.deepEqual(lib.motivosNoEmitible(cotizacionMock()), []);
});

test('comprobante: firma y verifica; alterado o sin secreto → null', () => {
  const t = lib.signTicket({ cproces: '4512345', opcion: 1, frecuencia: 'm', primaUsd: 120.5 });
  assert.deepEqual(lib.verifyTicket(t), { cproces: '4512345', opcion: 1, frecuencia: 'M', primaUsd: 120.5 });
  assert.equal(lib.verifyTicket(`${t}x`), null);
  assert.equal(lib.verifyTicket(undefined), null);
});

// ── Mapper ───────────────────────────────────────────────────────────────────

test('mapper: body de createEmissionAuto con la cotización y los 3 campos de cotización', () => {
  const cot = cotizacionMock();
  const { payload, body, vigencia } = buildCotizacionEmission({
    cotizacion: cot, opcion: cot.opciones[0], state: clientState(), frecuencia: 'M', ptasa: 250.1234,
  });
  // Campos de cotización
  assert.equal(body.cproces, '4512345');
  assert.equal(typeof body.cproces, 'string');
  assert.equal(body.ccerti_cotizacion, 1);
  assert.equal(body.mprima_esperada, 120.5);
  assert.equal(body.itipoEmi, 'NU');
  // Bloqueado por la cotización
  assert.equal(body.cplan, 'RCVBAS');
  assert.equal(body.cramo, 18);
  assert.equal(body.cmarca, '021');
  assert.equal(body.cmodelo, '045');
  assert.equal(body.cversion, '003');
  assert.equal(body.cano, 2020);
  assert.equal(body.ccategoria_uso, 1);
  assert.equal(body.npuestos, 5);
  assert.equal(body.icedula_tomador, 'V');
  assert.equal(body.xrif_tomador, 12345678);
  assert.equal(body.xnombre_tomador, 'ANA MARIA');
  assert.equal(body.xapellido_tomador, 'PEREZ GOMEZ');
  assert.equal(body.fdesde, cot.vigencia.desde);
  assert.equal(body.fhasta, cot.vigencia.hasta);
  assert.equal(vigencia.ajustada, false);
  assert.equal(body.cproductor, 1234);
  assert.equal(body.msumaaseg, null);
  // Del navegador
  assert.equal(body.xplaca, 'AB123CD');
  assert.equal(body.xsercar, '9BRBL3HE0L0123456');
  assert.equal(body.xsermot, '2ZR1234567');
  assert.equal(body.xcolor, 'Gris');
  assert.equal(body.fnac_tomador, '1985-04-12');
  assert.equal(body.isexo_tomador, 'F');
  assert.equal(body.cestado_tomador, 13);
  assert.equal(body.cciudad_tomador, 101);
  assert.equal(body.xtelefono_tomador, '04141234567');
  assert.equal(body.xcorreo_tomador, 'ana@example.test');
  assert.equal(body.ifrecuencia, 'M');
  // Prima: la fija el SP con la cotización (mprima 0 como el RCV de siempre)
  assert.equal(body.mprima, 0);
  assert.equal(body.mprimaext, 120.5);
  assert.equal(body.ptasa, 250.1234);
  assert.equal(body.xrif_titular, 12345678);
  assert.deepEqual(validateEmissionPayload(payload), []);
});

test('mapper: asegurado distinto y conductor habitual', () => {
  const cot = cotizacionMock();
  const state = clientState({
    sameInsured: false,
    asegurado: {
      tipoDoc: 'V', identificacion: '7654321', nombre: 'Luis', apellido: 'Rojas', fechaNac: '1970-01-02', sexo: 'M',
      direccion: 'Av. Principal, Chacao', cestado: 13, cciudad: 101, telefono: '04121112233', email: 'luis@example.test',
    },
    hasDriver: true,
    conductor: { tipoDoc: 'V', identificacion: '22333444', nombre: 'Pedro', apellido: 'Díaz', fechaNac: '1990-05-05', sexo: 'M' },
  });
  const { payload, body } = buildCotizacionEmission({ cotizacion: cot, opcion: cot.opciones[0], state, frecuencia: 'A', ptasa: 100 });
  assert.equal(body.xrif_titular, 7654321);
  assert.equal(body.xnombre_titular, 'Luis');
  assert.equal(body.xrif_tomador, 12345678);
  assert.equal(body.conductor.xrif_conductor, 22333444);
  assert.deepEqual(validateEmissionPayload(payload), []);
});

test('mapper: vigencia vencida se corre a hoy con el mismo plazo', () => {
  const cot = cotizacionMock({ vigencia: { desde: addDays(HOY, -10), hasta: addDays(HOY, 355), dias: 365 } });
  const { body, vigencia } = buildCotizacionEmission({ cotizacion: cot, opcion: cot.opciones[0], state: clientState(), frecuencia: 'A', ptasa: 100 });
  assert.equal(vigencia.ajustada, true);
  assert.equal(body.fdesde, HOY);
  assert.equal(body.fhasta, addDays(HOY, 365));
});

// ── Rutas ────────────────────────────────────────────────────────────────────

function setupApp({ metadata, cotizacion, emitImpl, calls }) {
  const client = require('../src/services/rcvCotizacionClient');
  const nest = require('../src/services/nestApiClient');
  const collection = require('../src/services/collectionAfterPayment');
  const archive = require('../src/services/expedienteArchive');
  const feed = require('../src/services/nexusEmisionFeed');

  client.getCotizacionAuto = async (cproces) => {
    calls.cotizacion.push(cproces);
    if (typeof cotizacion === 'function') return cotizacion(cproces);
    return cotizacion;
  };
  client.getTasaBcv = async () => 250.1234;
  nest.getValrepFrecuencias = async () => [
    { code: 'A', label: 'Anual', ndias: null },
    { code: 'M', label: 'Mensual', ndias: 30 },
    { code: 'D', label: 'Diaria', ndias: 3 },
  ];
  nest.validateEmissionAutoViaNestApi = async (p) => { calls.validate.push(p); return { success: true }; };
  nest.createEmissionAutoViaNestApi = async (body) => {
    calls.emit.push(body);
    return emitImpl ? emitImpl(body) : { cnpoliza: '18-1-0000099', cnrecibo: '18-100200', urlpoliza: 'https://x/p.pdf', ncuota: 1 };
  };
  nest.sendPolicyEmailViaNestApi = async () => ({ sent: true });
  collection.resolveIngresoCajaAfterPayment = async () => 'https://x/caja.pdf';
  archive.archiveExpedienteAfterEmit = async () => null;
  feed.registerIssuedPolicy = async () => null;

  for (const mod of ['../src/services/rcvCotizacionService', '../src/routes/rcvCotizacion']) {
    delete require.cache[require.resolve(mod)];
  }
  const routes = require('../src/routes/rcvCotizacion');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.empresa = { id: 1, nombre: 'La Mundial de Seguros' };
    req.nexusMetadata = metadata;
    next();
  });
  app.use('/api/rcv-cotizacion', routes);
  // Sentinela = emisión RCV de siempre (routes/emision.js).
  const legacy = express.Router();
  legacy.post('/policies/emit', (_req, res) => res.status(299).json({ legacy: true }));
  app.use('/api', routes.emitGuard, legacy);
  const server = app.listen(0);
  const { port } = server.address();

  const call = (method, path, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const r = http.request({
      host: '127.0.0.1', port, path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    r.on('error', reject);
    r.end(data);
  });
  return { call, close: () => server.close() };
}

function newCalls() {
  return { cotizacion: [], validate: [], emit: [] };
}

test('rutas sin cotizacionID en el token: 403 y /policies/emit sigue al RCV de siempre', async () => {
  const calls = newCalls();
  const { call, close } = setupApp({ metadata: { cproductor: '80080' }, cotizacion: cotizacionMock(), calls });
  try {
    const actual = await call('GET', '/api/rcv-cotizacion/actual');
    assert.equal(actual.status, 403);
    assert.equal(actual.body.code, 'COTIZACION_SIN_TOKEN');
    const checkout = await call('POST', '/api/rcv-cotizacion/checkout', { opcion: 1, frecuencia: 'A' });
    assert.equal(checkout.status, 403);
    // El número en la URL/body no abre el flujo.
    const query = await call('GET', '/api/rcv-cotizacion/actual?cotizacionID=4512345');
    assert.equal(query.status, 403);
    const emit = await call('POST', '/api/policies/emit', { state: { tomador: {}, vehicle: {}, rcv: { frecuencia: 'A' } }, plan: 'RCVBAS' });
    assert.equal(emit.status, 299);
    assert.equal(emit.body.legacy, true);
    assert.equal(calls.cotizacion.length, 0);
    assert.equal(calls.emit.length, 0);
  } finally {
    close();
  }
});

test('cotización no emitible (casco): se muestra el motivo y no deja preparar el pago', async () => {
  const calls = newCalls();
  const cot = cotizacionMock({ emitible: false, motivos: [{ codigo: 'CASCO', mensaje: 'Incluye casco' }], opciones: [{ opcion: 1, primaUsd: 500, soloRcv: false, coberturas: [] }] });
  const { call, close } = setupApp({ metadata: { cotizacionID: '4512345' }, cotizacion: cot, calls });
  try {
    const actual = await call('GET', '/api/rcv-cotizacion/actual');
    assert.equal(actual.status, 200);
    assert.equal(actual.body.emitible, false);
    assert.match(actual.body.motivos[0].mensaje, /Auto Casco/);
    assert.deepEqual(actual.body.frecuencias, []);
    const checkout = await call('POST', '/api/rcv-cotizacion/checkout', { opcion: 1, frecuencia: 'A' });
    assert.equal(checkout.status, 409);
    assert.equal(checkout.body.code, 'COTIZACION_NO_EMITIBLE');
    assert.equal(checkout.body.ticket, undefined);
    assert.deepEqual(calls.cotizacion, ['4512345', '4512345']);
  } finally {
    close();
  }
});

test('cotización inexistente: 404 COTIZACION_NO_EXISTE', async () => {
  const calls = newCalls();
  const { call, close } = setupApp({
    metadata: { cotizacionID: '1' },
    cotizacion: () => { const e = new Error('No existe la cotización 1.'); e.code = 'COTIZACION_NO_EXISTE'; e.httpStatus = 404; throw e; },
    calls,
  });
  try {
    const actual = await call('GET', '/api/rcv-cotizacion/actual');
    assert.equal(actual.status, 404);
    assert.equal(actual.body.code, 'COTIZACION_NO_EXISTE');
  } finally {
    close();
  }
});

test('flujo completo: vista → checkout (1er recibo) → emisión post-pago con cproces/ccerti/mprima_esperada', async () => {
  const calls = newCalls();
  const { call, close } = setupApp({ metadata: { cotizacionID: '4512345', centidad: 'P', citem: '80080' }, cotizacion: cotizacionMock(), calls });
  try {
    const actual = await call('GET', '/api/rcv-cotizacion/actual');
    assert.equal(actual.status, 200);
    assert.equal(actual.body.emitible, true);
    assert.deepEqual(actual.body.frecuencias.map((f) => f.code), ['A', 'M']); // D no aplica a RCV nacional
    assert.equal(actual.body.opciones[0].rcvBasicoUsd, 36.98);

    const badFreq = await call('POST', '/api/rcv-cotizacion/checkout', { opcion: 1, frecuencia: 'T' });
    assert.equal(badFreq.status, 400);

    // Sin profesión no se cobra: el SP la exige (99013) y el pago quedaría sin póliza.
    const sinProfesion = await call('POST', '/api/rcv-cotizacion/checkout', {
      opcion: 1, frecuencia: 'M', vehicle: { placa: 'ab-123-cd', serial: '9BRBL3HE0L0123456' },
      tomador: { cprofesion: 12 },
    });
    assert.equal(sinProfesion.status, 400);
    assert.equal(sinProfesion.body.code, 'PROFESION_REQUERIDA');
    assert.equal(sinProfesion.body.ticket, undefined);

    const checkout = await call('POST', '/api/rcv-cotizacion/checkout', {
      opcion: 1, frecuencia: 'M', vehicle: { placa: 'ab-123-cd', serial: '9BRBL3HE0L0123456' },
      tomador: { cprofesion: 12, cocupacion: 34 },
    });
    assert.equal(checkout.status, 200);
    assert.equal(checkout.body.montos.primerUsd, 43.94);
    assert.equal(checkout.body.montos.primerVes, 10990.42);
    assert.deepEqual(checkout.body.quote, { mprima: 30139.87, mprimaext: 120.5, ptasa: 250.1234, primaCuotaInicial: 36.98 });
    assert.equal(calls.validate[0].placa, 'AB123CD');
    assert.equal(actual.body.ptasa, 250.1234);
    assert.deepEqual(checkout.body.bloqueados.tomador, { tipoDoc: 'V', identificacion: '12345678', nombre: 'ANA MARIA', apellido: 'PEREZ GOMEZ' });
    assert.equal(checkout.body.bloqueados.vehicle.cmarca, '021');
    assert.equal(checkout.body.bloqueados.vehicle.placa, undefined);
    assert.deepEqual(checkout.body.bloqueados.selectedPlan, { cplan: 'RCVBAS', name: 'RCV Básico' });
    const ticket = checkout.body.ticket;
    assert.ok(ticket);

    const state = {
      ...clientState(),
      rcv: { frecuencia: 'M', ndias: 30, cotizacionRcv: { ticket, cproces: '4512345', opcion: 1 } },
      quote: { ...checkout.body.quote, ptasa: 1 }, // tasa manipulada: no se usa
      paymentVerified: true,
      paymentCapture: { reference: '123456', amount: 10990.42 },
    };

    // Frecuencia distinta a la cobrada.
    const otraFreq = await call('POST', '/api/policies/emit', { state: { ...state, rcv: { ...state.rcv, frecuencia: 'A' } } });
    assert.equal(otraFreq.status, 400);
    assert.equal(otraFreq.body.code, 'FRECUENCIA_NO_COINCIDE');

    // Comprobante alterado.
    const alterado = await call('POST', '/api/policies/emit', { state: { ...state, rcv: { ...state.rcv, cotizacionRcv: { ticket: `${ticket}x` } } } });
    assert.equal(alterado.status, 403);

    const emit = await call('POST', '/api/policies/emit', { state, plan: 'RCVBAS', frecuencia: 'M' });
    assert.equal(emit.status, 201);
    assert.equal(emit.body.policy.cnpoliza, '18-1-0000099');
    assert.equal(emit.body.policy.url_ingreso_caja, 'https://x/caja.pdf');
    assert.equal(calls.emit.length, 1);
    const body = calls.emit[0];
    assert.equal(body.cproces, '4512345');
    assert.equal(body.ccerti_cotizacion, 1);
    assert.equal(body.mprima_esperada, 120.5);
    assert.equal(body.itipoEmi, 'NU');
    assert.equal(body.cplan, 'RCVBAS');
    // Profesión del navegador llega al SP (debida diligencia simplificada).
    assert.equal(body.cprofesion_tomador, 12);
    assert.equal(body.cocupacion_tomador, 34);
    assert.equal(body.cmarca, '021');
    assert.equal(body.xrif_tomador, 12345678);
    assert.equal(body.ptasa, 250.1234);
    assert.equal(body.ifrecuencia, 'M');
  } finally {
    close();
  }
});

test('emitir como pendiente: sin rol 402; admin o productor emite sin cobro (recibo pendiente)', async () => {
  const ticket = lib.signTicket({ cproces: '4512345', opcion: 1, frecuencia: 'A', primaUsd: 120.5 });
  const state = {
    ...clientState(),
    rcv: { frecuencia: 'A', cotizacionRcv: { ticket } },
    paymentVerified: false,
  };
  for (const metadata of [{ cotizacionID: '4512345' }, { cotizacionID: '4512345', cproductor: '80080' }, { cotizacionID: '4512345', origen: 'marketplace', crol: '1' }]) {
    const calls = newCalls();
    const app = setupApp({ metadata, cotizacion: cotizacionMock(), calls });
    try {
      const r = await app.call('POST', '/api/policies/emit', { state });
      assert.equal(r.status, 402, JSON.stringify(metadata));
      assert.equal(r.body.code, 'PAGO_REQUERIDO');
      assert.equal(calls.emit.length, 0);
    } finally {
      app.close();
    }
  }
  for (const metadata of [{ cotizacionID: '4512345', crol: '1' }, { cotizacionID: '4512345', centidad: 'P', cproductor: '12345' }, { cotizacionID: '4512345', origen: 'backoffice' }]) {
    const calls = newCalls();
    const app = setupApp({ metadata, cotizacion: cotizacionMock(), calls });
    try {
      const r = await app.call('POST', '/api/policies/emit', { state });
      assert.equal(r.status, 201, JSON.stringify(metadata));
      assert.equal(calls.emit.length, 1);
      // El cobro lo omite resolveIngresoCajaAfterPayment (paymentVerified=false); aquí está simulado.
    } finally {
      app.close();
    }
  }
});

test('token de Pagos sin cotizacionID: emite con el comprobante; token con otra cotización: 403', async () => {
  const calls = newCalls();
  const ticket = lib.signTicket({ cproces: '4512345', opcion: 1, frecuencia: 'A', primaUsd: 120.5 });
  const state = {
    ...clientState(),
    rcv: { frecuencia: 'A', cotizacionRcv: { ticket } },
    paymentVerified: true,
    paymentCapture: { reference: '123456' },
  };
  let app = setupApp({ metadata: { cproductor: '80080' }, cotizacion: cotizacionMock(), calls });
  try {
    const ok = await app.call('POST', '/api/policies/emit', { state });
    assert.equal(ok.status, 201);
    assert.equal(calls.emit[0].cproces, '4512345');
  } finally {
    app.close();
  }
  app = setupApp({ metadata: { cotizacionID: '777' }, cotizacion: cotizacionMock(), calls: newCalls() });
  try {
    const otra = await app.call('POST', '/api/policies/emit', { state });
    assert.equal(otra.status, 403);
  } finally {
    app.close();
  }
});

test('errores del SP (400 con code) se devuelven con texto claro', async () => {
  for (const code of ['COTIZACION_NO_EXISTE', 'COTIZACION_EMITIDA', 'COTIZACION_NO_COINCIDE']) {
    const calls = newCalls();
    const { call, close } = setupApp({
      metadata: { cotizacionID: '4512345' },
      cotizacion: cotizacionMock(),
      calls,
      emitImpl: () => {
        const e = new Error('Bad Request');
        e.code = 'NEST_API_EMISSION_ERROR';
        e.httpStatus = 400;
        e.raw = { success: false, code, message: 'detalle del SP' };
        throw e;
      },
    });
    try {
      const ticket = lib.signTicket({ cproces: '4512345', opcion: 1, frecuencia: 'A', primaUsd: 120.5 });
      const res = await call('POST', '/api/policies/emit', {
        state: { ...clientState(), rcv: { frecuencia: 'A', cotizacionRcv: { ticket } }, paymentVerified: true },
      });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, code);
      assert.ok(res.body.message.startsWith(require('../src/services/rcvCotizacionService').SP_ERROR_MESSAGES[code]));
      assert.match(res.body.message, /detalle del SP/);
    } finally {
      close();
    }
  }
});

test('token con cotizacionID pero state sin comprobante: no cae a la emisión de siempre', async () => {
  const calls = newCalls();
  const { call, close } = setupApp({ metadata: { cotizacionID: '4512345' }, cotizacion: cotizacionMock(), calls });
  try {
    const res = await call('POST', '/api/policies/emit', { state: { ...clientState(), paymentVerified: true } });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'COTIZACION_DATOS_INCOMPLETOS');
    assert.equal(calls.emit.length, 0);
  } finally {
    close();
  }
});
