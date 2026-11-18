/**
 * Selector de planes de viajero (reunión La Mundial 18-nov-2026): qué planes aplican a N días.
 * Datos de Sis2000_QA: ramo 5 VIAJE4..VIAJE9 (E, 3..8 días) + VIAJ10 (E/0, «por 15 días»);
 * ramo 25 VIAJE5/VIAJE6 (3.000 $ / 5.000 $, 1 a 10 días por la regla de nest-api).
 *
 * Correr: node --test frontend/src/lib/viajeroPlanes.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Plan } from '../types';
import {
  familiaViajeKey,
  familiasViaje,
  limitesDiasViaje,
  opcionesViajeParaDias,
  sumaDelNombre,
} from './viajeroPlanes.ts';

function plan(cramo: number, cplan: string, name: string, extra: Partial<Plan> = {}): Plan {
  const m = name.match(/(\d+)\s*d[ií]as?/i);
  return {
    cplan,
    cramo,
    name,
    price: '',
    priceNum: 0,
    tag: '',
    desc: '',
    benefits: ['Vigencia de 3 días', 'Asistencia en viaje'],
    sumaAsegurada: 0,
    ndias: m ? Number(m[1]) : null,
    ...extra,
  };
}

/** Ramo 5 como llega con nest-api nuevo: ndias de maplanes_frec en los planes de días fijos. */
function familia1500(conFrecuencias = true): Plan[] {
  const fijos = [3, 4, 5, 6, 7, 8].map((d, i) =>
    plan(5, `VIAJE${4 + i}`, `Plan II 1.500$ Viajero por ${d} días`, conFrecuencias ? { ndias: d, ndiasFijo: true } : {}),
  );
  return [...fijos, plan(5, 'VIAJ10', 'Plan II 1.500$ Viajero por 15 días')];
}

const viaje5 = plan(25, 'VIAJE5', 'Plan 3.000$ Viajero Local por Días', { ndiasMin: 1, ndiasMax: 10 });
const viaje6 = plan(25, 'VIAJE6', 'Plan 5.000$ Viajero Local por Días', { ndiasMin: 1, ndiasMax: 10 });
const canal = [...familia1500(), viaje5, viaje6];

const resumen = (plans: Plan[], n: number) =>
  opcionesViajeParaDias(plans, n).map((o) => `${o.plan.cramo}:${o.plan.cplan}`);

test('hasta 10 días: 1.500 $ (principal), 3.000 $ y 5.000 $', () => {
  assert.deepEqual(resumen(canal, 5), ['5:VIAJE6', '25:VIAJE5', '25:VIAJE6']);
  assert.deepEqual(resumen(canal, 10), ['5:VIAJ10', '25:VIAJE5', '25:VIAJE6']);
  assert.deepEqual(
    opcionesViajeParaDias(canal, 5).map((o) => o.sumaNombre),
    [1500, 3000, 5000],
  );
});

test('de 11 a 15 días: solo el principal (VIAJ10)', () => {
  for (const n of [11, 13, 15]) assert.deepEqual(resumen(canal, n), ['5:VIAJ10']);
  assert.deepEqual(resumen(canal, 16), []);
});

test('1 y 2 días: el principal no los cubre; solo los planes de 1 a 10 días', () => {
  assert.deepEqual(resumen(canal, 1), ['25:VIAJE5', '25:VIAJE6']);
  assert.deepEqual(resumen(canal, 2), ['25:VIAJE5', '25:VIAJE6']);
  assert.deepEqual(resumen(familia1500(), 2), []);
});

test('el plan de días exactos gana al abierto de la misma familia', () => {
  for (let n = 3; n <= 8; n += 1) {
    assert.deepEqual(resumen(familia1500(), n), [`5:VIAJE${n + 1}`]);
  }
  assert.deepEqual(resumen(familia1500(), 9), ['5:VIAJ10']);
});

test('sin datos de maplanes_frec (nest-api viejo) da lo mismo: regla SysIP por el nombre', () => {
  for (let n = 1; n <= 16; n += 1) {
    assert.deepEqual(resumen(familia1500(false), n), resumen(familia1500(), n), `día ${n}`);
  }
});

test('el plan elegido lleva los días del viaje y conserva el plan real de Sis2000', () => {
  const [op] = opcionesViajeParaDias(familia1500(), 12);
  assert.equal(op.plan.cplan, 'VIAJ10');
  assert.equal(op.plan.ndias, 12);
  assert.equal(op.plan.tag, 'Viajero · 12 días');
  assert.ok(op.plan.benefits.includes('Vigencia de 12 días'));
  assert.deepEqual(op.rango, { min: 3, max: 15 });
});

test('límites de las fechas: del menor al mayor día que cubre algún plan', () => {
  assert.deepEqual(limitesDiasViaje(canal), { min: 1, max: 15 });
  assert.deepEqual(limitesDiasViaje(familia1500()), { min: 3, max: 15 });
  assert.deepEqual(limitesDiasViaje([viaje5]), { min: 1, max: 10 });
});

test('planes sin días (VIAJE1/VIAJE2 del ramo 25) no se ofrecen si otro plan sí dice sus días', () => {
  const sinDias = [
    plan(25, 'VIAJE1', 'Plan I 1.500$ Viajero Local'),
    plan(25, 'VIAJE2', 'Plan II 1.500$ Viajero Local'),
  ];
  assert.deepEqual(resumen([...familia1500(), ...sinDias], 4), ['5:VIAJE5']);
  // Si ningún plan del canal dice sus días, se ofrecen todos, sin tope.
  assert.deepEqual(resumen(sinDias, 20), ['25:VIAJE1', '25:VIAJE2']);
  assert.deepEqual(limitesDiasViaje(sinDias), { min: 1, max: null });
});

test('un plan abierto solo en su familia cubre desde 1 día hasta los suyos', () => {
  assert.deepEqual(resumen([plan(5, 'VIAJ10', 'Plan II 1.500$ Viajero por 15 días')], 1), ['5:VIAJ10']);
});

test('familias y sumas', () => {
  assert.equal(familiaViajeKey(familia1500()[0]), familiaViajeKey(familia1500()[6]));
  assert.notEqual(familiaViajeKey(viaje5), familiaViajeKey(viaje6));
  assert.equal(sumaDelNombre('Plan II 1.500$ Viajero por 3 días'), 1500);
  assert.equal(sumaDelNombre('Plan 5.000 $ Viajero'), 5000);
  assert.equal(sumaDelNombre('Plan Viajero Margarita'), null);
  assert.deepEqual(
    familiasViaje(canal).map((f) => [f.sumaNombre, f.rango.min, f.rango.max]),
    [[1500, 3, 15], [3000, 1, 10], [5000, 1, 10]],
  );
});
