import { NextRequest, NextResponse } from 'next/server';
import { resolveCronCaller } from '@/lib/cron-auth';
import { runHoursJob } from '@/lib/porto-jobs/run-hours-job';

export const runtime = 'nodejs';
export const maxDuration = 280;

// ~40s margin under maxDuration=280s for browser.close() + writing the response. The VPS worker
// (worker/index.ts) calls runHoursJob with no timeBudgetMs and lets a run go to completion.
const TIME_BUDGET_MS = 240_000;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const caller = await resolveCronCaller(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Lets the admin UI's manual test check a specific day/range instead of always paying for the
  // whole month-to-date sweep. Only ever honored for manual (admin-triggered) calls — the
  // unattended cron path always uses the default full sweep, regardless of query string.
  let dateRange: { startDateKey: string; endDateKey: string } | undefined;
  if (caller.manual) {
    const start = request.nextUrl.searchParams.get('start');
    const end = request.nextUrl.searchParams.get('end');
    if (start && DATE_KEY_PATTERN.test(start)) {
      dateRange = { startDateKey: start, endDateKey: end && DATE_KEY_PATTERN.test(end) ? end : start };
    }
  }

  const result = await runHoursJob({ manual: caller.manual, timeBudgetMs: TIME_BUDGET_MS, dateRange });
  return NextResponse.json(result, { status: result.status === 'error' ? 500 : 200 });
}
