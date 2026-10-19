import { NextRequest, NextResponse } from 'next/server';
import { finishConnection } from '@/lib/mercadopago/accounts';
import { ensurePartsSchema } from '@/lib/parts-schema';

export const runtime = 'nodejs';

const RETURN_PATH = '/dashboard/pecas';

/**
 * Where Mercado Pago sends the technician back after authorizing. Public in middleware (the state
 * carries who started it, is single use and expires in 15 minutes); the technician then goes back
 * to "Minhas peças", where the session cookie picks up again.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get('state') ?? '';
  const code = params.get('code');
  const back = (query: string) => NextResponse.redirect(new URL(`${RETURN_PATH}?${query}`, request.url));

  // Denied on Mercado Pago's screen (or an incomplete return).
  if (!code || !state) return back('mp=cancelado');

  try {
    await ensurePartsSchema();
    await finishConnection(state, code);
    return back('mp=conectado');
  } catch (error) {
    console.error('[mercadopago] oauth callback:', error);
    const message = error instanceof Error ? error.message : 'Não foi possível conectar.';
    return back(`mp=erro&motivo=${encodeURIComponent(message.slice(0, 200))}`);
  }
}
