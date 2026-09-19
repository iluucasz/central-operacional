import { NextRequest, NextResponse } from 'next/server';
import { getEvolutionConnectionState } from '@/lib/whatsapp/evolution';
import { requireWhatsAppAdmin } from '@/lib/whatsapp/require-admin';
import { connectionFromConfig, getWhatsAppConfig } from '@/lib/whatsapp/store';

export const runtime = 'nodejs';

/** "Testar conexão": asks Evolution whether the instance is connected to WhatsApp. */
export async function POST(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const connection = connectionFromConfig(await getWhatsAppConfig());

    if (!connection) {
      return NextResponse.json({ connected: false, state: null, error: 'Defina EVOLUTION_API_URL, EVOLUTION_INSTANCE e EVOLUTION_API_KEY no .env antes de testar.' });
    }

    return NextResponse.json(await getEvolutionConnectionState(connection));
  } catch (error) {
    console.error('[whatsapp/connection] error:', error);
    return NextResponse.json({ error: 'Erro ao testar a conexão.' }, { status: 500 });
  }
}
