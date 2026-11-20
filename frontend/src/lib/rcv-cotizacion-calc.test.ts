/**
 * Emitir RCV desde cotización: primer recibo y validación de "datos que faltan".
 * Correr con: node --test src/lib/rcv-cotizacion-calc.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePrimerRecibo,
  edad,
  emptyPersona,
  normalizePlacaInput,
  validarDatosFaltantes,
  type DatosFaltantes,
} from './rcv-cotizacion-calc.ts';

test('mensual: RCV básico completo + resto ÷ 12; USD a 2 decimales antes de Bs (igual que el server)', () => {
  const m = computePrimerRecibo({ annualUsd: 120.5, rcvBasicoUsd: 36.98, frecuencia: 'M', ptasa: 250.1234 });
  assert.equal(m.cuotas, 12);
  assert.equal(m.primerUsd, 43.94);
  assert.equal(m.siguienteUsd, 6.96);
  assert.equal(m.primerVes, 10990.42);
  assert.equal(m.annualVes, 30139.87);
});

test('anual = prima completa; solo RCV básico = un recibo', () => {
  assert.equal(computePrimerRecibo({ annualUsd: 120.5, rcvBasicoUsd: 36.98, frecuencia: 'A', ptasa: 1 }).primerUsd, 120.5);
  const solo = computePrimerRecibo({ annualUsd: 36.98, rcvBasicoUsd: 36.98, frecuencia: 'S', ptasa: 1 });
  assert.equal(solo.cuotas, 1);
  assert.equal(solo.primerUsd, 36.98);
});

const HOY = new Date(2026, 10, 17);

function form(extra: Partial<DatosFaltantes> = {}): DatosFaltantes {
  return {
    placa: 'AB123CD', serial: '9BRBL3HE0L0123456', serialMotor: '', color: 'Gris',
    fechaNac: '1985-04-12', sexo: 'F', estadoCivil: 'S',
    direccion: 'Av. Principal', cestado: 13, estado: 'MIRANDA', cciudad: 101, ciudad: 'CHACAO',
    email: 'ana@example.test', telefono: '04141234567',
    sameInsured: true, asegurado: emptyPersona(), hasDriver: false, conductor: emptyPersona(),
    personaPoliticamenteExpuesta: false, aceptaTerminos: true,
    cprofesion: 12, cocupacion: 34,
    ...extra,
  };
}

test('datos completos: sin errores', () => {
  assert.deepEqual(validarDatosFaltantes(form(), { tomadorTipoDoc: 'V', hoy: HOY }), {});
});

test('datos que faltan: placa, serial, contacto, edad, términos, asegurado y conductor', () => {
  const e = validarDatosFaltantes(form({
    placa: 'AB1', serial: '', color: '', fechaNac: '2010-01-01', email: 'x', telefono: '123',
    cestado: undefined, cciudad: undefined, direccion: ' ', aceptaTerminos: false,
    sameInsured: false, hasDriver: true,
  }), { tomadorTipoDoc: 'V', hoy: HOY });
  for (const k of ['placa', 'serial', 'color', 'fechaNac', 'email', 'telefono', 'estado', 'ciudad', 'direccion',
    'aceptaTerminos', 'asegurado.identificacion', 'asegurado.nombre', 'conductor.fechaNac']) {
    assert.ok(e[k], `falta error ${k}`);
  }
});

test('profesión: obligatoria y además ocupación o actividad (SP 99013, antes de cobrar)', () => {
  const sin = validarDatosFaltantes(form({ cprofesion: undefined, cocupacion: undefined }), { tomadorTipoDoc: 'V', hoy: HOY });
  assert.ok(sin.profesion);
  const soloProfesion = validarDatosFaltantes(form({ cocupacion: undefined }), { tomadorTipoDoc: 'V', hoy: HOY });
  assert.ok(soloProfesion.profesion);
  const conActividad = validarDatosFaltantes(form({ cocupacion: undefined, cactividad: 7 }), { tomadorTipoDoc: 'V', hoy: HOY });
  assert.equal(conActividad.profesion, undefined);
});

test('persona jurídica: no exige fecha de nacimiento, sexo ni profesión del tomador', () => {
  const e = validarDatosFaltantes(form({ fechaNac: '', sexo: '', cprofesion: undefined, cocupacion: undefined }), { tomadorTipoDoc: 'J', hoy: HOY });
  assert.deepEqual(e, {});
});

test('placa y edad', () => {
  assert.equal(normalizePlacaInput('ab-123 cd'), 'AB123CD');
  assert.equal(edad('2008-11-17', HOY), 18);
  assert.equal(edad('2008-11-18', HOY), 17);
});
