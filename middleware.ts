import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'default-secret-change-in-production'
);

const COOKIE_NAME = 'auth-token';

const publicRoutes = ['/login', '/api/auth/login', '/api/auth/register', '/api/auth/me'];
const adminRoutes = ['/admin'];
const technicianRoutes = ['/dashboard'];
const hiddenTechnicianRoutes = ['/dashboard/services'];

async function verifyAuthMiddleware(request: NextRequest): Promise<{ userId: string; email: string; role: string } | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as { userId: string; email: string; role: string };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Allow public routes
  if (publicRoutes.includes(path)) {
    return NextResponse.next();
  }

  // Allow static files and API routes that don't need auth
  if (path.startsWith('/_next') || path.startsWith('/favicon') || path.includes('.')) {
    return NextResponse.next();
  }

  // Verify authentication
  const auth = await verifyAuthMiddleware(request);

  if (!auth) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (hiddenTechnicianRoutes.some(route => path.startsWith(route))) {
    if (auth.role === 'admin') {
      return NextResponse.redirect(new URL('/admin/services', request.url));
    }

    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Check admin routes
  if (adminRoutes.some(route => path.startsWith(route))) {
    if (auth.role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Check technician routes
  if (technicianRoutes.some(route => path.startsWith(route))) {
    if (auth.role !== 'technician' && auth.role !== 'admin') {
      return NextResponse.redirect(new URL('/admin', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|apple-icon).*)'],
};
