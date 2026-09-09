const { mapWizardToGeneralRisksEmitDto } = require('../src/services/patrimonialMapper');

const sampleState = {
  tomador: {
    tipoDoc: 'V',
    identificacion: '27798623',
    nombre: 'ANDRES',
    apellido: 'QUINTERO FIGUEROA',
    sexo: 'M',
    estadoCivil: 'S',
    fechaNac: '2001-06-02T00:00:00.000Z',
    telefono: '04129855271',
    email: 'quand.mind@gmail.com',
    estado: 'Dtto Capital',
    ciudad: 'Caracas',
    direccion: 'Av Panteon',
    personaPoliticamenteExpuesta: false,
  },
  sameInsured: true,
  patrimoniales: {
    datosBien: 'Apartamento Residencial',
    tipo: 'Residencial',
    descripcion: 'Edificio Vista Hermosa, piso 5, apto 5-B, Av Panteon',
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
