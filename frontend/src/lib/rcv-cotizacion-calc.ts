/**
 * Emitir RCV desde cotización — lógica pura (sin red ni store). Pruebas: node --test src/lib/rcv-cotizacion-calc.test.ts
 *
 * Primer recibo = regla de sp_genera_coberturas_recibos_auto_rcv_nexus (la misma que usan PlansStep y Pagos):
 * el RCV básico (Daños a personas y a cosas) va completo en el recibo 1 y el resto se divide entre las
 * cuotas; si solo hay RCV básico, un único recibo. Cuota USD a 2 decimales antes de pasar a Bs.
 * Debe coincidir con server/src/lib/rcvCotizacion.js (computePrimerRecibo), que es el que vale para cobrar.
 */
import { isValidPhonePrefix } from './phone.ts';
import { validateVehicleSerialMessage, VEHICLE_SERIAL_MAX_LEN } from './vehicle-serial.ts';

export function round2(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

const CUOTAS_BY_FREC: Record<string, number> = { A: 1, S: 2, T: 4, C: 3, M: 12, E: 1, D: 1, B: 1 };

export function cuotasPorFrecuencia(code?: string | null): number {
  const c = String(code ?? 'A').trim().toUpperCase().charAt(0) || 'A';
  return CUOTAS_BY_FREC[c] ?? 1;
}

export interface PrimerRecibo {
  cuotas: number;
  annualUsd: number;
  rcvInicialUsd: number;
  primerUsd: number;
  siguienteUsd: number;
  ptasa: number;
  annualVes: number;
  primerVes: number;
  siguienteVes: number;
}

export function computePrimerRecibo(args: {
  annualUsd: number;
  rcvBasicoUsd?: number;
  frecuencia?: string | null;
  ptasa?: number | null;
}): PrimerRecibo {
  const annual = round2(args.annualUsd);
  let cuotas = cuotasPorFrecuencia(args.frecuencia);
  const rcv = cuotas > 1 ? round2(Math.max(0, Number(args.rcvBasicoUsd) || 0)) : 0;
  if (cuotas > 1 && rcv > 0 && rcv >= annual) cuotas = 1;
  const rcvInicialUsd = cuotas > 1 ? rcv : 0;
  const siguienteUsd = round2((annual - rcvInicialUsd) / cuotas);
  const primerUsd = round2(rcvInicialUsd + siguienteUsd);
  const tasa = Number(args.ptasa) > 0 ? Number(args.ptasa) : 0;
  return {
    cuotas,
    annualUsd: annual,
    rcvInicialUsd,
    primerUsd,
    siguienteUsd: cuotas > 1 ? siguienteUsd : 0,
    ptasa: tasa,
    annualVes: tasa ? round2(annual * tasa) : 0,
    primerVes: tasa ? round2(primerUsd * tasa) : 0,
    siguienteVes: tasa && cuotas > 1 ? round2(siguienteUsd * tasa) : 0,
  };
}

// ── Datos que faltan (pantalla 2) ────────────────────────────────────────────

export interface PersonaExtra {
  tipoDoc: string;
  identificacion: string;
  nombre: string;
  apellido: string;
  fechaNac: string;
  sexo: string;
}

export interface DatosFaltantes {
  placa: string;
  serial: string;
  serialMotor: string;
  color: string;
  /** Tomador persona natural (la cotización no los trae). */
  fechaNac: string;
  sexo: string;
  estadoCivil: string;
  direccion: string;
  cestado?: number;
  estado: string;
  cciudad?: number;
  ciudad: string;
  email: string;
  telefono: string;
  sameInsured: boolean;
  asegurado: PersonaExtra;
  hasDriver: boolean;
  conductor: PersonaExtra;
  personaPoliticamenteExpuesta: boolean;
  aceptaTerminos: boolean;
}

export const emptyPersona = (): PersonaExtra => ({
  tipoDoc: 'V', identificacion: '', nombre: '', apellido: '', fechaNac: '', sexo: '',
});

export function normalizePlacaInput(raw: string): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function edad(fechaNac: string, hoy: Date = new Date()): number {
  const m = String(fechaNac ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return -1;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  let years = hoy.getFullYear() - y;
  const md = hoy.getMonth() + 1 - mo;
  if (md < 0 || (md === 0 && hoy.getDate() < d)) years -= 1;
  return years;
}

export function esPersonaJuridica(tipoDoc?: string | null): boolean {
  return ['J', 'G', 'C'].includes(String(tipoDoc ?? '').trim().toUpperCase().charAt(0));
}

function validarPersona(p: PersonaExtra, prefix: string, errors: Record<string, string>, hoy: Date) {
  if (!/^\d{1,10}$/.test(String(p.identificacion ?? '').replace(/\D/g, ''))) {
    errors[`${prefix}.identificacion`] = 'Cédula requerida (solo números)';
  }
  if (!p.nombre.trim()) errors[`${prefix}.nombre`] = 'Nombre requerido';
  if (!p.apellido.trim()) errors[`${prefix}.apellido`] = 'Apellido requerido';
  if (!p.fechaNac) errors[`${prefix}.fechaNac`] = 'Fecha de nacimiento requerida';
  else if (edad(p.fechaNac, hoy) < 18) errors[`${prefix}.fechaNac`] = 'Debe ser mayor de edad';
  if (!p.sexo) errors[`${prefix}.sexo`] = 'Selecciona el sexo';
}

/**
 * Mismas exigencias que la emisión RCV (policyValidator del server): placa 6–8 alfanuméricos, serial de
 * carrocería, contacto válido, fecha de nacimiento 18+ (persona natural), dirección y aceptación de términos.
 */
export function validarDatosFaltantes(
  f: DatosFaltantes,
  opts: { tomadorTipoDoc?: string | null; hoy?: Date } = {},
): Record<string, string> {
  const hoy = opts.hoy ?? new Date();
  const errors: Record<string, string> = {};
  if (!/^[A-Z0-9]{6,8}$/.test(normalizePlacaInput(f.placa))) errors.placa = 'Placa de 6 a 8 letras y números';
  const serialMsg = validateVehicleSerialMessage(f.serial);
  if (serialMsg) errors.serial = serialMsg;
  if (f.serialMotor.length > VEHICLE_SERIAL_MAX_LEN) errors.serialMotor = `Máximo ${VEHICLE_SERIAL_MAX_LEN} caracteres`;
  if (!f.color.trim()) errors.color = 'Color requerido';
  if (!esPersonaJuridica(opts.tomadorTipoDoc)) {
    if (!f.fechaNac) errors.fechaNac = 'Fecha de nacimiento del tomador requerida';
    else if (edad(f.fechaNac, hoy) < 18) errors.fechaNac = 'El tomador debe ser mayor de edad';
    if (!f.sexo) errors.sexo = 'Selecciona el sexo';
  }
  if (!f.cestado) errors.estado = 'Selecciona el estado';
  if (!f.cciudad) errors.ciudad = 'Selecciona la ciudad';
  if (!f.direccion.trim()) errors.direccion = 'Dirección requerida';
  if (!/.+@.+\..+/.test(f.email.trim())) errors.email = 'Correo inválido';
  if (!isValidPhonePrefix(f.telefono)) errors.telefono = 'Teléfono venezolano de 11 dígitos (ej. 0414 1234567)';
  if (!f.sameInsured) validarPersona(f.asegurado, 'asegurado', errors, hoy);
  if (f.hasDriver) validarPersona(f.conductor, 'conductor', errors, hoy);
  if (!f.aceptaTerminos) errors.aceptaTerminos = 'Debes aceptar los términos y condiciones';
  return errors;
}
