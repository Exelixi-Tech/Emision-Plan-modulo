/**
 * Emitir RCV desde cotización de SysIP: detección del flujo y API del server de Emisión.
 *
 * El flujo se abre solo si el nexus_token trae `cotizacionID` en la metadata (lo firma Nexus). El número
 * nunca se manda desde aquí: el server lo lee del token validado y consulta nest-api con su propia key.
 */
import axios, { AxiosError } from 'axios';
import { moduleApiBase } from './app-base';
import { attachNexusTokenAxios, decodeNexusTokenMetadata, getNexusTokenFromUrl } from './nexus-token-client';

const NEXUS_TOKEN_KEY = 'nexus_access_token_emision';

const api = axios.create({ baseURL: moduleApiBase() });
attachNexusTokenAxios(api, NEXUS_TOKEN_KEY);

function peekNexusToken(): string | null {
  const fromUrl = getNexusTokenFromUrl();
  if (fromUrl) return fromUrl;
  try {
    return sessionStorage.getItem(NEXUS_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Número de cotización del token (solo para enrutar la UI; el server valida). Sin efectos secundarios. */
export function readCotizacionIdFromToken(): string | null {
  const token = peekNexusToken();
  const meta = token ? decodeNexusTokenMetadata(token) : null;
  const raw = meta?.cotizacionID ?? meta?.cotizacionId;
  if (raw == null) return null;
  const value = String(raw).trim();
  return /^\d{1,13}$/.test(value) && Number(value) > 0 ? value : null;
}

export function isRcvCotizacionFlow(): boolean {
  try {
    return readCotizacionIdFromToken() != null;
  } catch {
    return false;
  }
}

// ── Contrato GET /api/v1/cotizaciones-auto/:cproces (nest-api) ──────────────

export interface CodigoNombre {
  codigo: string | number;
  nombre: string;
}

export interface CoberturaCotizacion {
  codigo: string | number;
  nombre: string;
  primaUsd: number;
  sumaAseguradaUsd: number;
  ajustePorcentaje: number;
}

export interface CotizacionAuto {
  cproces: number | string;
  codigo: string | null;
  creadaEn: string | null;
  venceEl: string | null;
  vencida: boolean;
  ramo: number;
  plan: CodigoNombre;
  productor: CodigoNombre | null;
  usuario: string | null;
  vigencia: { desde: string; hasta: string; dias: number };
  tomador: { tipoDoc: string; documento: string; nombre: string };
  vehiculo: {
    marca: CodigoNombre;
    modelo: CodigoNombre;
    version: CodigoNombre;
    anio: number;
    tipo: CodigoNombre | null;
    uso: CodigoNombre | null;
    puestos: number;
    toneladas: number;
    tipoPlaca: string;
  };
  opciones: Array<{ opcion: number; primaUsd: number; soloRcv: boolean; coberturas: CoberturaCotizacion[] }>;
  emitida: boolean;
  poliza: string | null;
  opcionEmitida: number | null;
  emitible: boolean;
  motivos: Array<{ codigo: string; mensaje: string }>;
}

export interface OpcionVista {
  opcion: number;
  primaUsd: number;
  rcvBasicoUsd: number;
  coberturas: CoberturaCotizacion[];
}

export interface FrecuenciaItem {
  code: string;
  label: string;
  ndias: number | null;
}

export interface VistaCotizacion {
  cotizacion: CotizacionAuto;
  emitible: boolean;
  motivos: Array<{ codigo: string; mensaje: string }>;
  opciones: OpcionVista[];
  frecuencias: FrecuenciaItem[];
  vigenciaEmision: { fdesde: string; fhasta: string; dias: number; ajustada: boolean };
  ptasa: number | null;
}

export interface CheckoutCotizacion {
  opcion: number;
  frecuencia: string;
  frecuenciaLabel: string;
  ndias: number | null;
  montos: {
    cuotas: number;
    annualUsd: number;
    rcvInicialUsd: number;
    primerUsd: number;
    siguienteUsd: number;
    ptasa: number;
    annualVes: number;
    primerVes: number;
    siguienteVes: number;
  };
  quote: { mprima: number; mprimaext: number; ptasa: number; primaCuotaInicial: number };
  bloqueados: {
    tomador: { tipoDoc: string; identificacion: string; nombre: string; apellido: string };
    vehicle: Record<string, unknown>;
    selectedPlan: { cplan: string; name: string };
  };
  ticket: string;
}

export class CotizacionApiError extends Error {
  code: string;
  status?: number;
  details?: unknown;
  constructor(code: string, message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'CotizacionApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function toApiError(err: unknown): CotizacionApiError {
  const ax = err as AxiosError<{ code?: string; message?: string; details?: unknown }>;
  const data = ax?.response?.data;
  if (data && (data.code || data.message)) {
    return new CotizacionApiError(data.code ?? 'ERROR', data.message ?? 'Error en la cotización.', ax.response?.status, data.details);
  }
  return new CotizacionApiError('RED', 'No pudimos comunicarnos con el servidor. Intenta de nuevo.', ax?.response?.status);
}

export async function fetchCotizacionActual(): Promise<VistaCotizacion> {
  try {
    const { data } = await api.get<VistaCotizacion & { success: boolean }>('/rcv-cotizacion/actual');
    return data;
  } catch (err) {
    throw toApiError(err);
  }
}

export async function prepararCheckoutCotizacion(body: {
  opcion: number;
  frecuencia: string;
  vehicle: { placa: string; serial: string; serialMotor?: string };
  /** Profesión/ocupación/actividad: el server no prepara el cobro sin ellas (persona natural). */
  tomador?: { cprofesion?: number | string; cocupacion?: number | string; cactividad?: number | string };
}): Promise<CheckoutCotizacion> {
  try {
    const { data } = await api.post<CheckoutCotizacion & { success: boolean }>('/rcv-cotizacion/checkout', body);
    return data;
  } catch (err) {
    throw toApiError(err);
  }
}
