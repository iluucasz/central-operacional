import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { sql } from '@/lib/db';
import { ensureServicesSchema } from '@/lib/services-schema';

async function isActiveTechnician(technicianId: string) {
  const technicians = await sql`
    SELECT status
    FROM technicians
    WHERE id = ${technicianId}
    LIMIT 1
  `;

  return technicians[0]?.status === 'active';
}

function inactiveTechnicianResponse() {
  return NextResponse.json(
    { error: 'Selecione um tecnico ativo para lancar OS.' },
    { status: 409 }
  );
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await ensureServicesSchema();

    const { searchParams } = new URL(request.url);
    const technicianId = searchParams.get('technicianId');
    const competenceMonth = searchParams.get('competenceMonth');

    let query = `
      SELECT s.id, s.order_code, s.technician_id, s.service_type, s.value,
             s.date_performed, s.time_performed, s.competence_month, s.fortnight_period, s.description, s.created_at,
             t.name AS technician_name
      FROM services s
      LEFT JOIN technicians t ON t.id = s.technician_id
    `;

    const scopedTechnicianId = auth.role === 'technician' ? auth.technicianId || auth.userId : technicianId;
    const params: string[] = [];
    const conditions: string[] = [];

    if (scopedTechnicianId) {
      params.push(scopedTechnicianId);
      conditions.push(`s.technician_id = $${params.length}`);
    }

    conditions.push(`t.status = 'active'`);

    if (competenceMonth) {
      params.push(competenceMonth);
      conditions.push(`COALESCE(NULLIF(s.competence_month, ''), TO_CHAR(s.date_performed::date, 'YYYY-MM')) = $${params.length}`);
    }

    if (auth.role === 'admin' || scopedTechnicianId) {
      if (conditions.length) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      query += ` ORDER BY s.date_performed DESC, s.time_performed DESC NULLS LAST, s.created_at DESC`;
      const services = await sql.query(query, params);
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
      time_performed,
      competence_month,
      fortnight_period,
      description,
    } = await request.json();

    await ensureServicesSchema();

    if (!(await isActiveTechnician(technician_id))) {
      return inactiveTechnicianResponse();
    }

    const result = await sql`
      INSERT INTO services (
        order_code, technician_id, service_type, value,
        date_performed, time_performed, competence_month, fortnight_period, description
      )
      VALUES (
        ${order_code}, ${technician_id}, ${service_type}, ${value},
        ${date_performed}, ${time_performed || null}, ${competence_month || String(date_performed ?? '').slice(0, 7)}, ${fortnight_period || null}, ${description}
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

export async function PUT(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const {
      id,
      order_code,
      technician_id,
      service_type,
      value,
      date_performed,
      time_performed,
      competence_month,
      fortnight_period,
      description,
    } = await request.json();

    if (!id) {
      return NextResponse.json(
        { error: 'Service id is required' },
        { status: 400 }
      );
    }

    await ensureServicesSchema();

    const currentService = await sql`
      SELECT technician_id
      FROM services
      WHERE id = ${id}
      LIMIT 1
    `;

    if (!currentService.length) {
      return NextResponse.json(
        { error: 'Service not found' },
        { status: 404 }
      );
    }

    if (!(await isActiveTechnician(technician_id))) {
      return inactiveTechnicianResponse();
    }

    const result = await sql`
      UPDATE services
      SET order_code = ${order_code},
          technician_id = ${technician_id},
          service_type = ${service_type},
          value = ${value},
          date_performed = ${date_performed},
          time_performed = ${time_performed || null},
          competence_month = ${competence_month || String(date_performed ?? '').slice(0, 7)},
          fortnight_period = ${fortnight_period || null},
          description = ${description || null}
      WHERE id = ${id}
      RETURNING *
    `;

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error('[v0] Update service error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    await ensureServicesSchema();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Service id is required' },
        { status: 400 }
      );
    }

    const result = await sql`
      DELETE FROM services
      WHERE id = ${id}
      RETURNING id
    `;

    if (!result.length) {
      return NextResponse.json(
        { error: 'Service not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[v0] Delete service error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
