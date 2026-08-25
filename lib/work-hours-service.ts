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

  return new Set(rows.map((row) => `${String(row.technician_id)}::${String(row.date).slice(0, 10)}`));
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
