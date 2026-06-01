import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { calculatePayroll, ensurePayrollSchema } from '@/lib/payroll-utils';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { technicianId, competenceMonth } = await request.json();

    if (!technicianId || !competenceMonth) {
      return NextResponse.json(
        { error: 'technicianId and competenceMonth are required' },
        { status: 400 }
      );
    }

    // Calculate payroll
    const payrollData = await calculatePayroll({
      technicianId,
      competenceMonth,
    });

    await ensurePayrollSchema();

    // Save or update payroll
    const result = await sql`
      INSERT INTO payroll (
        technician_id, competence_month, total_services_value, commission_value,
        base_salary, va_deduction, vr_deduction, discounts_total,
        advances_total, extra_hours_value, extraordinary_award_value, hour_bank_balance, net_total
      )
      VALUES (
        ${payrollData.technician_id}, ${payrollData.competence_month},
        ${payrollData.total_services_value}, ${payrollData.commission_value},
        ${payrollData.base_salary}, ${payrollData.va_deduction},
        ${payrollData.vr_deduction}, ${payrollData.discounts_total},
        ${payrollData.advances_total}, ${payrollData.extra_hours_value},
        ${payrollData.extraordinary_award_value}, ${payrollData.hour_bank_balance}, ${payrollData.net_total}
      )
      ON CONFLICT (technician_id, competence_month) DO UPDATE
      SET total_services_value = EXCLUDED.total_services_value,
          commission_value = EXCLUDED.commission_value,
          base_salary = EXCLUDED.base_salary,
          va_deduction = EXCLUDED.va_deduction,
          vr_deduction = EXCLUDED.vr_deduction,
          discounts_total = EXCLUDED.discounts_total,
          advances_total = EXCLUDED.advances_total,
          extra_hours_value = EXCLUDED.extra_hours_value,
          extraordinary_award_value = EXCLUDED.extraordinary_award_value,
          hour_bank_balance = EXCLUDED.hour_bank_balance,
          net_total = EXCLUDED.net_total,
          updated_at = NOW()
      RETURNING *
    `;

    return NextResponse.json(
      {
        success: true,
        payroll: result[0],
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v0] Calculate payroll error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
