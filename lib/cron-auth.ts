import type { NextRequest } from 'next/server';
import { verifyAuth } from './auth';

export function isValidCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get('authorization');
  return header === `Bearer ${secret}`;
}

/**
 * Resolves who is allowed to trigger a Porto cron route, and whether this is the real scheduled
 * run (Vercel's dispatcher, authenticated via CRON_SECRET) or a manual test click from an admin
 * (authenticated via their normal session). Manual runs are always forced into dry-run mode by
 * the caller, regardless of the `dry_run_only` config — a "test" button should never be able to
 * write real data, no matter what the toggle is set to.
 */
export async function resolveCronCaller(request: NextRequest): Promise<{ authorized: boolean; manual: boolean }> {
  if (isValidCronSecret(request)) {
    return { authorized: true, manual: false };
  }

  const auth = await verifyAuth(request);
  if (auth?.role === 'admin') {
    return { authorized: true, manual: true };
  }

  return { authorized: false, manual: false };
}
