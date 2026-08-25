import { NextRequest, NextResponse } from 'next/server';
import { resolveCronCaller } from '@/lib/cron-auth';
import { callPortoWorker } from '@/lib/porto-worker-client';

export const runtime = 'nodejs';
export const maxDuration = 60;

// The real unattended daily run now lives entirely on the VPS worker's own node-cron schedule
// (worker/index.ts) — this route only serves the admin UI's manual "Testar escala" button,
// proxied to the worker (see lib/porto-worker-client.ts). vercel.json no longer schedules this
// route at all, so resolveCronCaller's CRON_SECRET path is effectively unused here now, kept only
// as a defensive fallback.
export async function GET(request: NextRequest) {
  const caller = await resolveCronCaller(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { status, body } = await callPortoWorker('/run/schedule');
    return NextResponse.json(body, { status });
  } catch (error) {
    console.error('[cron/porto-schedule] proxy error:', error);
    return NextResponse.json({ status: 'error', error: error instanceof Error ? error.message : 'Falha ao contatar o worker da VPS.' }, { status: 502 });
  }
}
