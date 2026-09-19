/**
 * Minimal Evolution API client — plain fetch, no SDK. Same approach as the EssencialCentro
 * integration; the connection comes from the admin screen, falling back to the EVOLUTION_* env vars.
 * Never throws: every failure comes back as a structured result the caller records in history.
 */

import { normalizePhone } from './phone';

const TIMEOUT_MS = 10_000;

export interface EvolutionConnection {
  apiUrl: string;
  apiKey: string;
  instance: string;
}

export interface EvolutionResult {
  ok: boolean;
  error: string | null;
}

/**
 * Without this, a URL pasted with a trailing slash builds `https://host//message/...`, which the
 * Evolution API answers with a 404 that looks exactly like "instance does not exist".
 */
function baseUrl(connection: EvolutionConnection) {
  return connection.apiUrl.trim().replace(/\/+$/, '');
}

// One set of phone rules for the mask, the API validation and the sends.
export { normalizePhone } from './phone';

async function request(connection: EvolutionConnection, path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(`${baseUrl(connection)}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', apikey: connection.apiKey, ...(init.headers ?? {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function describeError(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') return 'Tempo limite ao chamar a Evolution API.';
  return `Erro ao chamar a Evolution API: ${error instanceof Error ? error.message : String(error)}`;
}

export async function sendEvolutionText(connection: EvolutionConnection, phone: string, text: string): Promise<EvolutionResult> {
  const number = normalizePhone(phone);
  if (!number) return { ok: false, error: 'Telefone inválido para WhatsApp.' };

  try {
    const response = await request(connection, `/message/sendText/${encodeURIComponent(connection.instance)}`, {
      method: 'POST',
      body: JSON.stringify({ number, text }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[whatsapp] Evolution sendText failed:', response.status, body);
      return { ok: false, error: `Evolution API respondeu ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
    }

    return { ok: true, error: null };
  } catch (error) {
    console.error('[whatsapp] Evolution sendText error:', error);
    return { ok: false, error: describeError(error) };
  }
}

export interface EvolutionConnectionState {
  connected: boolean;
  state: string | null;
  error: string | null;
}

/** Manual diagnostics only (the "Testar conexão" button) — never polled. */
export async function getEvolutionConnectionState(connection: EvolutionConnection): Promise<EvolutionConnectionState> {
  try {
    const response = await request(connection, `/instance/connectionState/${encodeURIComponent(connection.instance)}`, { method: 'GET' });

    if (!response.ok) {
      return { connected: false, state: null, error: `Evolution API respondeu ${response.status}.` };
    }

    const data = (await response.json().catch(() => null)) as { instance?: { state?: string } } | null;
    const state = data?.instance?.state ?? null;

    return { connected: state === 'open', state, error: null };
  } catch (error) {
    return { connected: false, state: null, error: describeError(error) };
  }
}

export interface WhatsAppNumberCheck {
  /** True when Evolution confirms the number has a WhatsApp account. */
  exists: boolean;
  /** WhatsApp's own id for it — may differ from the typed number (e.g. without the 9th digit). */
  jid: string | null;
  error: string | null;
}

/** Asks Evolution whether a number is on WhatsApp (`POST /chat/whatsappNumbers/{instance}`). */
export async function checkWhatsAppNumber(connection: EvolutionConnection, phone: string): Promise<WhatsAppNumberCheck> {
  const number = normalizePhone(phone);
  if (!number) return { exists: false, jid: null, error: 'Telefone inválido.' };

  try {
    const response = await request(connection, `/chat/whatsappNumbers/${encodeURIComponent(connection.instance)}`, {
      method: 'POST',
      body: JSON.stringify({ numbers: [number] }),
    });

    if (!response.ok) {
      return { exists: false, jid: null, error: `Evolution API respondeu ${response.status}.` };
    }

    const data = (await response.json().catch(() => null)) as Array<{ exists?: boolean; jid?: string }> | null;
    const match = Array.isArray(data) ? data[0] : null;

    return { exists: Boolean(match?.exists), jid: match?.jid ?? null, error: null };
  } catch (error) {
    return { exists: false, jid: null, error: describeError(error) };
  }
}
