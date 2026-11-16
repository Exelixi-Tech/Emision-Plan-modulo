/**
 * [benef-juridico 16-nov-2026] Vida: beneficiario preferencial (adpoliza.cbeneficiario).
 * Puede ser persona jurídica J/G/C (p. ej. un banco); los beneficiarios por fallecimiento no.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const personasMapper = require('../src/services/personasMapper');

const titular = {
  tipoDoc: 'V', identificacion: '12345678', nombre: 'ANA', apellido: 'PEREZ',
  sexo: 'F', estadoCivil: 'S', fechaNac: '1990-05-10', parentesco: 1,
};
const tomador = { ...titular, direccion: 'CARACAS', telefono: '04141234567', email: 'ana@example.com' };
const banco = {
  tipoDoc: 'J', identificacion: '123456789', nombre: 'BANCO EJEMPLO, C.A.', apellido: 'X',
  sexo: 'Masculino', estadoCivil: 'Soltero(a)', fechaNac: '2000-01-01',
  telefono: '(0212) 123-4567', email: 'contacto@banco.com', cestado: 1, cciudad: 2, direccion: 'AV. PRINCIPAL',
};

function estado(funeralExtra = {}) {
  return {
    tomador,
    sameInsured: true,
    selectedPlan: { cplan: 'TEMP1A', cramo: 1 },
    funeral: { asegurados: [titular], beneficiarios: [], ...funeralExtra },
  };
}

test('preferencial J → beneficiario_preferencial con razón social y sin apellido/sexo/estado civil/fnac', () => {
  const st = estado({ conBeneficiarioPreferencial: true, beneficiarioPreferencial: banco });
  assert.deepEqual(personasMapper.validatePersonasIdentidades(st), []);
  const { payload } = personasMapper.buildEmissionPersonRequest(st, { mprimaext: 50, ptasa: 40 });
  assert.deepEqual(payload.beneficiario_preferencial, {
    tipo_cedula: 'J',
    rif: 123456789,
    nombre: 'BANCO EJEMPLO, C.A.',
    apellido: null,
    sexo: null,
    estado_civil: null,
    fnac: null,
    telefono: '02121234567',
    correo: 'contacto@banco.com',
    estado: 1,
    ciudad: 2,
    direccion: 'AV. PRINCIPAL',
  });
  // No entra a la lista de beneficiarios por fallecimiento (pebenefi).
  assert.deepEqual(payload.beneficiarios, []);
});

test('preferencial G y C también se aceptan', () => {
  for (const tipoDoc of ['G', 'C']) {
    const st = estado({ conBeneficiarioPreferencial: true, beneficiarioPreferencial: { ...banco, tipoDoc } });
    assert.deepEqual(personasMapper.validatePersonasIdentidades(st), []);
    assert.equal(personasMapper.buildBeneficiarioPreferencial(st).tipo_cedula, tipoDoc);
  }
});

test('preferencial J con 8 dígitos → error', () => {
  const st = estado({ conBeneficiarioPreferencial: true, beneficiarioPreferencial: { ...banco, identificacion: '12345678' } });
  const errs = personasMapper.validatePersonasIdentidades(st);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /9 dígitos/);
});

test('preferencial natural: igual que hoy (nombre, apellido, sexo, fnac)', () => {
  const st = estado({
    conBeneficiarioPreferencial: true,
    beneficiarioPreferencial: { ...titular, identificacion: '7654321', nombre: 'LUIS' },
  });
  const pref = personasMapper.buildBeneficiarioPreferencial(st);
  assert.equal(pref.tipo_cedula, 'V');
  assert.equal(pref.apellido, 'PEREZ');
  assert.equal(pref.sexo, 'F');
  assert.equal(pref.fnac, '1990-05-10');
});

test('toggle apagado o sin identificación → no se envía', () => {
  assert.equal(personasMapper.buildBeneficiarioPreferencial(estado({ beneficiarioPreferencial: banco })), undefined);
  assert.equal(
    personasMapper.buildBeneficiarioPreferencial(
      estado({ conBeneficiarioPreferencial: true, beneficiarioPreferencial: { ...banco, identificacion: '' } }),
    ),
    undefined,
  );
  const { payload } = personasMapper.buildEmissionPersonRequest(estado(), {});
  assert.equal('beneficiario_preferencial' in payload, false);
});

test('beneficiario por fallecimiento J y titular J siguen rechazados', () => {
  const conBenJ = estado({ beneficiarios: [{ ...banco, parentesco: 3, pporcen: 100 }] });
  assert.match(personasMapper.validatePersonasIdentidades(conBenJ).join(' '), /Beneficiario 1/);
  const titularJ = estado({ asegurados: [{ ...titular, tipoDoc: 'J', identificacion: '123456789' }] });
  assert.match(personasMapper.validatePersonasIdentidades(titularJ).join(' '), /titular/);
});

test('preferencial con pasaporte alfanumérico → error', () => {
  const st = estado({
    conBeneficiarioPreferencial: true,
    beneficiarioPreferencial: { ...titular, tipoDoc: 'P', identificacion: 'EM2849387' },
  });
  assert.match(personasMapper.validatePersonasIdentidades(st).join(' '), /Beneficiario preferencial/);
});
