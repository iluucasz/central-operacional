import { NextRequest, NextResponse } from 'next/server';
import { resolveCronCaller } from '@/lib/cron-auth';
import { runHoursJob } from '@/lib/porto-jobs/run-hours-job';

export const runtime = 'nodejs';
export const maxDuration = 280;

// ~40s margin under maxDuration=280s for browser.close() + writing the response. The VPS worker
// (worker/index.ts) calls runHoursJob with no timeBudgetMs and lets a run go to completion.
const TIME_BUDGET_MS = 240_000;

export async function GET(request: NextRequest) {
  const caller = await resolveCronCaller(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runHoursJob({ manual: caller.manual, timeBudgetMs: TIME_BUDGET_MS });
  return NextResponse.json(result, { status: result.status === 'error' ? 500 : 200 });
}
