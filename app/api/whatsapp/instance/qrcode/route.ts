import { NextRequest, NextResponse } from 'next/server';
import { getQrCode, InstanceError } from '@/lib/whatsapp/instance';
import { requireWhatsAppAdmin } from '@/lib/whatsapp/require-admin';

export const runtime = 'nodejs';

/** A fresh QR code for the instance; { connected: true } once the number is linked. */
export async function GET(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    return NextResponse.json(await getQrCode());
  } catch (error) {
    if (error instanceof InstanceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[whatsapp/instance/qrcode] error:', error);
    return NextResponse.json({ error: 'Erro ao gerar o QR Code.' }, { status: 500 });
  }
}
