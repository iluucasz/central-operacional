import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { calculatePayroll, ensurePayrollSchema } from '@/lib/payroll-utils';

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { technicianId, competenceMonth } = await request.json();

    if (!technicianId || !competenceMonth) {
      return NextResponse.json({ error: 'technicianId and competenceMonth are required' }, { status: 400 });
    }

    await ensurePayrollSchema();
    const payroll = await calculatePayroll({ technicianId, competenceMonth });

    return NextResponse.json({ payroll });
  } catch (error) {
    console.error('[payroll-preview] Calculate payroll preview error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
