/**
 * Campo «Observaciones (opcional)» del paso Plan RCV: máximo 255 caracteres (adpoliza.xobserva).
 *
 * Correr: node --test frontend/src/lib/observaciones.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { OBSERVACIONES_MAX, limitarObservaciones, observacionesRestantes } from './observaciones.ts';

test('el máximo es 255 (largo de adpoliza.xobserva)', () => {
  assert.equal(OBSERVACIONES_MAX, 255);
});

test('texto corto queda igual (no se recorta mientras se escribe)', () => {
  assert.equal(limitarObservaciones('Cliente pide póliza a nombre de la empresa '), 'Cliente pide póliza a nombre de la empresa ');
});

test('texto pegado de más de 255 se corta en 255', () => {
  const largo = 'x'.repeat(300);
  assert.equal(limitarObservaciones(largo).length, 255);
});

test('valor que no es texto queda vacío', () => {
  assert.equal(limitarObservaciones(undefined), '');
  assert.equal(limitarObservaciones(null), '');
  assert.equal(limitarObservaciones(123), '');
});

test('contador de caracteres restantes', () => {
  assert.equal(observacionesRestantes(''), 255);
  assert.equal(observacionesRestantes('abc'), 252);
  assert.equal(observacionesRestantes('x'.repeat(400)), 0);
});
