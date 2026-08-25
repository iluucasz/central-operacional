import { sql } from './db';

let portoConfigSchemaReady: Promise<void> | null = null;

export async function ensurePortoConfigSchema() {
  if (!portoConfigSchemaReady) {
    portoConfigSchemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS porto_config (
          id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          cpf TEXT,
          encrypted_password TEXT,
          automation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          dry_run_only BOOLEAN NOT NULL DEFAULT TRUE,
          last_hours_import_at TIMESTAMPTZ,
          last_hours_import_status VARCHAR(16),
          last_schedule_check_at TIMESTAMPTZ,
          last_schedule_import_month VARCHAR(7),
          last_schedule_import_status VARCHAR(16),
          last_error TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by TEXT
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS porto_sync_log (
          id TEXT PRIMARY KEY,
          job_type VARCHAR(16) NOT NULL CHECK (job_type IN ('hours', 'schedule')),
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          finished_at TIMESTAMPTZ,
          status VARCHAR(16) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'error', 'skipped', 'dry_run')),
          technicians_processed INTEGER NOT NULL DEFAULT 0,
          rows_written INTEGER NOT NULL DEFAULT 0,
          details JSONB,
          error_message TEXT
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS porto_sync_log_job_type_idx
        ON porto_sync_log (job_type, started_at DESC)
      `;

      await sql`
        ALTER TABLE porto_config
        ADD COLUMN IF NOT EXISTS dry_run_only BOOLEAN NOT NULL DEFAULT TRUE
      `;

      await sql`
        ALTER TABLE work_hours
        ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'manual'
      `;

      // Manual override for matching a technician to their name as it appears in Porto's service
      // search results (which only exposes a free-text name, not the QRA) — the automatic
      // name-prefix match against `technicians.name` can miss when the registered name differs
      // from how Porto displays it (nickname, abbreviation, etc).
      await sql`
        ALTER TABLE technicians
        ADD COLUMN IF NOT EXISTS porto_name_hint TEXT
      `;
    })().catch((error) => {
      portoConfigSchemaReady = null;
      throw error;
    });
  }

  return portoConfigSchemaReady;
}
