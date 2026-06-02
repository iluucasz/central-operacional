'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { formatDate, formatTime, formatTimeRange } from '@/lib/formatters';
import { enumerateDateKeys, normalizeDateKey } from '@/lib/schedule-planner';
import type { Schedule } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

type PeriodMode = 'week' | 'month' | 'year';

interface ScheduleViewEntry {
  date: string;
  entry?: Schedule;
}

interface ScheduleFilterActionProps {
  periodMode: PeriodMode;
  onPeriodModeChange: (value: PeriodMode) => void;
  selectedMonth: string;
  onSelectedMonthChange: (value: string) => void;
  selectedYear: string;
  onSelectedYearChange: (value: string) => void;
  monthOptions: string[];
  yearOptions: string[];
}

const periodLabels: Record<PeriodMode, string> = {
  week: 'semanal',
  month: 'mensal',
  year: 'anual',
};

function getStatusLabel(status: Schedule['status']) {
  if (status === 'cancelled') return 'Folga';
  if (status === 'completed') return 'Concluido';
  return 'Escalado';
}

function getStatusTone(status: Schedule['status']) {
  if (status === 'cancelled') return 'warning' as const;
  if (status === 'completed') return 'success' as const;
  return 'info' as const;
}

function getSchedulePriority(status: Schedule['status']) {
  if (status === 'scheduled') return 3;
  if (status === 'completed') return 2;
  return 1;
}

function getScheduleTimestamp(entry: Schedule) {
  const timestamp = Date.parse(entry.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getBestScheduleEntry(entries: Schedule[]) {
  return entries.reduce<Schedule | undefined>((best, entry) => {
    if (!best) return entry;

    const entryTimestamp = getScheduleTimestamp(entry);
    const bestTimestamp = getScheduleTimestamp(best);

    if (entryTimestamp > bestTimestamp || (entryTimestamp === bestTimestamp && getSchedulePriority(entry.status) > getSchedulePriority(best.status))) {
      return entry;
    }

    return best;
  }, undefined);
}

function getMonthValue(value: string) {
  return normalizeDateKey(value).slice(0, 7);
}

function getYearValue(value: string) {
  return normalizeDateKey(value).slice(0, 4);
}

function formatMonthLabel(monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, 1));

  return date.toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
}

function getWeekRange(dateValue: string) {
  const dateKey = normalizeDateKey(dateValue);
  const start = new Date(`${dateKey}T00:00:00Z`);

  if (Number.isNaN(start.getTime())) return null;

  const day = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - day);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function getMonthRange(monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number);
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isFinite(month) ? month : 1;
  const monthIndex = Math.max(safeMonth - 1, 0);
  const start = new Date(Date.UTC(safeYear, monthIndex, 1));
  const end = new Date(Date.UTC(safeYear, monthIndex + 1, 0));

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function getYearRange(yearValue: string) {
  const safeYear = Number.parseInt(yearValue, 10) || new Date().getFullYear();

  return {
    start: `${safeYear}-01-01`,
    end: `${safeYear}-12-31`,
  };
}

function getPeriodRange(periodMode: PeriodMode, referenceDate: string, selectedMonth: string, selectedYear: string) {
  if (periodMode === 'week') {
    return getWeekRange(referenceDate);
  }

  if (periodMode === 'month') {
    return getMonthRange(selectedMonth || getMonthValue(referenceDate));
  }

  return getYearRange(selectedYear || getYearValue(referenceDate));
}

function buildScheduleViewEntries(schedule: Schedule[], periodMode: PeriodMode, referenceDate: string, selectedMonth: string, selectedYear: string) {
  const range = getPeriodRange(periodMode, referenceDate, selectedMonth, selectedYear);
  if (!range) return [] as ScheduleViewEntry[];

  const scheduleByDate = new Map<string, Schedule[]>();

  schedule.forEach((item) => {
    const dateKey = normalizeDateKey(item.date);
    if (dateKey < range.start || dateKey > range.end) return;

    scheduleByDate.set(dateKey, [...(scheduleByDate.get(dateKey) ?? []), item]);
  });

  return enumerateDateKeys(range.start, range.end).map((dateKey) => ({
    date: dateKey,
    entry: getBestScheduleEntry(scheduleByDate.get(dateKey) ?? []),
  }));
}

