import { sql } from './db';
import {
  createDefaultVisibility,
  normalizeVisibility,
  type TechnicianVisibility,
  type VisibilitySource,
} from './technician-visibility';

/** Row key for the settings that apply to every technician without an override of their own. */
export const GLOBAL_VISIBILITY_SCOPE = 'global';

let technicianVisibilitySchemaReady: Promise<void> | null = null;

export async function ensureTechnicianVisibilitySchema() {
  if (!technicianVisibilitySchemaReady) {
    technicianVisibilitySchemaReady = (async () => {
      // One row per scope: `global`, or a technicians.id for a per-technician override. Stored as
      // JSONB and normalized on read, so adding a new toggle later needs no migration.
      await sql`
        CREATE TABLE IF NOT EXISTS technician_visibility_settings (
          scope TEXT PRIMARY KEY,
          settings JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by TEXT
        )
      `;
    })().catch((error) => {
      // Don't cache a failed attempt — the next request should retry instead of failing forever.
      technicianVisibilitySchemaReady = null;
      throw error;
    });
  }

  return technicianVisibilitySchemaReady;
}

export interface VisibilitySnapshot {
  global: TechnicianVisibility | null;
  override: TechnicianVisibility | null;
  effective: TechnicianVisibility;
  source: VisibilitySource;
}

/** Loads both layers for a technician and resolves which one wins (override → global → defaults). */
export async function loadVisibilitySnapshot(technicianId: string | null): Promise<VisibilitySnapshot> {
  await ensureTechnicianVisibilitySchema();

  const scopes = technicianId ? [GLOBAL_VISIBILITY_SCOPE, technicianId] : [GLOBAL_VISIBILITY_SCOPE];
  const rows = await sql`
    SELECT scope, settings
    FROM technician_visibility_settings
    WHERE scope = ANY(${scopes})
  `;

  const globalRow = rows.find((row) => row.scope === GLOBAL_VISIBILITY_SCOPE);
  const overrideRow = technicianId ? rows.find((row) => row.scope === technicianId) : undefined;
  const global = globalRow ? normalizeVisibility(globalRow.settings) : null;
  const override = overrideRow ? normalizeVisibility(overrideRow.settings) : null;

  if (override) return { global, override, effective: override, source: 'technician' };
  if (global) return { global, override, effective: global, source: 'global' };

  return { global, override, effective: createDefaultVisibility(), source: 'default' };
}

export async function saveVisibility(scope: string, settings: TechnicianVisibility, updatedBy: string) {
  await ensureTechnicianVisibilitySchema();

  await sql`
    INSERT INTO technician_visibility_settings (scope, settings, updated_at, updated_by)
    VALUES (${scope}, ${JSON.stringify(settings)}::jsonb, NOW(), ${updatedBy})
    ON CONFLICT (scope) DO UPDATE
    SET settings = EXCLUDED.settings, updated_at = NOW(), updated_by = EXCLUDED.updated_by
  `;
}

/** How many technicians have their own settings — i.e. won't follow a change to the global ones. */
export async function countVisibilityOverrides() {
  await ensureTechnicianVisibilitySchema();

  const rows = await sql`
    SELECT COUNT(*)::int AS total
    FROM technician_visibility_settings
    WHERE scope <> ${GLOBAL_VISIBILITY_SCOPE}
  `;

  return Number(rows[0]?.total ?? 0);
}

export async function deleteVisibility(scope: string) {
  await ensureTechnicianVisibilitySchema();

  await sql`DELETE FROM technician_visibility_settings WHERE scope = ${scope}`;
}
