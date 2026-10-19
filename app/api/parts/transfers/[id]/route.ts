import { NextRequest, NextResponse } from 'next/server';
import { getPartsSettings } from '@/lib/parts/catalog';
import { partsContext, partsError, requestIp } from '@/lib/parts/route-helpers';
import { acknowledgeTransfer, getTransfer } from '@/lib/parts/stock';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

function hideCost<T extends { totalCost: number; items: Array<{ unitCost: number }> }>(transfer: T) {
  const { totalCost: _cost, items, ...rest } = transfer;
  return { ...rest, items: items.map(({ unitCost: _unitCost, ...item }) => item) };
}

export async function GET(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    const transfer = await getTransfer(id, context.technicianId ?? undefined);
    // For the printed consignment term.
    const { companyName } = await getPartsSettings();
    return NextResponse.json({ transfer: context.isAdmin ? transfer : hideCost(transfer), organizationName: companyName || 'Central Operacional' });
  } catch (error) {
    return partsError(error, 'get transfer');
  }
}

/** The technician confirms they received the parts (the consignment receipt). */
export async function POST(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'technician');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    const transfer = await acknowledgeTransfer(id, context.technicianId!, context.actor, requestIp(request));
    return NextResponse.json({ transfer: hideCost(transfer) });
  } catch (error) {
    return partsError(error, 'acknowledge transfer');
  }
}