function ScheduleFilterAction({
  periodMode,
  onPeriodModeChange,
  selectedMonth,
  onSelectedMonthChange,
  selectedYear,
  onSelectedYearChange,
  monthOptions,
  yearOptions,
}: ScheduleFilterActionProps) {
  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <button
          type="button"
          onClick={() => onPeriodModeChange('week')}
          className={`rounded-md border px-3 py-1.5 text-sm ${periodMode === 'week' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}
        >
          Semanal
        </button>
        <button
          type="button"
          onClick={() => onPeriodModeChange('month')}
          className={`rounded-md border px-3 py-1.5 text-sm ${periodMode === 'month' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}
        >
          Mensal
        </button>
        <button
          type="button"
          onClick={() => onPeriodModeChange('year')}
          className={`rounded-md border px-3 py-1.5 text-sm ${periodMode === 'year' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}
        >
          Anual
        </button>
      </div>

      {periodMode === 'month' ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Mes</span>
          <select
            value={selectedMonth}
            onChange={(event) => onSelectedMonthChange(event.target.value)}
            className="min-h-10 rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
          >
            {monthOptions.map((monthValue) => (
              <option key={monthValue} value={monthValue}>
                {formatMonthLabel(monthValue)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {periodMode === 'year' ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Ano</span>
          <select
            value={selectedYear}
            onChange={(event) => onSelectedYearChange(event.target.value)}
            className="min-h-10 rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
          >
            {yearOptions.map((yearValue) => (
              <option key={yearValue} value={yearValue}>
                {yearValue}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

export function TechnicianScheduleViewPage() {
  const { user, loading } = useAppSession();
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [calendarPeriodMode, setCalendarPeriodMode] = useState<PeriodMode>('week');
  const [calendarSelectedMonth, setCalendarSelectedMonth] = useState(() => getMonthValue(new Date().toISOString()));
  const [calendarSelectedYear, setCalendarSelectedYear] = useState(() => getYearValue(new Date().toISOString()));
  const [listPeriodMode, setListPeriodMode] = useState<PeriodMode>('week');
  const [listSelectedMonth, setListSelectedMonth] = useState(() => getMonthValue(new Date().toISOString()));
  const [listSelectedYear, setListSelectedYear] = useState(() => getYearValue(new Date().toISOString()));

  useEffect(() => {
    let mounted = true;

    async function loadSchedule() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      try {
        const technicianId = user.technicianId ?? user.userId;
        const response = await fetch(`/api/schedule?technicianId=${technicianId}`);

        if (!response.ok) {
          throw new Error('schedule_fetch_failed');
        }

        const data = await response.json();
        if (mounted) {
          setSchedule(Array.isArray(data.schedules) ? data.schedules : []);
        }
      } catch {
        if (mounted) {
          setSchedule([]);
          setDataError('Nao foi possivel carregar dados reais de escala.');
        }
      } finally {
        if (mounted) {
          setIsDataLoading(false);
        }
      }
    }

    loadSchedule();

    return () => {
      mounted = false;
    };
  }, [user]);

  const sortedSchedule = useMemo(() => {
    return [...schedule].sort((left, right) => normalizeDateKey(left.date).localeCompare(normalizeDateKey(right.date)));
  }, [schedule]);

  const todayKey = normalizeDateKey(new Date().toISOString());
  const referenceDateKey = useMemo(() => {
    const upcoming = sortedSchedule.find((item) => normalizeDateKey(item.date) >= todayKey && item.status !== 'cancelled');
    if (upcoming) return normalizeDateKey(upcoming.date);
    if (sortedSchedule.length) return normalizeDateKey(sortedSchedule[sortedSchedule.length - 1].date);
    return todayKey;
  }, [sortedSchedule, todayKey]);

  const monthOptions = useMemo(() => {
    const values = Array.from(new Set(sortedSchedule.map((item) => getMonthValue(item.date))));
    return values.length ? values.reverse() : [getMonthValue(referenceDateKey)];
  }, [referenceDateKey, sortedSchedule]);

  const yearOptions = useMemo(() => {
    const values = Array.from(new Set(sortedSchedule.map((item) => getYearValue(item.date))));
    return values.length ? values.reverse() : [getYearValue(referenceDateKey)];
  }, [referenceDateKey, sortedSchedule]);

  useEffect(() => {
    if (!monthOptions.includes(calendarSelectedMonth)) {
      setCalendarSelectedMonth(monthOptions[0]);
    }
    if (!monthOptions.includes(listSelectedMonth)) {
      setListSelectedMonth(monthOptions[0]);
    }
  }, [calendarSelectedMonth, listSelectedMonth, monthOptions]);

  useEffect(() => {
    if (!yearOptions.includes(calendarSelectedYear)) {
      setCalendarSelectedYear(yearOptions[0]);
    }
    if (!yearOptions.includes(listSelectedYear)) {
      setListSelectedYear(yearOptions[0]);
    }
  }, [calendarSelectedYear, listSelectedYear, yearOptions]);

  const calendarSchedule = useMemo(
    () => (dataError ? [] : buildScheduleViewEntries(sortedSchedule, calendarPeriodMode, referenceDateKey, calendarSelectedMonth, calendarSelectedYear)),
    [calendarPeriodMode, calendarSelectedMonth, calendarSelectedYear, dataError, referenceDateKey, sortedSchedule],
  );

  const listSchedule = useMemo(
    () => (dataError ? [] : buildScheduleViewEntries(sortedSchedule, listPeriodMode, referenceDateKey, listSelectedMonth, listSelectedYear)),
    [dataError, listPeriodMode, listSelectedMonth, listSelectedYear, referenceDateKey, sortedSchedule],
  );

  const summarySchedule = useMemo(
    () => (dataError ? [] : buildScheduleViewEntries(sortedSchedule, 'week', referenceDateKey, getMonthValue(referenceDateKey), getYearValue(referenceDateKey))),
    [dataError, referenceDateKey, sortedSchedule],
  );

  if (loading || isDataLoading || !user) {
    return <LoadingState />;
  }

  const hasCalendarEntries = calendarSchedule.some((item) => item.entry);
  const hasListEntries = listSchedule.some((item) => item.entry);
  const scheduled = summarySchedule.filter((item) => item.entry && item.entry.status !== 'cancelled').length;
  const dayOff = summarySchedule.filter((item) => item.entry?.status === 'cancelled').length;
  const nextSchedule =
    summarySchedule.find((item) => item.entry && item.entry.status !== 'cancelled' && item.date >= todayKey) ??
    summarySchedule.find((item) => item.entry && item.entry.status !== 'cancelled');
  const calendarTitle = `Calendario ${periodLabels[calendarPeriodMode]}`;
  const calendarDescription =
    calendarPeriodMode === 'week'
      ? 'Escala persistida da semana.'
      : calendarPeriodMode === 'month'
        ? 'Escala persistida do mes.'
        : 'Escala persistida do ano.';
  const listDescription =
    listPeriodMode === 'week'
      ? 'Lista da semana usando apenas os registros gravados no banco.'
      : listPeriodMode === 'month'
        ? 'Lista do mes usando apenas os registros gravados no banco.'
        : 'Lista do ano usando apenas os registros gravados no banco.';

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader eyebrow="Agenda" title="Minha escala" description="Visualize apenas a escala real persistida para voce, sem projeção padrao no front." />

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard title="Proximas escalas" value={scheduled} hint="Registros reais no proximo ciclo" icon={CalendarDays} />
        <MetricCard title="Folgas" value={dayOff} hint="Cancelamentos reais no proximo ciclo" icon={CalendarDays} tone="warning" />
        <MetricCard
          title="Proximo horario"
          value={nextSchedule?.entry?.start_time ? formatTime(nextSchedule.entry.start_time) : 'Sem escala'}
          hint={nextSchedule?.entry ? formatDate(nextSchedule.date) : 'Nenhum turno persistido'}
          icon={Clock3}
        />
      </div>

      <div className="mt-5">
        <DataPanel
          title={calendarTitle}
          description={calendarDescription}
          action={
            <ScheduleFilterAction
              periodMode={calendarPeriodMode}
              onPeriodModeChange={setCalendarPeriodMode}
              selectedMonth={calendarSelectedMonth}
              onSelectedMonthChange={setCalendarSelectedMonth}
              selectedYear={calendarSelectedYear}
              onSelectedYearChange={setCalendarSelectedYear}
              monthOptions={monthOptions}
              yearOptions={yearOptions}
            />
          }
        >
          {hasCalendarEntries ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
              {calendarSchedule.map((item) => (
                <div key={item.date} className="rounded-md border border-border bg-background p-3">
                  <p className="text-sm font-semibold">{formatDate(item.date)}</p>
                  <div className="mt-3">
                    <StatusBadge tone={item.entry ? getStatusTone(item.entry.status) : 'neutral'}>
                      {item.entry ? getStatusLabel(item.entry.status) : 'Sem escala'}
                    </StatusBadge>
                  </div>
                  <p className="mt-3 text-sm">
                    {item.entry ? item.entry.status === 'cancelled' ? item.entry.notes || 'Folga planejada' : formatTimeRange(item.entry.start_time, item.entry.end_time) : 'Sem registro persistido para esta data.'}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={CalendarDays} title="Sem escala persistida no periodo" description="Nao existem registros gravados no banco para o periodo selecionado." />
          )}
        </DataPanel>
      </div>

      <div className="mt-5">
        <DataPanel
          title="Lista de escala"
          description={listDescription}
          action={
            <ScheduleFilterAction
              periodMode={listPeriodMode}
              onPeriodModeChange={setListPeriodMode}
              selectedMonth={listSelectedMonth}
              onSelectedMonthChange={setListSelectedMonth}
              selectedYear={listSelectedYear}
              onSelectedYearChange={setListSelectedYear}
              monthOptions={monthOptions}
              yearOptions={yearOptions}
            />
          }
        >
          {hasListEntries ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Data</th>
                    <th className="py-3 pr-4 font-medium">Horario</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 font-medium">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {listSchedule.map((item) => (
                    <tr key={item.date} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4">{formatDate(item.date)}</td>
                      <td className="py-3 pr-4">{item.entry ? item.entry.status === 'cancelled' ? item.entry.notes || 'Folga planejada' : formatTimeRange(item.entry.start_time, item.entry.end_time) : 'Sem registro'}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge tone={item.entry ? getStatusTone(item.entry.status) : 'neutral'}>
                          {item.entry ? getStatusLabel(item.entry.status) : 'Sem escala'}
                        </StatusBadge>
                      </td>
                      <td className="py-3 text-muted-foreground">{item.entry?.notes || (item.entry ? '-' : 'Nao persistido')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={CalendarDays} title="Sem registros de escala" description="Nao ha escala persistida para o periodo selecionado." />
          )}
        </DataPanel>
      </div>
    </AppShell>
  );
}