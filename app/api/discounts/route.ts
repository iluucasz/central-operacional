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
    const competenceMonth = searchParams.get('competenceMonth');

    let query = `
      SELECT id, technician_id, type, amount, reason, competence_month, created_at
      FROM discounts
    `;

    const params = [];
    const conditions = [];

    if (auth.role === 'technician') {
      conditions.push(`technician_id = $${params.length + 1}`);
      params.push(auth.technicianId || auth.userId);
    } else if (technicianId) {
      conditions.push(`technician_id = $${params.length + 1}`);
      params.push(technicianId);
    }

    if (competenceMonth) {
      conditions.push(`competence_month = $${params.length + 1}`);
      params.push(competenceMonth);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY created_at DESC`;

    const discounts = await sql.query(query, params);
    return NextResponse.json({ discounts });
  } catch (error) {
    console.error('[v0] Get discounts error:', error);
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
      type,
      amount,
      reason,
      competence_month,
    } = await request.json();

    const result = await sql`
      INSERT INTO discounts (
        technician_id, type, amount, reason, competence_month
      )
      VALUES (
        ${technician_id}, ${type}, ${amount}, ${reason}, ${competence_month}
      )
      RETURNING *
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('[v0] Create discount error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
