import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, verifyAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

function getErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }

  return String((error as { code?: string }).code);
}

function technicianConflictResponse() {
  return NextResponse.json(
    { error: 'Ja existe um tecnico ou usuario com esse email.' },
    { status: 409 }
  );
}

function positiveNumberOrDefault(value: unknown, fallback: number) {
  const numericValue = Number(value);
  return numericValue > 0 ? numericValue : fallback;
}

async function insertTechnicianRecord({
  userId,
  qra,
  name,
  email,
  commissionPercentage,
  baseSalary,
  vaAllowance,
  vrAllowance,
}: {
  userId: string | null;
  qra: string | null;
  name: string;
  email: string;
  commissionPercentage: unknown;
  baseSalary: unknown;
  vaAllowance: unknown;
  vrAllowance: unknown;
}) {
  const result = await sql`
    INSERT INTO technicians (
      user_id, qra, name, email, commission_percentage,
      base_salary, va_allowance, vr_allowance
    )
    VALUES (
      ${userId}, ${qra || null}, ${name}, ${email},
      ${positiveNumberOrDefault(commissionPercentage, 25)},
      ${positiveNumberOrDefault(baseSalary, 2664.53)},
      ${positiveNumberOrDefault(vaAllowance, 249)},
      ${positiveNumberOrDefault(vrAllowance, 783)}
    )
    RETURNING *
  `;

  return result[0];
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const technicians = await sql`
      SELECT id, qra, name, email, commission_percentage, base_salary, 
             va_allowance, vr_allowance, status, created_at
      FROM technicians
      ORDER BY name ASC
    `;

    return NextResponse.json({ technicians });
  } catch (error) {
    console.error('[v0] Get technicians error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let createdUserId: string | null = null;

  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const {
      qra,
      name,
      email,
      password,
      commission_percentage,
      base_salary,
      va_allowance,
      vr_allowance,
    } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email and password are required' },
        { status: 400 }
      );
    }

    const existingUsers = await sql`
      SELECT u.id, u.role, t.id AS technician_id
      FROM neon_auth."user" u
      LEFT JOIN technicians t ON t.user_id = u.id
      WHERE u.email = ${email}
      LIMIT 1
    `;

    if (existingUsers.length > 0) {
      const existingUser = existingUsers[0] as { id: string; role: string; technician_id: string | null };

      if (existingUser.role !== 'technician' || existingUser.technician_id) {
        return technicianConflictResponse();
      }

      const passwordHash = await hashPassword(password);
      await sql`
        UPDATE neon_auth."user"
        SET name = ${name},
            password_hash = ${passwordHash},
            role = 'technician'
        WHERE id = ${existingUser.id}
      `;

      const technician = await insertTechnicianRecord({
        userId: existingUser.id,
        qra,
        name,
        email,
        commissionPercentage: commission_percentage,
        baseSalary: base_salary,
        vaAllowance: va_allowance,
        vrAllowance: vr_allowance,
      });

      return NextResponse.json(technician, { status: 201 });
    }

    const passwordHash = await hashPassword(password);

    const createdUsers = await sql`
      INSERT INTO neon_auth."user" (email, name, "emailVerified", password_hash, role)
      VALUES (${email}, ${name}, false, ${passwordHash}, 'technician')
      RETURNING id
    `;

    createdUserId = createdUsers[0]?.id ?? null;

    const technician = await insertTechnicianRecord({
      userId: createdUserId,
      qra,
      name,
      email,
      commissionPercentage: commission_percentage,
      baseSalary: base_salary,
      vaAllowance: va_allowance,
      vrAllowance: vr_allowance,
    });

    return NextResponse.json(technician, { status: 201 });
  } catch (error) {
    if (getErrorCode(error) === '23505') {
      return technicianConflictResponse();
    }

    if (createdUserId) {
      try {
        await sql`
          DELETE FROM neon_auth."user"
          WHERE id = ${createdUserId}
        `;
      } catch (cleanupError) {
        console.error('[v0] Create technician cleanup error:', cleanupError);
      }
    }

    console.error('[v0] Create technician error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  let createdUserId: string | null = null;

  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const technicianId = request.nextUrl.searchParams.get('id');
    if (!technicianId) {
      return NextResponse.json(
        { error: 'Technician id is required' },
        { status: 400 }
      );
    }

    const {
      qra,
      name,
      email,
      password,
      commission_percentage,
      base_salary,
      va_allowance,
      vr_allowance,
      status,
    } = await request.json();

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      );
    }

    const existingTechnicians = await sql`
      SELECT id, user_id
      FROM technicians
      WHERE id = ${technicianId}
      LIMIT 1
    `;

    if (existingTechnicians.length === 0) {
      return NextResponse.json(
        { error: 'Technician not found' },
        { status: 404 }
      );
    }

    let userId = existingTechnicians[0].user_id as string | null;

    if (userId) {
      if (password) {
        const passwordHash = await hashPassword(password);
        await sql`
          UPDATE neon_auth."user"
          SET email = ${email},
              name = ${name},
              password_hash = ${passwordHash}
          WHERE id = ${userId}
        `;
      } else {
        await sql`
          UPDATE neon_auth."user"
          SET email = ${email},
              name = ${name}
          WHERE id = ${userId}
        `;
      }
    } else if (password) {
      const existingUsers = await sql`
        SELECT u.id, u.role, t.id AS technician_id
        FROM neon_auth."user" u
        LEFT JOIN technicians t ON t.user_id = u.id
        WHERE u.email = ${email}
        LIMIT 1
      `;

      if (existingUsers.length > 0) {
        const existingUser = existingUsers[0] as { id: string; role: string; technician_id: string | null };

        if (existingUser.role !== 'technician' || (existingUser.technician_id && existingUser.technician_id !== technicianId)) {
          return technicianConflictResponse();
        }

        const passwordHash = await hashPassword(password);
        await sql`
          UPDATE neon_auth."user"
          SET email = ${email},
              name = ${name},
              password_hash = ${passwordHash},
              role = 'technician'
          WHERE id = ${existingUser.id}
        `;

        userId = existingUser.id;
      } else {
        const passwordHash = await hashPassword(password);
        const createdUsers = await sql`
          INSERT INTO neon_auth."user" (email, name, "emailVerified", password_hash, role)
          VALUES (${email}, ${name}, false, ${passwordHash}, 'technician')
          RETURNING id
        `;

        createdUserId = createdUsers[0]?.id ?? null;
        userId = createdUserId;
      }
    }

    const result = await sql`
      UPDATE technicians
      SET
        user_id = ${userId},
        qra = ${qra || null},
        name = ${name},
        email = ${email},
        commission_percentage = ${Number(commission_percentage) > 0 ? commission_percentage : 25},
        base_salary = ${Number(base_salary) > 0 ? base_salary : 2664.53},
        va_allowance = ${Number(va_allowance) > 0 ? va_allowance : 249},
        vr_allowance = ${Number(vr_allowance) > 0 ? vr_allowance : 783},
        status = ${status === 'inactive' ? 'inactive' : 'active'},
        updated_at = NOW()
      WHERE id = ${technicianId}
      RETURNING *
    `;

    return NextResponse.json(result[0]);
  } catch (error) {
    if (getErrorCode(error) === '23505') {
      return technicianConflictResponse();
    }

    if (createdUserId) {
      try {
        await sql`
          DELETE FROM neon_auth."user"
          WHERE id = ${createdUserId}
        `;
      } catch (cleanupError) {
        console.error('[v0] Update technician cleanup error:', cleanupError);
      }
    }

    console.error('[v0] Update technician error:', error);
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

    const technicianId = request.nextUrl.searchParams.get('id');
    if (!technicianId) {
      return NextResponse.json(
        { error: 'Technician id is required' },
        { status: 400 }
      );
    }

    const linkedUsers = await sql`
      SELECT user_id
      FROM technicians
      WHERE id = ${technicianId}
      LIMIT 1
    `;

    if (linkedUsers.length === 0) {
      return NextResponse.json(
        { error: 'Technician not found' },
        { status: 404 }
      );
    }

    const userId = linkedUsers[0].user_id as string | null;
    const result = await sql`
      WITH deleted_technician AS (
        DELETE FROM technicians
        WHERE id = ${technicianId}
        RETURNING id, user_id
      ),
      deleted_user AS (
        DELETE FROM neon_auth."user" u
        USING deleted_technician d
        WHERE u.id = d.user_id
        RETURNING u.id
      )
      SELECT id FROM deleted_technician
    `;

    return NextResponse.json({ success: true, id: result[0].id, deletedUser: Boolean(userId) });
  } catch (error) {
    if (getErrorCode(error) === '23503') {
      return NextResponse.json(
        { error: 'Este tecnico possui registros vinculados e nao pode ser excluido.' },
        { status: 409 }
      );
    }

    console.error('[v0] Delete technician error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
