import { NextRequest, NextResponse } from 'next/server';
import { ask, getAssistantStatus, listConversations } from '@/lib/ai/assistant';
import { assistantFailure as failure, assistantUserId } from '@/lib/ai/route';

export const runtime = 'nodejs';
// Answers may need a few rounds of data lookups.
export const maxDuration = 120;

/** Availability, this month's spending and the admin's conversations. */
export async function GET(request: NextRequest) {
  try {
    const userId = await assistantUserId(request);
    if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const [status, conversations] = await Promise.all([getAssistantStatus(), listConversations(userId)]);
    return NextResponse.json({ ...status, conversations });
  } catch (error) {
    return failure(error);
  }
}

/** { question, conversationId? } — answers and records the cost. */
export async function POST(request: NextRequest) {
  try {
    const userId = await assistantUserId(request);
    if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await ask(userId, body ?? {}));
  } catch (error) {
    return failure(error);
  }
}
