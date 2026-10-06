import { NextRequest, NextResponse } from 'next/server';
import { archiveConversation, getConversation } from '@/lib/ai/assistant';
import { assistantFailure, assistantUserId } from '@/lib/ai/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ conversationId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const userId = await assistantUserId(request);
    if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    return NextResponse.json(await getConversation(userId, (await context.params).conversationId));
  } catch (error) {
    return assistantFailure(error);
  }
}

/** Archives the conversation: hidden from the list, kept in the database. */
export async function DELETE(request: NextRequest, context: Context) {
  try {
    const userId = await assistantUserId(request);
    if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    await archiveConversation(userId, (await context.params).conversationId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return assistantFailure(error);
  }
}
