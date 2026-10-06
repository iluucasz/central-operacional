import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, verifyAuth } from '@/lib/auth';
import { valueOrDefault } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/organization-settings-store';
import { ensurePortoConfigSchema } from '@/lib/porto-config-schema';
import { validatePhone } from '@/lib/whatsapp/phone';
import { ensureWhatsAppSchema } from '@/lib/whatsapp/store';

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

/** Phone is optional; when given it has to be something WhatsApp can actually reach. */
function parsePhone(value: unknown): { phone: string | null; error: string | null } {
  const validation = validatePhone(typeof value === 'string' ? value : '');
  if (validation.status === 'empty') return { phone: null, error: null };
  if (validation.status !== 'valid') return { phone: null, error: `WhatsApp: ${validation.message}` };

  // Stored in one canonical format whatever way it was typed, so lists and exports read the same.
  return { phone: validation.formatted, error: null };
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
  portoNameHint,
  phone,
}: {
  userId: string | null;
  qra: string | null;
  name: string;
  email: string;
  commissionPercentage: unknown;
  baseSalary: unknown;
  vaAllowance: unknown;
  vrAllowance: unknown;
  portoNameHint: string | null;
  phone: string | null;
}) {
  // Empty values start from the Configurações defaults.
  const settings = await getOrganizationSettings();
  const result = await sql`
    INSERT INTO technicians (
      user_id, qra, name, email, commission_percentage,
      base_salary, va_allowance, vr_allowance, porto_name_hint, phone
    )
    VALUES (
      ${userId}, ${qra || null}, ${name}, ${email},
      ${valueOrDefault(commissionPercentage, settings.commissionPercentage)},
      ${valueOrDefault(baseSalary, settings.baseSalary)},
      ${valueOrDefault(vaAllowance, settings.vaAllowance)},
      ${valueOrDefault(vrAllowance, settings.vrAllowance)},
      ${portoNameHint || null},
      ${phone}
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

    await ensurePortoConfigSchema();
    await ensureWhatsAppSchema();

    const technicians = await sql`
      SELECT id, qra, porto_name_hint, name, email, phone, commission_percentage, base_salary,
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
      porto_name_hint,
      phone: rawPhone,
    } = await request.json();

    const { phone, error: phoneError } = parsePhone(rawPhone);
    if (phoneError) {
      return NextResponse.json({ error: phoneError }, { status: 400 });
    }

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email and password are required' },
        { status: 400 }
      );
    }

    await ensurePortoConfigSchema();
    await ensureWhatsAppSchema();

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
        portoNameHint: porto_name_hint,
        phone,
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
      portoNameHint: porto_name_hint,
      phone,
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
      porto_name_hint,
      status,
      phone: rawPhone,
    } = await request.json();

    const { phone, error: phoneError } = parsePhone(rawPhone);
    if (phoneError) {
      return NextResponse.json({ error: phoneError }, { status: 400 });
    }

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      );
    }

    await ensurePortoConfigSchema();
    await ensureWhatsAppSchema();

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

    const settings = await getOrganizationSettings();
    const result = await sql`
      UPDATE technicians
      SET
        user_id = ${userId},
        qra = ${qra || null},
        porto_name_hint = ${porto_name_hint || null},
        phone = CASE WHEN ${rawPhone !== undefined} THEN ${phone} ELSE phone END,
        name = ${name},
        email = ${email},
        commission_percentage = ${valueOrDefault(commission_percentage, settings.commissionPercentage)},
        base_salary = ${valueOrDefault(base_salary, settings.baseSalary)},
        va_allowance = ${valueOrDefault(va_allowance, settings.vaAllowance)},
        vr_allowance = ${valueOrDefault(vr_allowance, settings.vrAllowance)},
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
