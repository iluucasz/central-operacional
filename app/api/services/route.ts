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

    let query = `
      SELECT id, order_code, technician_id, service_type, value, 
             date_performed, competence_month, description, created_at
      FROM services
    `;

    if (auth.role === 'technician' || technicianId) {
      query += ` WHERE technician_id = $1 ORDER BY date_performed DESC`;
      const services = await sql.query(query, [technicianId || auth.technicianId || auth.userId]);
      return NextResponse.json({ services });
    }

    if (auth.role === 'admin') {
      query += ` ORDER BY date_performed DESC`;
      const services = await sql.query(query);
      return NextResponse.json({ services });
    }

    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  } catch (error) {
    console.error('[v0] Get services error:', error);
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
      order_code,
      technician_id,
      service_type,
      value,
      date_performed,
      competence_month,
      description,
    } = await request.json();

    const result = await sql`
      INSERT INTO services (
        order_code, technician_id, service_type, value,
        date_performed, competence_month, description
      )
      VALUES (
        ${order_code}, ${technician_id}, ${service_type}, ${value},
        ${date_performed}, ${competence_month}, ${description}
      )
      RETURNING *
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('[v0] Create service error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
