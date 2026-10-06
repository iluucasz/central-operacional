import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getSystemStatus } from '@/lib/system-status';

export const runtime = 'nodejs';

/** Whether the VPS modules (Porto worker, WhatsApp) answer — feeds the admin's maintenance notice. */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  return NextResponse.json(await getSystemStatus());
}
