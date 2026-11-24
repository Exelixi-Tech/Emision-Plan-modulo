/**
 * RCV 18-1-0000139376: el wizard traía el nombre «Masculino» (precarga del OCR con la foto girada)
 * y Emisión registró en Nexus «Masculino RODRIGUEZ PEÑA». Lo que se manda al monitor (registro y
 * snapshot del expediente) no lleva un nombre que sea solo sexo o estado civil. Las razones sociales
 * y los nombres reales no se tocan.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { _internal: feed } = require('../src/services/expedienteFeed');
const { _internal: registro } = require('../src/services/nexusEmisionFeed');

const DANRY = { tipoDoc: 'V', identificacion: '13307292', nombre: 'Masculino', apellido: 'RODRIGUEZ PEÑA' };

test('snapshot: nombre «Masculino» de persona natural → null; apellido y documento intactos', () => {
  assert.deepEqual(feed.persona(DANRY), {
    tipoDoc: 'V',
    documento: '13307292',
    nombre: null,
    apellido: 'RODRIGUEZ PEÑA',
  });
});

test('registro: tomadorNombre sin la palabra de sexo', () => {
  assert.equal(registro.tomadorNombre({ tomador: DANRY }), 'RODRIGUEZ PEÑA');
  assert.equal(
    registro.tomadorNombre({ tomador: { ...DANRY, nombre: 'Danry Fernando' } }),
    'Danry Fernando RODRIGUEZ PEÑA',
  );
});

test('negativa: razón social que empieza por «Venezolana» (18-1-0000140091) no se toca', () => {
  const emp = {
    tipoDoc: 'J',
    identificacion: '301234567',
    nombre: 'Venezolana de Instrumentación Mecanica y Electricidad Venime',
    apellido: '',
  };
  assert.equal(feed.persona(emp).nombre, emp.nombre);
  assert.equal(registro.tomadorNombre({ tomador: emp }), emp.nombre);
  // Una empresa cuyo nombre fuera solo una de esas palabras tampoco se toca.
  assert.equal(feed.persona({ ...emp, nombre: 'FEMENINO' }).nombre, 'FEMENINO');
});

test('negativa: nombres reales con esas palabras dentro se conservan', () => {
  const p = feed.persona({ tipoDoc: 'V', identificacion: '9111222', nombre: 'María Soltero', apellido: 'Casado Viuda' });
  assert.equal(p.nombre, 'María Soltero');
  // «Casado Viuda» completo sí es solo estado civil: no se manda (el monitor lo pide como sin dato).
  assert.equal(p.apellido, null);
  assert.equal(feed.persona({ tipoDoc: 'V', identificacion: '9111222', nombre: 'Luis', apellido: 'Casado Pérez' }).apellido, 'Casado Pérez');
});
