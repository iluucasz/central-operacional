import { NextResponse } from 'next/server';
import { verifyAuth } from '../auth';
import { AssistantError } from './assistant';

/** Admins only: the assistant reads company-wide data. A preview session is a technician token. */
export async function assistantUserId(request: Request): Promise<string | null> {
  const auth = await verifyAuth(request);
  if (!auth || auth.role !== 'admin' || auth.preview) return null;
  return auth.userId;
}

export function assistantFailure(error: unknown) {
  if (error instanceof AssistantError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[assistant] error:', error);
  return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
}
