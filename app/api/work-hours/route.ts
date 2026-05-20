import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';

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
    const technicianId = searchParams.get('technicianId');
    const month = searchParams.get('month');

    let query = `
      SELECT id, technician_id, date, start_time, end_time, hours_worked,
             week_number, month, year, created_at
      FROM work_hours
    `;

    const params = [];

    if (auth.role === 'technician' || technicianId) {
      query += ` WHERE technician_id = $${params.length + 1}`;
      params.push(technicianId || auth.technicianId || auth.userId);
    }

    if (month && auth.role === 'admin') {
      query += params.length > 0 ? ` AND competence_month = $${params.length + 1}` : ` WHERE competence_month = $1`;
      params.push(month);
    }

    query += ` ORDER BY date DESC`;

    const workHours = await sql.query(query, params);
    return NextResponse.json({ workHours });
  } catch (error) {
    console.error('[v0] Get work hours error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const {
      date,
      start_time,
      end_time,
      hours_worked,
      week_number,
      month,
      year,
    } = await request.json();

    const technicianId = auth.role === 'admin' 
      ? request.headers.get('x-technician-id') 
      : auth.technicianId || auth.userId;

    const result = await sql`
      INSERT INTO work_hours (
        technician_id, date, start_time, end_time, hours_worked,
        week_number, month, year
      )
      VALUES (
        ${technicianId}, ${date}, ${start_time}, ${end_time}, ${hours_worked},
        ${week_number}, ${month}, ${year}
      )
      RETURNING *
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('[v0] Create work hours error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
