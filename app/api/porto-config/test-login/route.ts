import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { callPortoWorker } from '@/lib/porto-worker-client';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const { status, body } = await callPortoWorker('/test-login', { method: 'POST' });
    return NextResponse.json(body, { status });
  } catch (error) {
    console.error('[porto-config/test-login] proxy error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Falha ao contatar o worker da VPS.' }, { status: 502 });
  }
}
