import { NextRequest, NextResponse } from 'next/server';
import { resolveCronCaller } from '@/lib/cron-auth';
import { runScheduleJob } from '@/lib/porto-jobs/run-schedule-job';

export const runtime = 'nodejs';
export const maxDuration = 280;

export async function GET(request: NextRequest) {
  const caller = await resolveCronCaller(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runScheduleJob({ manual: caller.manual });
  return NextResponse.json(result, { status: result.status === 'error' ? 500 : 200 });
}
