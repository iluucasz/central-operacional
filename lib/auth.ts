import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { sql } from './db'
import type { User, UserRole } from './types'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'default-secret-change-in-production'
)

const COOKIE_NAME = 'auth-token'

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

export async function createToken(payload: { userId: string; email: string; role: UserRole }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET)
}

export async function verifyToken(token: string): Promise<{ userId: string; email: string; role: UserRole } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as { userId: string; email: string; role: UserRole }
  } catch {
    return null
  }
}

export async function setAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
}

export async function removeAuthCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}

export async function getAuthToken(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(COOKIE_NAME)?.value || null
}

export async function getCurrentUser(): Promise<User | null> {
  const token = await getAuthToken()
  if (!token) return null

  const payload = await verifyToken(token)
  if (!payload) return null

  try {
    const users = await sql`
      SELECT
        u.id,
        u.email,
        CASE
          WHEN u.role = 'technician' THEN COALESCE(NULLIF(t.name, ''), u.name)
          ELSE u.name
        END as name,
        u.role,
        t.id as technician_id
      FROM neon_auth."user" u
      LEFT JOIN technicians t ON t.user_id = u.id
      WHERE u.id = ${payload.userId}
      LIMIT 1
    `

    if (users.length === 0) return null

    return {
      id: users[0].id,
      email: users[0].email,
      name: users[0].name,
      role: users[0].role as UserRole,
      technician_id: users[0].technician_id,
    }
  } catch {
    return null
  }
}

export async function requireAuth(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('Unauthorized')
  }
  return user
}

export async function requireAdmin(): Promise<User> {
  const user = await requireAuth()
  if (user.role !== 'admin') {
    throw new Error('Forbidden')
  }
  return user
}

export async function verifyAuth(
  request: Request,
): Promise<{ userId: string; email: string; role: UserRole; technicianId?: string } | null> {
  const token = request.headers.get('cookie')?.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))?.[1]
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null

  if (payload.role !== 'technician') {
    return payload
  }

  try {
    const technicians = await sql`
      SELECT id
      FROM technicians
      WHERE user_id = ${payload.userId}
      LIMIT 1
    `

    return {
      ...payload,
      technicianId: technicians[0]?.id ?? payload.userId,
    }
  } catch {
    return {
      ...payload,
      technicianId: payload.userId,
    }
  }
}
