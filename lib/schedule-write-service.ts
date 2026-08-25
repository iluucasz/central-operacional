import { sql } from './db';
import type { ScheduleSeedRow } from './schedule-planner';

export const PORTO_SCHEDULE_NOTE_PREFIX = 'Importado do Porto:';
const MANUAL_NOTE_PREFIX = 'Apontamento manual:';

type ProtectionMode = 'generated' | 'porto';

type ReplaceScheduleRowsParams = {
  technicianIds: string[];
  startDate: string;
  endDate: string;
  rows: ScheduleSeedRow[];
};

async function replaceScheduleRows(params: ReplaceScheduleRowsParams & { mode: ProtectionMode }) {
  const { technicianIds, startDate, endDate, rows, mode } = params;

  // 'generated' (internal "Montar escala" wizard) also treats Porto-imported rows as protected,
  // so it never clobbers data that already came from the source of truth. The Porto import job
  // itself uses 'porto' mode, which is allowed to replace its own previously-imported rows
  // (idempotent re-import) while still never touching completed or manually-entered days.
  const protectedClause =
    mode === 'generated'
      ? `(status = 'completed' OR notes LIKE '${MANUAL_NOTE_PREFIX}%' OR notes LIKE '${PORTO_SCHEDULE_NOTE_PREFIX}%')`
      : `(status = 'completed' OR notes LIKE '${MANUAL_NOTE_PREFIX}%')`;

  const deleteClause =
    mode === 'generated'
      ? `status <> 'completed' AND COALESCE(notes, '') NOT LIKE '${MANUAL_NOTE_PREFIX}%' AND COALESCE(notes, '') NOT LIKE '${PORTO_SCHEDULE_NOTE_PREFIX}%'`
      : `status <> 'completed' AND COALESCE(notes, '') NOT LIKE '${MANUAL_NOTE_PREFIX}%'`;

  const preservedRows = await sql.query(
    `
      SELECT technician_id, date
      FROM schedule
      WHERE technician_id = ANY($1)
        AND date >= $2
        AND date <= $3
        AND ${protectedClause}
    `,
    [technicianIds, startDate, endDate],
  );

  const preservedKeys = new Set(
    preservedRows.map((row) => `${String(row.technician_id)}::${String(row.date).slice(0, 10)}`),
  );

  const filteredRows = rows.filter((row) => !preservedKeys.has(`${row.technician_id}::${row.date}`));

  const inserted = await sql.query(
    `
      WITH deleted AS (
        DELETE FROM schedule
        WHERE technician_id = ANY($1)
          AND date >= $2
          AND date <= $3
          AND ${deleteClause}
        RETURNING 1
      ),
      input_rows AS (
        SELECT *
        FROM jsonb_to_recordset($4::jsonb) AS item(
          technician_id uuid,
          date date,
          start_time time,
          end_time time,
          status schedule_status,
          notes text
        )
      )
      INSERT INTO schedule (
        technician_id, date, start_time, end_time, status, notes
      )
      SELECT technician_id, date, start_time, end_time, status, notes
      FROM input_rows
      RETURNING id, technician_id, date, start_time, end_time, status, notes, created_at
    `,
    [technicianIds, startDate, endDate, JSON.stringify(filteredRows)],
  );

  return { inserted, preservedCount: preservedKeys.size };
}

/** Used by the internal "Montar escala" generator. Never overwrites completed, manually-entered, or Porto-imported days. */
export async function replaceGeneratedScheduleRows(params: ReplaceScheduleRowsParams) {
  return replaceScheduleRows({ ...params, mode: 'generated' });
}

/**
 * Used only by the Porto schedule-import job. Never overwrites completed or manually-entered
 * days. Unlike `replaceGeneratedScheduleRows`, it does NOT treat its own prior `Importado do
 * Porto:` rows as protected — so it replaces them freely, making re-imports idempotent. Note this
 * means it also replaces any other non-completed/non-manual row in scope (e.g. a plain
 * `status='scheduled'` row the internal "Montar escala" wizard created before Porto import was
 * ever enabled for that period) — same broad delete-scope the internal generator itself already
 * uses against arbitrary pre-existing rows, just without excluding Porto's own output from it.
 */
export async function replacePortoScheduleRows(params: ReplaceScheduleRowsParams) {
  return replaceScheduleRows({ ...params, mode: 'porto' });
}
