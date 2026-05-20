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
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let query = `
      SELECT s.id, s.technician_id, s.date, s.start_time, s.end_time, s.status, s.notes, s.created_at,
             t.name as technician_name
      FROM schedule s
      LEFT JOIN technicians t ON t.id = s.technician_id
    `;

    const params = [];
    const conditions = [];

    if (auth.role === 'technician' || technicianId) {
      conditions.push(`s.technician_id = $${params.length + 1}`);
      params.push(technicianId || auth.technicianId || auth.userId);
    }

    if (startDate) {
      conditions.push(`s.date >= $${params.length + 1}`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`s.date <= $${params.length + 1}`);
      params.push(endDate);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY s.date ASC`;

    const schedules = await sql.query(query, params);
    return NextResponse.json({ schedules });
  } catch (error) {
    console.error('[v0] Get schedule error:', error);
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
      date,
      start_time,
      end_time,
      status = 'scheduled',
      notes,
    } = await request.json();

    const result = await sql`
      INSERT INTO schedule (
        technician_id, date, start_time, end_time, status, notes
      )
      VALUES (
        ${technician_id}, ${date}, ${start_time}, ${end_time}, ${status}, ${notes}
      )
      RETURNING *
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('[v0] Create schedule error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
