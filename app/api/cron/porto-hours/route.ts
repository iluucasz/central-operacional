import { NextRequest, NextResponse } from 'next/server';
import { resolveCronCaller } from '@/lib/cron-auth';
import { callPortoWorker } from '@/lib/porto-worker-client';

export const runtime = 'nodejs';
export const maxDuration = 280;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The real unattended daily run now lives entirely on the VPS worker's own node-cron schedule
// (worker/index.ts) — this route only serves the admin UI's manual "Testar apontamento de horas"
// button, proxied to the worker (see lib/porto-worker-client.ts). vercel.json no longer schedules
// this route at all, so resolveCronCaller's CRON_SECRET path is effectively unused here now, kept
// only as a defensive fallback.
export async function GET(request: NextRequest) {
  const caller = await resolveCronCaller(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = new URLSearchParams();
  const start = request.nextUrl.searchParams.get('start');
  const end = request.nextUrl.searchParams.get('end');
  if (start && DATE_KEY_PATTERN.test(start)) {
    params.set('start', start);
    params.set('end', end && DATE_KEY_PATTERN.test(end) ? end : start);
  }
  // "Rodar agora" real-run escape hatch (writes actual data) — only ever forwarded for an
  // authenticated admin session, never for the (currently unused) CRON_SECRET path.
  if (caller.manual && request.nextUrl.searchParams.get('write') === '1') {
    params.set('write', '1');
  }

  try {
    const query = params.toString();
    const { status, body } = await callPortoWorker(`/run/hours${query ? `?${query}` : ''}`);
    return NextResponse.json(body, { status });
  } catch (error) {
    console.error('[cron/porto-hours] proxy error:', error);
    return NextResponse.json({ status: 'error', error: error instanceof Error ? error.message : 'Falha ao contatar o worker da VPS.' }, { status: 502 });
  }
}
