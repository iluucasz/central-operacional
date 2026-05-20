import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { ensurePayrollSchema } from '@/lib/payroll-utils';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const competenceMonth = searchParams.get('competenceMonth');
    const technicianId = searchParams.get('technicianId');

    let query = `
      SELECT *
      FROM payroll
    `;

    const params = [];
    const conditions = [];

    if (auth.role === 'technician' || technicianId) {
      conditions.push(`technician_id = $${params.length + 1}`);
      params.push(technicianId || auth.technicianId || auth.userId);
    }

    if (competenceMonth) {
      conditions.push(`competence_month = $${params.length + 1}`);
      params.push(competenceMonth);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY competence_month DESC`;

    const payrolls = await sql.query(query, params);
    return NextResponse.json({ payrolls });
  } catch (error) {
    console.error('[v0] Get payroll error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const {
      technician_id,
      competence_month,
      total_services_value,
      commission_value,
      base_salary,
      va_deduction,
      vr_deduction,
      discounts_total,
      advances_total,
      extra_hours_value,
      extraordinary_award_value = 0,
      hour_bank_balance,
      net_total,
    } = await request.json();

    await ensurePayrollSchema();

    const result = await sql`
      INSERT INTO payroll (
        technician_id, competence_month, total_services_value, commission_value,
        base_salary, va_deduction, vr_deduction, discounts_total,
        advances_total, extra_hours_value, extraordinary_award_value, hour_bank_balance, net_total
      )
      VALUES (
        ${technician_id}, ${competence_month}, ${total_services_value}, ${commission_value},
        ${base_salary}, ${va_deduction}, ${vr_deduction}, ${discounts_total},
        ${advances_total}, ${extra_hours_value}, ${extraordinary_award_value}, ${hour_bank_balance}, ${net_total}
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

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('[v0] Create/update payroll error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
