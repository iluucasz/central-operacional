import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { listAccountStatuses } from '@/lib/mercadopago/accounts';
import { createPart, listParts, stockByTechnician } from '@/lib/parts/catalog';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

/** Admin: the catalog with stock (central and per technician) and the technicians with their Mercado Pago state. */
export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const [parts, stock, technicians, accounts] = await Promise.all([
      listParts(),
      stockByTechnician(),
      sql`
        SELECT id, name, status FROM technicians
        ORDER BY (status = 'active') DESC, lower(name)
      `,
      listAccountStatuses(),
    ]);
    return NextResponse.json({
      parts,
      stock,
      technicians: technicians.map((technician) => ({
        id: String(technician.id),
        name: String(technician.name),
        status: String(technician.status),
        mercadoPago: accounts.get(String(technician.id)) ?? null,
      })),
    });
  } catch (error) {
    return partsError(error, 'list parts');
  }
}

export async function POST(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const part = await createPart(await readJson(request), context.actor);
    return NextResponse.json({ part }, { status: 201 });
  } catch (error) {
    return partsError(error, 'create part');
  }
}
