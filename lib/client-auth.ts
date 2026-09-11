export interface SessionUser {
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'technician';
  technicianId?: string;
  /** True when an admin is viewing this session through the read-only preview mode. */
  preview?: boolean;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const response = await fetch('/api/auth/me', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  const data = await response.json();
  return data.user ?? null;
}