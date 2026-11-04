/**
 * Personas: tomador persona jurídica (RIF J) y pasaporte (P).
 * RCV: sin cambios respecto a main (pasaporte viaja como 'V' con solo los dígitos).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const personasMapper = require('../src/services/personasMapper');
const { buildEmissionRequest } = require('../src/services/policyMapper');
const { validateEmissionPayload } = require('../src/services/policyValidator');

const titularNatural = {
  tipoDoc: 'V', identificacion: '12345678', nombre: 'ANA', apellido: 'PEREZ',
  sexo: 'F', estadoCivil: 'S', fechaNac: '1990-05-10', parentesco: 1,
};

function estadoPersonas(tomador, asegurados = [titularNatural], extra = {}) {
  return {
    tomador,
    sameInsured: false,
    selectedPlan: { cplan: 'FUN01' },
    funeral: { asegurados, beneficiarios: [] },
    ...extra,
  };
}

const tomadorJ = {
  tipoDoc: 'J', identificacion: '313005495', nombre: 'UNIDAD INTEGRAL DE SALUD UNISA, C.A.',
  apellido: '', sexo: '', estadoCivil: '', fechaNac: '', direccion: 'CARACAS',
  telefono: '04141234567', email: 'unisa@example.com',
};

test('personas: tomador J → razón social, apellido vacío, sexo/estado civil null, fnac sin ""', () => {
  const { payload } = personasMapper.buildEmissionPersonRequest(estadoPersonas(tomadorJ), { mprimaext: 10, ptasa: 40 });
  assert.equal(payload.tipo_cedula_tomador, 'J');
  assert.equal(payload.rif_tomador, 313005495);
  assert.equal(payload.nombre_tomador, 'UNIDAD INTEGRAL DE SALUD UNISA, C.A.');
  assert.equal(payload.apellido_tomador, '');
  assert.equal(payload.sexo_tomador, null);
  assert.equal(payload.estado_civil_tomador, null);
  assert.equal(payload.fnac_tomador, null);
  assert.notEqual(payload.fnac_tomador, '');
  // El titular natural no hereda datos del tomador J.
  assert.equal(payload.tipo_cedula_titular, 'V');
  assert.equal(payload.estado_civil_titular, 'S');
  assert.deepEqual(personasMapper.validatePersonasIdentidades(estadoPersonas(tomadorJ)), []);
});

test('personas: tomador J usa constitución o inscripción del RIF (OCR) como fnac', () => {
  const conOcr = estadoPersonas(tomadorJ, [titularNatural], {
    documents: { cedula: { ocr: { fechaInscripcion: '15/03/2004' } } },
  });
  assert.equal(personasMapper.buildEmissionPersonRequest(conOcr, {}).payload.fnac_tomador, '2004-03-15');
  const conConstitucion = estadoPersonas({ ...tomadorJ, fechaConstitucion: '2001-01-20' });
  assert.equal(personasMapper.buildEmissionPersonRequest(conConstitucion, {}).payload.fnac_tomador, '2001-01-20');
  const validate = personasMapper.buildValidateEmissionPersonRequest(estadoPersonas(tomadorJ));
  assert.equal(validate.fnac_tomador, null);
  assert.equal(validate.tipo_cedula_titular, 'V');
});

test('personas: J/G/C como titular, asegurado o beneficiario → error (400 en la ruta)', () => {
  assert.equal(personasMapper.validatePersonasIdentidades(estadoPersonas(tomadorJ, [])).length, 1);
  assert.equal(personasMapper.validatePersonasIdentidades(estadoPersonas(titularNatural, [{ ...tomadorJ, parentesco: 1 }])).length, 1);
  assert.equal(
    personasMapper.validatePersonasIdentidades(estadoPersonas(titularNatural, [titularNatural, { ...titularNatural, tipoDoc: 'G' }])).length,
    1,
  );
  const conBenJ = estadoPersonas(titularNatural);
  conBenJ.funeral.beneficiarios = [{ tipoDoc: 'C', identificacion: '123456789', nombre: 'X' }];
  assert.equal(personasMapper.validatePersonasIdentidades(conBenJ).length, 1);
});

test('personas: pasaporte numérico → P; alfanumérico (caso EM2849387) titular/tomador → cid + dígitos', () => {
  const pasNum = { ...titularNatural, tipoDoc: 'P', identificacion: '123456789' };
  const { payload } = personasMapper.buildEmissionPersonRequest(estadoPersonas(pasNum, [pasNum]), {});
  assert.equal(payload.tipo_cedula_tomador, 'P');
  assert.equal(payload.tipo_cedula_titular, 'P');
  assert.equal(payload.asegurados[0].icedula_asegurado, 'P');
  assert.equal(payload.rif_titular, 123456789);
  assert.equal(payload.cid_titular, undefined);

  const pasAlfa = { ...titularNatural, tipoDoc: 'P', identificacion: 'EM2849387', nombre: 'ZHIZHONG', apellido: 'HUANG', sexo: 'M', fechaNac: '1988-02-24' };
  const st = estadoPersonas(pasAlfa, [pasAlfa]);
  assert.deepEqual(personasMapper.validatePersonasIdentidades(st), []);
  const p = personasMapper.buildEmissionPersonRequest(st, {}).payload;
  assert.equal(p.cid_titular, 'P-EM2849387');
  assert.equal(p.cid_tomador, 'P-EM2849387');
  assert.equal(p.rif_titular, 2849387);
  assert.equal(p.rif_tomador, 2849387);
  assert.equal(p.tipo_cedula_titular, 'P');
  assert.equal(p.asegurados[0].icedula_asegurado, 'P');
  assert.equal(p.asegurados[0].xrif_asegurado, 2849387);
  const v = personasMapper.buildValidateEmissionPersonRequest(st, { plan: 'FUN01' });
  assert.equal(v.cid_titular, 'P-EM2849387');
  assert.equal(v.rif_titular, 2849387);

  // Menos de 5 dígitos o más de 13 caracteres → error claro.
  const corto = { ...pasAlfa, identificacion: 'EMX1234' };
  assert.match(personasMapper.validatePersonasIdentidades(estadoPersonas(corto, [corto]))[0], /entre 5 y 9 dígitos/);
  const largo = { ...pasAlfa, identificacion: 'ABCDEFG1234567' };
  assert.ok(personasMapper.validatePersonasIdentidades(estadoPersonas(largo, [largo])).length >= 1);

  // Asegurado adicional / beneficiario con pasaporte alfanumérico: sigue bloqueado.
  const errs = personasMapper.validatePersonasIdentidades(estadoPersonas(titularNatural, [titularNatural, pasAlfa]));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /Asegurado 2: .*RIF personal E-xxxxxxxx-x/);
});

function estadoRcv(tomador) {
  return {
    tomador: {
      telefono: '04141234567', email: 'x@example.com', direccion: 'CARACAS', estado: 'DISTRITO CAPITAL',
      ciudad: 'CARACAS', ...tomador,
    },
    sameInsured: true,
    vehicle: { placa: 'AB123CD', serialCarroceria: 'SER123', año: 2015, marca: 'TOYOTA', modelo: 'COROLLA' },
    rcv: {},
  };
}

const cot = { mprima: 100, mprimaext: 2.5, ptasa: 40 };

test('RCV: pasaporte numérico sigue como en main (V con dígitos)', () => {
  const p = buildEmissionRequest(estadoRcv({
    tipoDoc: 'P', identificacion: '12345678', nombre: 'JOHN', apellido: 'DOE', sexo: 'M', fechaNac: '1980-01-01',
  }), cot).payload;
  assert.equal(p.tipo_cedula_tomador, 'V');
  assert.equal(p.tipo_cedula_titular, 'V');
  assert.equal(p.rif_tomador, '12345678');
  const errs = validateEmissionPayload(p);
  assert.ok(!errs.some((e) => /rif_tomador|tipo_cedula/.test(e)), errs.join('; '));
});

test('RCV: pasaporte alfanumérico sigue como en main (V con solo los dígitos)', () => {
  const p = buildEmissionRequest(estadoRcv({
    tipoDoc: 'P', identificacion: 'EM2849387', nombre: 'ZHIZHONG', apellido: 'HUANG', sexo: 'M', fechaNac: '1988-02-24',
  }), cot).payload;
  assert.equal(p.tipo_cedula_tomador, 'V');
  assert.equal(p.rif_tomador, '2849387');
});

test('RCV: V sin cambios', () => {
  const p = buildEmissionRequest(estadoRcv({
    tipoDoc: 'V', identificacion: 'V-19.529.692', nombre: 'LUIS', apellido: 'REYES', sexo: 'M', fechaNac: '1990-01-01',
  }), cot).payload;
  assert.equal(p.tipo_cedula_tomador, 'V');
  assert.equal(p.rif_tomador, '19529692');
});
