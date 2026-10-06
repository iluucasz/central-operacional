// Relative imports only: also compiled into the VPS worker (worker/tsconfig.json).
import { sql } from './db';
import { DEFAULT_ORGANIZATION_SETTINGS, normalizeOrganizationSettings, type OrganizationSettings } from './organization-settings';

let schemaReady: Promise<void> | null = null;

/**
 * One row (single-company system). The fields live in a validated JSONB document — same pattern as
 * whatsapp_config / technician_visibility_settings — so adding a setting needs no schema change;
 * normalizeOrganizationSettings fills anything missing with its default.
 */
export function ensureOrganizationSettingsSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS organization_settings (
          id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by TEXT
        )
      `;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

// Payroll previews read the settings once per technician; a short in-process cache keeps that to
// one query per request burst. Saving clears it in this process; other processes (other Vercel
// instances, the worker) pick the change up within CACHE_TTL_MS.
const CACHE_TTL_MS = 30_000;
let cached: { settings: OrganizationSettings; at: number } | null = null;

/** The saved settings, or the defaults (the values that used to be hardcoded) when none were saved yet. */
export async function getOrganizationSettings(): Promise<OrganizationSettings> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.settings;

  await ensureOrganizationSettingsSchema();
  const rows = await sql`SELECT data FROM organization_settings WHERE id = 1`;
  const settings = rows[0] ? normalizeOrganizationSettings(rows[0].data) : { ...DEFAULT_ORGANIZATION_SETTINGS };
  cached = { settings, at: Date.now() };
  return settings;
}

export async function getOrganizationSettingsMeta(): Promise<{ updatedAt: string | null; updatedBy: string | null }> {
  await ensureOrganizationSettingsSchema();
  const rows = await sql`SELECT updated_at, updated_by FROM organization_settings WHERE id = 1`;
  return {
    updatedAt: rows[0]?.updated_at ? new Date(rows[0].updated_at as string).toISOString() : null,
    updatedBy: (rows[0]?.updated_by as string | undefined) ?? null,
  };
}

/** Upserts the (already validated) settings and returns what was stored. */
export async function saveOrganizationSettings(settings: OrganizationSettings, userId: string): Promise<OrganizationSettings> {
  await ensureOrganizationSettingsSchema();
  const rows = await sql`
    INSERT INTO organization_settings (id, data, updated_at, updated_by)
    VALUES (1, ${JSON.stringify(settings)}::jsonb, NOW(), ${userId})
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW(), updated_by = EXCLUDED.updated_by
    RETURNING data
  `;
  const saved = normalizeOrganizationSettings(rows[0]?.data);
  cached = { settings: saved, at: Date.now() };
  return saved;
}
