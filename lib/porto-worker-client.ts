/**
 * All Playwright/Chromium automation for the Porto integration now runs exclusively on the VPS
 * worker (see worker/server.ts) — Vercel is a Hobby-plan serverless platform with a hard
 * execution-time ceiling that kept getting hit by real month-wide scrapes against a slow legacy
 * portal. These Next.js routes (app/api/porto-config/test-login, /socorristas,
 * app/api/cron/porto-hours, /porto-schedule) are now thin proxies that forward the admin's
 * request to the worker over HTTPS (via the VPS's existing Caddy reverse proxy) and relay
 * whatever it returns — no Playwright dependency on Vercel at all anymore.
 */
export async function callPortoWorker(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const baseUrl = process.env.PORTO_WORKER_URL;
  const secret = process.env.PORTO_WORKER_SECRET;
  if (!baseUrl || !secret) {
    throw new Error('PORTO_WORKER_URL / PORTO_WORKER_SECRET não configurados na Vercel.');
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${secret}`,
    },
    cache: 'no-store',
  });

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: `Resposta inválida do worker da VPS (status ${response.status}).` };
  }

  return { status: response.status, body };
}
