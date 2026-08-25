import { randomUUID } from 'crypto';
import { sql } from './db';
import { ensurePortoConfigSchema } from './porto-config-schema';

export type SyncJobType = 'hours' | 'schedule';
export type SyncStatus = 'running' | 'success' | 'partial' | 'error' | 'skipped' | 'dry_run';

export async function getPortoConfig() {
  await ensurePortoConfigSchema();
  const rows = await sql`SELECT * FROM porto_config WHERE id = 1`;
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function startSyncLog(jobType: SyncJobType): Promise<string> {
  await ensurePortoConfigSchema();
  const id = randomUUID();
  await sql`
    INSERT INTO porto_sync_log (id, job_type, status)
    VALUES (${id}, ${jobType}, 'running')
  `;
  return id;
}

export async function finishSyncLog(
  id: string,
  result: {
    status: SyncStatus;
    technicians_processed?: number;
    rows_written?: number;
    details?: unknown;
    error_message?: string | null;
    range?: { start: string; end: string };
  },
) {
  await sql`
    UPDATE porto_sync_log
    SET finished_at = NOW(),
        status = ${result.status},
        technicians_processed = ${result.technicians_processed ?? 0},
        rows_written = ${result.rows_written ?? 0},
        details = ${result.details ? JSON.stringify(result.details) : null},
        error_message = ${result.error_message ?? null},
        range_start = ${result.range?.start ?? null},
        range_end = ${result.range?.end ?? null}
    WHERE id = ${id}
  `;
}

export async function recordHoursImportResult(params: { status: SyncStatus; error?: string | null }) {
  await sql`
    UPDATE porto_config
    SET last_hours_import_at = NOW(),
        last_hours_import_status = ${params.status},
        last_error = ${params.error ?? null}
    WHERE id = 1
  `;
}

export async function recordScheduleCheck() {
  await sql`UPDATE porto_config SET last_schedule_check_at = NOW() WHERE id = 1`;
}

export async function recordScheduleImportResult(params: { monthKey: string; status: SyncStatus; error?: string | null }) {
  await sql`
    UPDATE porto_config
    SET last_schedule_import_month = ${params.monthKey},
        last_schedule_import_status = ${params.status},
        last_schedule_check_at = NOW(),
        last_error = ${params.error ?? null}
    WHERE id = 1
  `;
}
