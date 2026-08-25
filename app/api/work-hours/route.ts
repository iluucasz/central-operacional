import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { applyWorkHourEntries, getActiveTechnicianIds, getIsoWeekNumber, type AttendanceStatus, type WorkHourEntry } from '@/lib/work-hours-service';

const sql = neon(process.env.DATABASE_URL!);

function isValidTime(value: unknown) {
  return typeof value === 'string' && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value);
}

function normalizeTime(value: unknown) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';

  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function isValidDateKey(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function parseHours(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 24 ? Number(parsed.toFixed(2)) : null;
}

function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return value === 'worked' || value === 'day_off' || value === 'missed' || value === 'justified';
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const technicianId = searchParams.get('technicianId');
    const month = searchParams.get('month');

    let query = `
      SELECT id, technician_id, date, start_time, end_time, hours_worked,
             week_number, month, year, created_at
      FROM work_hours
    `;

    const params = [];
    const conditions = [
      `EXISTS (SELECT 1 FROM technicians t WHERE t.id = work_hours.technician_id AND t.status = 'active')`,
    ];

    if (auth.role === 'technician' || technicianId) {
      conditions.push(`technician_id = $${params.length + 1}`);
      params.push(technicianId || auth.technicianId || auth.userId);
    }

    if (month) {
      conditions.push(`TO_CHAR(date::date, 'YYYY-MM') = $${params.length + 1}`);
      params.push(month);
    }

    query += ` WHERE ${conditions.join(' AND ')}`;
    query += ` ORDER BY date DESC`;

    const workHours = await sql.query(query, params);
    return NextResponse.json({ workHours });
  } catch (error) {
    console.error('[v0] Get work hours error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();

    if (auth.role === 'admin' && Array.isArray(body?.entries)) {
      const parsedEntries: WorkHourEntry[] = (body.entries as unknown[])
        .map((entry: unknown) => {
          if (typeof entry !== 'object' || entry === null) {
            return null;
          }

          const raw = entry as Record<string, unknown>;
          const date = String(raw.date ?? '');
          const technicianId = String(raw.technician_id ?? '');
          const attendanceStatus = isAttendanceStatus(raw.attendance_status) ? raw.attendance_status : 'worked';
          const startTime = normalizeTime(raw.start_time);
          const endTime = normalizeTime(raw.end_time);
          const plannedStartTime = normalizeTime(raw.planned_start_time) || startTime;
          const plannedEndTime = normalizeTime(raw.planned_end_time) || endTime;
          const parsedHoursWorked = attendanceStatus === 'worked' ? parseHours(raw.hours_worked) : 0;

          if (
            !technicianId ||
            !isValidDateKey(date) ||
            !isValidTime(plannedStartTime) ||
            !isValidTime(plannedEndTime) ||
            (attendanceStatus === 'worked' && (!isValidTime(startTime) || !isValidTime(endTime) || parsedHoursWorked === null))
          ) {
            return null;
          }

          return {
            technician_id: technicianId,
            date,
            start_time: attendanceStatus === 'worked' ? startTime : plannedStartTime,
            end_time: attendanceStatus === 'worked' ? endTime : plannedEndTime,
            planned_start_time: plannedStartTime,
            planned_end_time: plannedEndTime,
            hours_worked: parsedHoursWorked ?? 0,
            week_number: Number.isInteger(Number(raw.week_number)) ? Number(raw.week_number) : getIsoWeekNumber(date),
            month: Number.isInteger(Number(raw.month)) ? Number(raw.month) : Number(date.slice(5, 7)),
            year: Number.isInteger(Number(raw.year)) ? Number(raw.year) : Number(date.slice(0, 4)),
            attendance_status: attendanceStatus,
            notes: typeof raw.notes === 'string' ? raw.notes : '',
          };
        })
        .filter((entry: WorkHourEntry | null): entry is WorkHourEntry => Boolean(entry));

      if (!parsedEntries.length) {
        return NextResponse.json({ error: 'Nenhum apontamento válido informado.' }, { status: 400 });
      }

      const { workHours, schedules, count, skippedInactive } = await applyWorkHourEntries(parsedEntries, { source: 'manual' });

      if (!count) {
        return NextResponse.json({ error: 'Nenhum apontamento para tecnico ativo foi informado.' }, { status: 400 });
      }

      return NextResponse.json({ workHours, schedules, count, skippedInactive }, { status: 201 });
    }

    const {
      date,
      start_time,
      end_time,
      hours_worked,
      week_number,
      month,
      year,
    } = body;

    const technicianId = auth.role === 'admin' 
      ? request.headers.get('x-technician-id') 
      : auth.technicianId || auth.userId;

    if (!technicianId || !(await getActiveTechnicianIds([technicianId])).has(technicianId)) {
      return NextResponse.json({ error: 'Selecione um tecnico ativo para lancar horas.' }, { status: 409 });
    }

    const result = await sql`
      INSERT INTO work_hours (
        technician_id, date, start_time, end_time, hours_worked,
        week_number, month, year
      )
      VALUES (
        ${technicianId}, ${date}, ${start_time}, ${end_time}, ${hours_worked},
        ${week_number}, ${month}, ${year}
      )
      RETURNING *
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('[v0] Create work hours error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
