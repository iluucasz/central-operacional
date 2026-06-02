import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';

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

function getIsoWeekNumber(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function parseHours(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 24 ? Number(parsed.toFixed(2)) : null;
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

    if (auth.role === 'technician' || technicianId) {
      query += ` WHERE technician_id = $${params.length + 1}`;
      params.push(technicianId || auth.technicianId || auth.userId);
    }

    if (month && auth.role === 'admin') {
      query += params.length > 0 ? ` AND competence_month = $${params.length + 1}` : ` WHERE competence_month = $1`;
      params.push(month);
    }

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
      const parsedEntries = body.entries
        .map((entry: unknown) => {
          if (typeof entry !== 'object' || entry === null) {
            return null;
          }

          const raw = entry as Record<string, unknown>;
          const date = String(raw.date ?? '');
          const technicianId = String(raw.technician_id ?? '');
          const startTime = normalizeTime(raw.start_time);
          const endTime = normalizeTime(raw.end_time);
          const hoursWorked = parseHours(raw.hours_worked);

          if (!technicianId || !isValidDateKey(date) || !isValidTime(startTime) || !isValidTime(endTime) || hoursWorked === null) {
            return null;
          }

          return {
            technician_id: technicianId,
            date,
            start_time: startTime,
            end_time: endTime,
            hours_worked: hoursWorked,
            week_number: Number.isInteger(Number(raw.week_number)) ? Number(raw.week_number) : getIsoWeekNumber(date),
            month: Number.isInteger(Number(raw.month)) ? Number(raw.month) : Number(date.slice(5, 7)),
            year: Number.isInteger(Number(raw.year)) ? Number(raw.year) : Number(date.slice(0, 4)),
          };
        })
        .filter((entry: unknown): entry is {
          technician_id: string;
          date: string;
          start_time: string;
          end_time: string;
          hours_worked: number;
          week_number: number;
          month: number;
          year: number;
        } => Boolean(entry));

      if (!parsedEntries.length) {
        return NextResponse.json({ error: 'Nenhum apontamento válido informado.' }, { status: 400 });
      }

      const saved = [];

      for (const entry of parsedEntries) {
        await sql`
          DELETE FROM work_hours
          WHERE technician_id = ${entry.technician_id}
            AND date = ${entry.date}
        `;

        const inserted = await sql`
          INSERT INTO work_hours (
            technician_id, date, start_time, end_time, hours_worked,
            week_number, month, year
          )
          VALUES (
            ${entry.technician_id}, ${entry.date}, ${entry.start_time}, ${entry.end_time}, ${entry.hours_worked},
            ${entry.week_number}, ${entry.month}, ${entry.year}
          )
          RETURNING *
        `;

        await sql`
          UPDATE schedule
          SET status = 'completed'
          WHERE technician_id = ${entry.technician_id}
            AND date = ${entry.date}
            AND status <> 'cancelled'
        `;

        saved.push(inserted[0]);
      }

      return NextResponse.json({ workHours: saved, count: saved.length }, { status: 201 });
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
