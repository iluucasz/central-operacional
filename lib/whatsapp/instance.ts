import {
  connectEvolutionInstance,
  createEvolutionInstance,
  fetchEvolutionInstance,
  logoutEvolutionInstance,
  type EvolutionQrCode,
  type EvolutionServer,
} from './evolution';
import { evolutionEnv } from './store';

/**
 * The company's WhatsApp instance: the one named by EVOLUTION_INSTANCE, connected from the admin
 * screen by reading a QR code — one number at a time. Nothing is stored in the database: the state
 * is always read live from Evolution. The server's URL and global key never leave the backend.
 */

export type InstanceState = 'not_created' | 'connected' | 'connecting' | 'disconnected' | 'unknown';

export interface InstanceStatus {
  serverConfigured: boolean;
  instanceName: string;
  created: boolean;
  state: InstanceState;
  number: string | null;
  profileName: string | null;
  error: string | null;
}

/** An error the routes turn into a JSON `{ error }` response with this status. */
export class InstanceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'InstanceError';
  }
}

const MISSING_ENV = 'O servidor do WhatsApp não está configurado: defina EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE no ambiente.';

function requireServer(): { server: EvolutionServer; name: string } {
  const env = evolutionEnv();
  if (!env.apiUrl || !env.apiKey || !env.instance) throw new InstanceError(MISSING_ENV, 503);
  return { server: { apiUrl: env.apiUrl, apiKey: env.apiKey }, name: env.instance };
}

function toState(state: string | null): InstanceState {
  if (state === 'open') return 'connected';
  if (state === 'connecting') return 'connecting';
  if (state === 'close' || state === 'closed') return 'disconnected';
  return 'unknown';
}

/** Current state, read live from Evolution. */
export async function getInstanceStatus(): Promise<InstanceStatus> {
  const env = evolutionEnv();
  const serverConfigured = Boolean(env.apiUrl && env.apiKey && env.instance);
  const base = { serverConfigured, instanceName: env.instance };

  if (!serverConfigured) {
    return { ...base, created: false, state: 'unknown', number: null, profileName: null, error: null };
  }

  const info = await fetchEvolutionInstance({ apiUrl: env.apiUrl, apiKey: env.apiKey }, env.instance);
  if (info.error) return { ...base, created: true, state: 'unknown', number: null, profileName: null, error: info.error };
  if (!info.exists) return { ...base, created: false, state: 'not_created', number: null, profileName: null, error: null };

  const state = toState(info.state);
  const connected = state === 'connected';
  return {
    ...base,
    created: true,
    state,
    number: connected ? info.number : null,
    profileName: connected ? info.profileName : null,
    error: null,
  };
}

/**
 * Creates the EVOLUTION_INSTANCE instance when it doesn't exist on the server yet and returns its
 * first QR code. An instance that already exists is never recreated: this only returns its state
 * (and a QR code when it isn't connected).
 */
export async function createInstance(actorId: string): Promise<{ status: InstanceStatus; qr: EvolutionQrCode | null }> {
  const { server, name } = requireServer();

  const existing = await fetchEvolutionInstance(server, name);
  if (existing.error) throw new InstanceError(`Não foi possível falar com o servidor do WhatsApp. ${existing.error}`, 502);

  if (existing.exists) {
    const status = await getInstanceStatus();
    return { status, qr: status.state === 'connected' ? null : (await getQrCode()).qr };
  }

  const created = await createEvolutionInstance(server, name);
  if (!created.ok) throw new InstanceError(`O servidor do WhatsApp recusou a criação da instância. ${created.error ?? ''}`.trim(), 502);
  console.log(`[whatsapp] Instance "${name}" created by user ${actorId}.`);

  const qr = created.qr?.base64 ? created.qr : (await connectEvolutionInstance(server, name)).qr;
  return { status: await getInstanceStatus(), qr };
}

/** A fresh QR code while no number is connected yet. */
export async function getQrCode(): Promise<{ connected: boolean; qr: EvolutionQrCode | null }> {
  const { server, name } = requireServer();

  const result = await connectEvolutionInstance(server, name);
  if (!result.ok) throw new InstanceError(`Não foi possível gerar o QR Code. ${result.error ?? ''}`.trim(), 502);
  if (result.state === 'open') return { connected: true, qr: null };
  return { connected: false, qr: result.qr };
}

/** Disconnects the number, so another one can be connected to the same instance. */
export async function disconnectInstance(actorId: string) {
  const { server, name } = requireServer();

  const result = await logoutEvolutionInstance(server, name);
  if (!result.ok) throw new InstanceError(`Não foi possível desconectar. ${result.error ?? ''}`.trim(), 502);
  console.log(`[whatsapp] Instance "${name}" disconnected by user ${actorId}.`);
  return getInstanceStatus();
}
