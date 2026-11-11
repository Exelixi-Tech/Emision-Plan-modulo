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

// Bug QA 02-nov: tomador J (EXELIXI, inscripción 2025-05-14) + titular V distinto sin fechaNac
// → Emisión heredaba la fecha del RIF al titular (0 años) y rechazaba "titular debe ser mayor de edad".
function estadoTomadorJTitularV(extraTitular = {}, documents) {
  const st = estadoPJ({ identificacion: '506973332', nombre: 'EXELIXI TECH, C.A.', fechaNac: '2025-05-14' });
  st.sameInsured = false;
  st.asegurado = {
    tipoDoc: 'V', identificacion: '14484939', nombre: 'JOSE MANUEL', apellido: 'SOUTO FERNANDEZ',
    telefono: '04141234567', email: 'jose@example.com', sexo: 'M', estadoCivil: 'S', fechaNac: '',
    cestado: 17, cciudad: 1, direccion: 'CARACAS', ...extraTitular,
  };
  st.documents = documents || {
    cedula: { ocr: { tipoDoc: 'J', identificacion: '506973332', razonSocial: 'EXELIXI TECH, C.A.', fechaInscripcion: '2025-05-14' } },
    licencia: { ocr: { identificacion: 'V14484939', nombre: 'JOSE MANUEL', apellido: 'SOUTO FERNANDEZ', fechaNacimiento: '1979-09-07' } },
  };
  return st;
}

test('tomador J + titular V sin fecha: titular toma la fecha de la licencia OCR, nunca la del RIF', () => {
  const p = build(estadoTomadorJTitularV());
  assert.equal(p.tipo_cedula_tomador, 'J');
  assert.equal(p.tipo_cedula_titular, 'V');
  assert.equal(p.fnac_tomador, '2025-05-14');
  assert.equal(p.fnac_titular, '1979-09-07');
  assert.equal(p.nombre_titular, 'JOSE MANUEL');
  assert.equal(p.apellido_titular, 'SOUTO FERNANDEZ');
  assert.equal(p.nombre_tomador, 'EXELIXI TECH, C.A.');
  const errs = validateEmissionPayload(p);
  for (const e of errs) assert.doesNotMatch(e, /fnac|mayor de edad|apellido_titular/);
});

test('tomador J + titular V sin fecha ni OCR: fnac_titular vacío (error de formato, no "menor de edad")', () => {
  const p = build(estadoTomadorJTitularV({}, { cedula: { ocr: { tipoDoc: 'J', fechaInscripcion: '2025-05-14' } } }));
  assert.equal(p.fnac_titular, null);
  const errs = validateEmissionPayload(p);
  assert.ok(errs.some((e) => e.startsWith('fnac_titular formato')));
  assert.ok(!errs.includes('titular debe ser mayor de edad (18+)'));
});

test('tomador J + titular V: licencia de otra cédula no se usa; cedula_titular OCR sí', () => {
  const docs = {
    licencia: { ocr: { identificacion: 'V99999999', fechaNacimiento: '1990-01-01' } },
    cedula_titular: { ocr: { identificacion: 'V14484939', fechaNacimiento: '1979-09-07' } },
  };
  assert.equal(build(estadoTomadorJTitularV({}, docs)).fnac_titular, '1979-09-07');
  delete docs.cedula_titular;
  assert.equal(build(estadoTomadorJTitularV({}, docs)).fnac_titular, null);
});

test('titular V con fecha propia la conserva aunque el tomador sea J', () => {
  const p = build(estadoTomadorJTitularV({ fechaNac: '1980-02-02' }));
  assert.equal(p.fnac_titular, '1980-02-02');
  assert.equal(validateEmissionPayload(p).filter((e) => /fnac|mayor de edad/.test(e)).length, 0);
});

test('tomador V sin fecha + titular J: el tomador no hereda la fecha del RIF del titular', () => {
  const st = estadoPJ({ tipoDoc: 'V', identificacion: '19529692', nombre: 'ANA', apellido: 'PEREZ', fechaNac: '' });
  st.sameInsured = false;
  st.asegurado = { tipoDoc: 'J', identificacion: '313005495', nombre: 'UNIDAD INTEGRAL DE SALUD UNISA, C.A.', fechaNac: '', cestado: 17, cciudad: 1, direccion: 'X' };
  st.documents = { cedula_titular: { ocr: { tipoDoc: 'J', fechaInscripcion: '2005-03-21' } } };
  const p = build(st);
  assert.equal(p.fnac_tomador, null);
  assert.equal(p.fnac_titular, '2005-03-21');
  assert.ok(validateEmissionPayload(p).some((e) => e.startsWith('fnac_tomador')));
});

test('sameInsured=true con tomador J: titular también J con la misma fecha PJ', () => {
  const p = build(estadoPJ({ identificacion: '506973332', nombre: 'EXELIXI TECH, C.A.', fechaNac: '' }));
  assert.equal(p.tipo_cedula_titular, 'J');
  assert.equal(p.fnac_titular, p.fnac_tomador);
  assert.equal(validateEmissionPayload(p).filter((e) => /fnac|mayor de edad/.test(e)).length, 0);
});
