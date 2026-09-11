/**
 * Cookie names for the admin "preview" (impersonation) session. Kept in their own dependency-free
 * module so client components can reference them without pulling in lib/auth.ts, which is
 * server-only (next/headers, bcrypt, the database client).
 */

/** Parks the admin's own token while they preview a technician, so exiting restores it. */
export const PREVIEW_ORIGIN_COOKIE = 'auth-origin-token';

/**
 * Readable by the client on purpose — purely a UI hint so the shell can render the preview banner
 * without an extra round-trip. Grants nothing: every real check reads the httpOnly cookies.
 */
export const PREVIEW_FLAG_COOKIE = 'preview-mode';
