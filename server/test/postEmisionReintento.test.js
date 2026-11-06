/**
 * Reintento de cobro post-emisión (fase 2): lógica pura + candado anti doble-cobro.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  indexarResoluciones,
  esReintentable,
  seleccionar,
  fpagoDe,
  reintentarUno,
  STEP_OK,
  STEP_YA,
  STEP_FALLO,
} = require('../src/services/postEmisionReintento');

function pendiente(over = {}) {
  return {
    timestamp: '2026-11-06T15:00:00.000Z',
    step: 'cobro_error',
    cnrecibo: '18-100272044',
    cnpoliza: '18-1-0000138525',
    paymentVerified: true,
    paymentReference: '47701874',
    paymentAmount: 33200.33,
    ...over,
  };
}

test('esReintentable exige step cobro_error, cnrecibo, referencia, verificado y monto>0', () => {
  assert.equal(esReintentable(pendiente()), true);
  assert.equal(esReintentable(pendiente({ step: 'cobro_omitido_sin_referencia' })), false);
  assert.equal(esReintentable(pendiente({ cnrecibo: '' })), false);
  assert.equal(esReintentable(pendiente({ paymentReference: '' })), false);
  assert.equal(esReintentable(pendiente({ paymentVerified: false })), false);
  assert.equal(esReintentable(pendiente({ paymentAmount: 0 })), false);
});

test('indexarResoluciones marca resueltos y cuenta fallos por cnrecibo', () => {
  const recs = [
    pendiente(),
    { cnrecibo: '18-100272044', step: STEP_FALLO },
    { cnrecibo: '18-100272044', step: STEP_FALLO },
    { cnrecibo: '9-1', step: STEP_OK },
  ];
  const { resueltos, intentos } = indexarResoluciones(recs);
  assert.equal(resueltos.has('9-1'), true);
  assert.equal(resueltos.has('18-100272044'), false);
  assert.equal(intentos.get('18-100272044'), 2);
});

test('seleccionar excluye resueltos, deduplica por cnrecibo y separa agotados', () => {
  const recs = [
    // más reciente primero (como listarPendientes)
    pendiente({ timestamp: '2026-11-06T16:00:00.000Z' }),
    pendiente({ timestamp: '2026-11-06T15:00:00.000Z' }),
    pendiente({ cnrecibo: '9-1' }),
    { cnrecibo: '9-1', step: STEP_OK }, // ya resuelto → fuera
    pendiente({ cnrecibo: '7-7' }),
    { cnrecibo: '7-7', step: STEP_FALLO },
    { cnrecibo: '7-7', step: STEP_FALLO },
  ];
  const { aReintentar, agotados } = seleccionar(recs, { max: 2 });
  const cns = aReintentar.map((r) => r.cnrecibo);
  assert.deepEqual(cns, ['18-100272044']); // dedup + 9-1 resuelto + 7-7 agotado
  assert.equal(aReintentar[0].timestamp, '2026-11-06T16:00:00.000Z'); // el más reciente
  assert.deepEqual(agotados.map((r) => r.cnrecibo), ['7-7']);
});

test('fpagoDe usa la fecha del incidente (YYYY-MM-DD)', () => {
  assert.equal(fpagoDe(pendiente()), '2026-11-06');
  assert.match(fpagoDe({}), /^\d{4}-\d{2}-\d{2}$/);
});

test('reintentarUno NO cobra si el recibo ya está cobrado (candado anti doble-cobro)', async () => {
  let activateCalls = 0;
  const resoluciones = [];
  const res = await reintentarUno(pendiente(), {
    reciboEstado: async () => ({ found: true, cobrado: true }),
    activate: async () => { activateCalls += 1; return {}; },
    registrar: (r) => resoluciones.push(r),
  });
  assert.equal(res.outcome, 'ya_cobrado');
  assert.equal(activateCalls, 0, 'no debe llamar al cobro');
  assert.equal(resoluciones[0].step, STEP_YA);
});

test('reintentarUno cobra cuando el recibo sigue pendiente', async () => {
  let activateArgs = null;
  const resoluciones = [];
  const res = await reintentarUno(pendiente(), {
    reciboEstado: async () => ({ found: true, cobrado: false }),
    activate: async (args) => { activateArgs = args; return { ingresoCaja: 'http://x/ingreso/1' }; },
    registrar: (r) => resoluciones.push(r),
  });
  assert.equal(res.outcome, 'cobrado');
  assert.equal(activateArgs.cnrecibo, '18-100272044');
  assert.equal(activateArgs.xreferencia, '47701874');
  assert.equal(activateArgs.mpago, 33200.33);
  assert.equal(resoluciones[0].step, STEP_OK);
});

test('reintentarUno no reintenta ni marca si no puede verificar en Sis2000', async () => {
  let activateCalls = 0;
  const resoluciones = [];
  const res = await reintentarUno(pendiente(), {
    reciboEstado: async () => ({ found: false, cobrado: false }),
    activate: async () => { activateCalls += 1; return {}; },
    registrar: (r) => resoluciones.push(r),
  });
  assert.equal(res.outcome, 'sin_verificar');
  assert.equal(activateCalls, 0);
  assert.equal(resoluciones.length, 0, 'no escribe resolución: se reevalúa luego');
});

test('reintentarUno registra fallo (contable para el tope) cuando el cobro falla', async () => {
  const resoluciones = [];
  const res = await reintentarUno(pendiente(), {
    reciboEstado: async () => ({ found: true, cobrado: false }),
    activate: async () => { const e = new Error('HTTP 502'); e.httpStatus = 502; throw e; },
    registrar: (r) => resoluciones.push(r),
  });
  assert.equal(res.outcome, 'fallo');
  assert.equal(resoluciones[0].step, STEP_FALLO);
});
