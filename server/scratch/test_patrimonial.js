const { mapWizardToGeneralRisksEmitDto } = require('../src/services/patrimonialMapper');

const sampleState = {
  tomador: {
    tipoDoc: 'V',
    identificacion: '12345678',
    nombre: 'JUAN',
    apellido: 'PEREZ PEREZ',
    sexo: 'M',
    estadoCivil: 'S',
    fechaNac: '1990-01-01T00:00:00.000Z',
    telefono: '04140000000',
    email: 'test.user@example.com',
    estado: 'Dtto Capital',
    ciudad: 'Caracas',
    direccion: 'Av Principal, Edif Prueba, Apto 1-A',
    personaPoliticamenteExpuesta: false,
  },
  sameInsured: true,
  patrimoniales: {
    datosBien: 'Inmueble Residencial',
    tipo: 'Residencial',
    descripcion: 'Edificio Residencial, Apto 1-A',
  },
  selectedPlan: {
    cplan: 'RCE9',
    name: 'Responsabilidad Civil Embarcación / Inmueble',
    sumaAsegurada: 50000,
  },
  metadataCanal: {
    ccanalalt: '366',
    cproductor: 366,
  },
  femision: '2026-09-09',
  fdesde: '2026-09-09',
  fhasta: '2027-09-09',
  frecuencia: 'A',
};

const sampleQuote = {
  mprima: 2500,
  mprimaext: 50,
  ptasa: 50,
};

const result = mapWizardToGeneralRisksEmitDto(sampleState, sampleQuote);

console.log('Resulting Payload:');
console.log(JSON.stringify(result.payload, null, 2));

console.log('\nResulting Metadata:');
console.log(JSON.stringify(result.metadata, null, 2));
