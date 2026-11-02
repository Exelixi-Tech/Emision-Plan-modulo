/**
 * RCV persona jurídica (RIF J): mapper y validador.
 * nombre = razón social; apellido según RCV_PJ_APELLIDO_MODO; fnac = constitución → inscripción RIF → emisión;
 * itipo_diligencia 'C'. Persona natural sin cambios.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEmissionRequest } = require('../src/services/policyMapper');
const { validateEmissionPayload } = require('../src/services/policyValidator');

function estadoPJ(extraTomador = {}) {
  return {
    tomador: {
      tipoDoc: 'J',
      identificacion: '313005495',
      nombre: 'UNIDAD INTEGRAL DE SALUD UNISA, C.A.',
      apellido: '',
      telefono: '04141234567',
      email: 'unisa@example.com',
      sexo: '',
      estadoCivil: '',
      fechaNac: '',
      cestado: 17,
      cciudad: 1,
      direccion: 'AV EL CALVARIO EDIF UNISA S/N PISO PB',
      itipoDiligencia: 'S',
      ...extraTomador,
    },
    sameInsured: true,
    vehicle: { placa: 'AB123CD', serial: '8X1234567890', año: '2015', marca: 'TOYOTA', modelo: 'COROLLA' },
    documents: { cedula: { ocr: { tipoDoc: 'J', fechaInscripcion: '2005-03-21', razonSocial: 'UNIDAD INTEGRAL DE SALUD UNISA, C.A.' } } },
  };
}

function build(state) {
  return buildEmissionRequest(state, { mprima: 10, mprimaext: 1, ptasa: 1 }).payload;
}

test('J: nombre = razón social, apellido = razón social por defecto, fnac = inscripción RIF, diligencia C', () => {
  delete process.env.RCV_PJ_APELLIDO_MODO;
  const p = build(estadoPJ());
  assert.equal(p.tipo_cedula_tomador, 'J');
  assert.equal(p.rif_tomador, '313005495');
  assert.equal(p.nombre_tomador, 'UNIDAD INTEGRAL DE SALUD UNISA, C.A.');
  assert.equal(p.apellido_tomador, 'UNIDAD INTEGRAL DE SALUD UNISA, C.A.');
  assert.equal(p.fnac_tomador, '2005-03-21');
  assert.equal(p.fnac_titular, '2005-03-21');
  assert.equal(p.itipo_diligencia, 'C');
  assert.equal(p.tipo_cedula_titular, 'J');
  assert.equal(p.apellido_titular, p.apellido_tomador);
});

test('J con RCV_PJ_APELLIDO_MODO=vacio manda apellido vacío y pasa el validador de persona', () => {
  process.env.RCV_PJ_APELLIDO_MODO = 'vacio';
  try {
    const p = build(estadoPJ());
    assert.equal(p.apellido_tomador, '');
    const errs = validateEmissionPayload(p);
    for (const e of errs) assert.doesNotMatch(e, /apellido|fnac|mayor de edad|tipo_cedula|rif_/);
  } finally {
    delete process.env.RCV_PJ_APELLIDO_MODO;
  }
});

test('J sin inscripción ni constitución usa la fecha de emisión', () => {
  const st = estadoPJ();
  st.documents = {};
  const p = build(st);
  assert.equal(p.fnac_tomador, p.fecha_emision);
});

test('J con fecha de constitución del formulario la respeta', () => {
  const p = build(estadoPJ({ fechaNac: '2010-01-15' }));
  assert.equal(p.fnac_tomador, '2010-01-15');
});

test('validador: persona natural sigue exigiendo apellido y fnac', () => {
  const st = estadoPJ({ tipoDoc: 'V', identificacion: '19529692', nombre: 'ANA', apellido: '' });
  st.documents = {};
  const errs = validateEmissionPayload(build(st));
  assert.ok(errs.includes('apellido_tomador requerido'));
  assert.ok(errs.some((e) => e.startsWith('fnac_tomador')));
});
