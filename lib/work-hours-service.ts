import { sql } from './db';
import { ensurePortoConfigSchema } from './porto-config-schema';

export type AttendanceStatus = 'worked' | 'day_off' | 'missed' | 'justified';
export type WorkHourSource = 'manual' | 'porto';

export type WorkHourEntry = {
  technician_id: string;
  date: string;
  start_time: string;
  end_time: string;
  planned_start_time: string;
  planned_end_time: string;
  hours_worked: number;
  week_number: number;
  month: number;
  year: number;
  attendance_status: AttendanceStatus;
  notes: string;
};

export function getIsoWeekNumber(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getScheduleStatusForAttendance(status: AttendanceStatus) {
  return status === 'worked' ? 'completed' : 'cancelled';
}

/**
 * The driver returns `date`-typed columns as JS Date objects (constructed at local midnight for
 * that calendar date), not plain 'YYYY-MM-DD' strings. `String(dateObject)` calls
 * Date.prototype.toString(), which starts with a weekday abbreviation ("Sat Aug 01 2026...") and
 * never matches a plain date string under any timezone. Use local getters (matching how the Date
 * was constructed) to recover the real calendar-date key instead of relying on string coercion.
 */
function toDateKey(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function getAttendanceLabel(status: AttendanceStatus) {
  if (status === 'day_off') return 'folga';
  if (status === 'missed') return 'falta';
  if (status === 'justified') return 'justificado';
  return 'trabalhou';
}

function buildAttendanceNote(entry: WorkHourEntry) {
  const cleanNotes = entry.notes.trim();
  const base = `Apontamento manual: ${getAttendanceLabel(entry.attendance_status)}; previsto=${entry.planned_start_time}-${entry.planned_end_time}`;

  return cleanNotes ? `${base}; obs=${cleanNotes}` : base;
}

/**
 * Returns the set of "technicianId::date" keys that already have a Porto-imported work_hours row
 * within the given range — used by the hours-import job to skip re-fetching service detail pages
 * for days it has already covered, so a full month-to-date sweep stays cheap on every run after
 * the first catch-up.
 */
export async function getExistingPortoImportedDates(technicianIds: string[], startDate: string, endDate: string): Promise<Set<string>> {
  if (!technicianIds.length) return new Set();

  const rows = await sql.query(
    `
      SELECT technician_id, date
      FROM work_hours
      WHERE source = 'porto'
        AND technician_id = ANY($1)
        AND date >= $2
        AND date <= $3
    `,
    [technicianIds, startDate, endDate],
  );

  return new Set(rows.map((row) => `${String(row.technician_id)}::${toDateKey(row.date)}`));
}

/**
 * Returns the "technicianId::date" keys an admin entered by hand within the range — the Porto
 * import must never overwrite these (its write deletes and re-inserts the day). A manual "worked"
 * entry is a `source='manual'` work_hours row; a manual folga/falta/justificado leaves no
 * work_hours row at all, only a schedule row with the manual note. The Porto import also writes
 * that note prefix, but always alongside its own `source='porto'` work_hours row, hence the
 * NOT EXISTS.
 */
export async function getManualWorkHourDates(technicianIds: string[], startDate: string, endDate: string): Promise<Set<string>> {
  if (!technicianIds.length) return new Set();

  const rows = await sql.query(
    `
      SELECT technician_id, date
      FROM work_hours
      WHERE source = 'manual'
        AND technician_id = ANY($1)
        AND date >= $2
        AND date <= $3
      UNION
      SELECT s.technician_id, s.date
      FROM schedule s
      WHERE s.notes LIKE 'Apontamento manual:%'
        AND s.technician_id = ANY($1)
        AND s.date >= $2
        AND s.date <= $3
        AND NOT EXISTS (
          SELECT 1 FROM work_hours w WHERE w.technician_id = s.technician_id AND w.date = s.date
        )
    `,
    [technicianIds, startDate, endDate],
  );

  return new Set(rows.map((row) => `${String(row.technician_id)}::${toDateKey(row.date)}`));
}

/** The "previsto" already recorded per "technicianId::date" (from the schedule note), when there is one. */
export async function getStoredPlannedTimes(technicianIds: string[], startDate: string, endDate: string): Promise<Map<string, { start: string; end: string }>> {
  if (!technicianIds.length) return new Map();

  const rows = await sql.query(
    `
      SELECT technician_id, date, notes
      FROM schedule
      WHERE notes LIKE '%previsto=%'
        AND technician_id = ANY($1)
        AND date >= $2
        AND date <= $3
    `,
    [technicianIds, startDate, endDate],
  );

  const planned = new Map<string, { start: string; end: string }>();
  for (const row of rows) {
    const match = String(row.notes).match(/previsto=(\d{2}:\d{2})-(\d{2}:\d{2})/);
    if (match) planned.set(`${String(row.technician_id)}::${toDateKey(row.date)}`, { start: match[1], end: match[2] });
  }
  return planned;
}

export async function getActiveTechnicianIds(technicianIds: string[]) {
  if (!technicianIds.length) {
    return new Set<string>();
  }

  const rows = await sql.query("SELECT id FROM technicians WHERE status = 'active' AND id = ANY($1)", [technicianIds]);
  return new Set(rows.map((row) => String(row.id)));
}

export async function applyWorkHourEntries(
  entries: WorkHourEntry[],
  options: { source?: WorkHourSource } = {},
) {
  await ensurePortoConfigSchema();

  const source: WorkHourSource = options.source ?? 'manual';
  const activeTechnicianIds = await getActiveTechnicianIds(Array.from(new Set(entries.map((entry) => entry.technician_id))));
  const entriesForActiveTechnicians = entries.filter((entry) => activeTechnicianIds.has(entry.technician_id));
  const skippedInactive = entries.length - entriesForActiveTechnicians.length;

  const saved = [];
  const schedules = [];

  for (const entry of entriesForActiveTechnicians) {
    await sql`
      DELETE FROM work_hours
      WHERE technician_id = ${entry.technician_id}
        AND date = ${entry.date}
    `;

    if (entry.attendance_status === 'worked') {
      const inserted = await sql`
        INSERT INTO work_hours (
          technician_id, date, start_time, end_time, hours_worked,
          week_number, month, year, source
        )
        VALUES (
          ${entry.technician_id}, ${entry.date}, ${entry.start_time}, ${entry.end_time}, ${entry.hours_worked},
          ${entry.week_number}, ${entry.month}, ${entry.year}, ${source}
        )
        RETURNING *
      `;

      saved.push(inserted[0]);
    }

    await sql`
      DELETE FROM schedule
      WHERE technician_id = ${entry.technician_id}
        AND date = ${entry.date}
    `;

    const scheduleStatus = getScheduleStatusForAttendance(entry.attendance_status);
    const scheduleNote = buildAttendanceNote(entry);
    const scheduleRow = await sql`
      INSERT INTO schedule (
        technician_id, date, start_time, end_time, status, notes
      )
      VALUES (
        ${entry.technician_id}, ${entry.date}, ${entry.start_time}, ${entry.end_time}, ${scheduleStatus}, ${scheduleNote}
      )
      RETURNING *
    `;

    schedules.push(scheduleRow[0]);
  }

  return {
    workHours: saved,
    schedules,
    count: entriesForActiveTechnicians.length,
    skippedInactive,
  };
}
