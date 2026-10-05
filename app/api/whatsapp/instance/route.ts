import { NextRequest, NextResponse } from 'next/server';
import { createInstance, disconnectInstance, getInstanceStatus, InstanceError } from '@/lib/whatsapp/instance';
import { requireWhatsAppAdmin } from '@/lib/whatsapp/require-admin';

export const runtime = 'nodejs';

function unauthorized() {
  return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
}

function failure(error: unknown) {
  if (error instanceof InstanceError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[whatsapp/instance] error:', error);
  return NextResponse.json({ error: 'Erro ao falar com o WhatsApp.' }, { status: 500 });
}

/** The EVOLUTION_INSTANCE instance: name, state and connected number. */
export async function GET(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return unauthorized();
  try {
    return NextResponse.json(await getInstanceStatus());
  } catch (error) {
    return failure(error);
  }
}

/** Creates the instance when it doesn't exist yet and returns the first QR code. */
export async function POST(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return unauthorized();
  try {
    return NextResponse.json(await createInstance(auth.userId));
  } catch (error) {
    return failure(error);
  }
}

/** Disconnects the WhatsApp number (the instance stays, ready for a new QR code). */
export async function DELETE(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return unauthorized();
  try {
    return NextResponse.json(await disconnectInstance(auth.userId));
  } catch (error) {
    return failure(error);
  }
}
