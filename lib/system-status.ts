import { evolutionEnv } from './whatsapp/store';

/**
 * Whether the VPS modules answer: the Porto worker and the Evolution API (WhatsApp) both live on
 * the VPS behind its Caddy. When it's down nothing there can raise an alarm, so the app checks from
 * Vercel and shows a maintenance notice instead (components/maintenance-banner.tsx).
 */
export type ModuleState = 'ok' | 'down' | 'not_configured';

export interface SystemStatus {
  porto: ModuleState;
  whatsapp: ModuleState;
  checkedAt: string;
}

const CACHE_MS = 60_000;
const TIMEOUT_MS = 6_000;

let cached: { at: number; promise: Promise<SystemStatus> } | null = null;

/** Any answer from the service itself means it's up; Caddy answers 502/503 when the container is down. */
async function probe(url: string, headers: Record<string, string> = {}): Promise<ModuleState> {
  try {
    const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.status === 502 || response.status === 503 ? 'down' : 'ok';
  } catch {
    return 'down';
  }
}

async function checkPortoWorker(): Promise<ModuleState> {
  const baseUrl = process.env.PORTO_WORKER_URL;
  const secret = process.env.PORTO_WORKER_SECRET;
  if (!baseUrl || !secret) return 'not_configured';
  return probe(`${baseUrl}/health`, { Authorization: `Bearer ${secret}` });
}

async function checkWhatsApp(): Promise<ModuleState> {
  const { apiUrl, apiKey, instance } = evolutionEnv();
  if (!apiUrl || !apiKey || !instance) return 'not_configured';
  // Reachability only: a phone disconnected from the instance is shown on the WhatsApp screen.
  return probe(apiUrl.replace(/\/+$/, ''));
}

export function getSystemStatus(): Promise<SystemStatus> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.promise;
  const promise = Promise.all([checkPortoWorker(), checkWhatsApp()]).then(([porto, whatsapp]) => ({
    porto,
    whatsapp,
    checkedAt: new Date().toISOString(),
  }));
  cached = { at: Date.now(), promise };
  return promise;
}
