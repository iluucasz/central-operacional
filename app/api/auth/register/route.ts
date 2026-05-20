import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';

const sql = neon(process.env.DATABASE_URL!);

export async function POST(request: NextRequest) {
  try {
    const { email, password, name, role = 'technician' } = await request.json();

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: 'Email, password, and name are required' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await sql`
      SELECT id FROM neon_auth."user" WHERE email = ${email}
    `;

    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: 'User already exists' },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await sql`
      INSERT INTO neon_auth."user" (email, name, "emailVerified", password_hash, role)
      VALUES (${email}, ${name}, false, ${passwordHash}, ${role})
      RETURNING id, email, name, role
    `;

    const user = result[0];

    // If role is technician, create technician profile
    if (role === 'technician') {
      await sql`
        INSERT INTO technicians (user_id, name, email, commission_percentage, base_salary, va_allowance, vr_allowance)
        VALUES (${user.id}, ${name}, ${email}, 25, 2664, 249, 699.6)
      `;
    }

    return NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v0] Register error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
