'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { demoSchedule, demoTechnicians } from '@/lib/demo-data';
import { formatDate, formatTime, formatTimeRange } from '@/lib/formatters';
import type { Schedule } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

type PeriodMode = 'week' | 'month' | 'year';

const periodLabels: Record<PeriodMode, string> = {
  week: 'semanal',
  month: 'mensal',
  year: 'anual',
};

function getStatusLabel(status: Schedule['status']) {
  if (status === 'cancelled') return 'Folga';
  if (status === 'completed') return 'Concluído';
  return 'Escalado';
}

function getDateKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}

function getMonthValue(value: string) {
  return getDateKey(value).slice(0, 7);
}

function getYearValue(value: string) {
  return getDateKey(value).slice(0, 4);
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
  const dateKey = getDateKey(dateValue);
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

function filterScheduleByPeriod(schedule: Schedule[], periodMode: PeriodMode, referenceDate: string, selectedMonth: string, selectedYear: string) {
  if (periodMode === 'week') {
    const weekRange = getWeekRange(referenceDate);
    if (!weekRange) return schedule;

    return schedule.filter((item) => {
      const dateKey = getDateKey(item.date);
      return dateKey >= weekRange.start && dateKey <= weekRange.end;
    });
  }

  if (periodMode === 'month') {
    const monthKey = selectedMonth || getMonthValue(referenceDate);
    return schedule.filter((item) => getDateKey(item.date).slice(0, 7) === monthKey);
  }

  const yearKey = selectedYear || getYearValue(referenceDate);
  return schedule.filter((item) => getDateKey(item.date).slice(0, 4) === yearKey);
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
          <span className="text-xs font-semibold uppercase text-muted-foreground">Mês</span>
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

export default function TechnicianSchedulePage() {
  const { user, loading } = useAppSession();
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [calendarPeriodMode, setCalendarPeriodMode] = useState<PeriodMode>('week');
  const [calendarSelectedMonth, setCalendarSelectedMonth] = useState(() => getMonthValue(new Date().toISOString()));
  const [calendarSelectedYear, setCalendarSelectedYear] = useState(() => getYearValue(new Date().toISOString()));
  const [listPeriodMode, setListPeriodMode] = useState<PeriodMode>('week');
  const [listSelectedMonth, setListSelectedMonth] = useState(() => getMonthValue(new Date().toISOString()));
  const [listSelectedYear, setListSelectedYear] = useState(() => getYearValue(new Date().toISOString()));

  useEffect(() => {
    async function loadSchedule() {
      if (!user) return;
      const technicianId = user.technicianId ?? user.userId;
      const response = await fetch(`/api/schedule?technicianId=${technicianId}`);
      if (response.ok) {
        const data = await response.json();
        setSchedule(data.schedules ?? []);
      }
    }

    loadSchedule();
  }, [user]);

  const fallbackTechnician = demoTechnicians[0];
  const visibleSchedule = schedule.length ? schedule : demoSchedule.filter((item) => item.technician_id === fallbackTechnician.id);
  const sortedSchedule = useMemo(() => {
    return [...visibleSchedule].sort((left, right) => getDateKey(left.date).localeCompare(getDateKey(right.date)));
  }, [visibleSchedule]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const referenceDateKey = useMemo(() => {
    const upcoming = sortedSchedule.find((item) => getDateKey(item.date) >= todayKey);
    if (upcoming) return getDateKey(upcoming.date);
    if (sortedSchedule.length) return getDateKey(sortedSchedule[sortedSchedule.length - 1].date);
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
    () => filterScheduleByPeriod(sortedSchedule, calendarPeriodMode, referenceDateKey, calendarSelectedMonth, calendarSelectedYear),
    [calendarPeriodMode, calendarSelectedMonth, calendarSelectedYear, referenceDateKey, sortedSchedule],
  );

  const listSchedule = useMemo(
    () => filterScheduleByPeriod(sortedSchedule, listPeriodMode, referenceDateKey, listSelectedMonth, listSelectedYear),
    [listPeriodMode, listSelectedMonth, listSelectedYear, referenceDateKey, sortedSchedule],
  );

  if (loading || !user) {
    return <LoadingState />;
  }

  const scheduled = sortedSchedule.filter((item) => item.status === 'scheduled').length;
  const dayOff = sortedSchedule.filter((item) => item.status === 'cancelled').length;
  const nextSchedule =
    sortedSchedule.find((item) => getDateKey(item.date) >= todayKey && item.start_time) ??
    sortedSchedule.find((item) => item.start_time) ??
    sortedSchedule[0];
  const calendarTitle = `Calendário ${periodLabels[calendarPeriodMode]}`;
  const calendarDescription =
    calendarPeriodMode === 'week'
      ? 'Escala planejada para a semana selecionada.'
      : calendarPeriodMode === 'month'
        ? 'Escala planejada para o mês selecionado.'
        : 'Escala planejada para o ano selecionado.';
  const listDescription =
    listPeriodMode === 'week'
      ? 'Histórico visível ao colaborador na semana selecionada.'
      : listPeriodMode === 'month'
        ? 'Histórico visível ao colaborador no mês selecionado.'
        : 'Histórico visível ao colaborador no ano selecionado.';

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader eyebrow="Agenda" title="Minha escala" description="Visualize turnos planejados, folgas e atendimentos concluídos." />

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard title="Próximas escalas" value={scheduled} hint="Turnos planejados" icon={CalendarDays} />
        <MetricCard title="Folgas" value={dayOff} hint="Folgas marcadas" icon={CalendarDays} tone="warning" />
        <MetricCard
          title="Próximo horário"
          value={nextSchedule?.start_time ? formatTime(nextSchedule.start_time) : 'Folga'}
          hint={nextSchedule ? formatDate(nextSchedule.date) : 'Sem agenda'}
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
          {calendarSchedule.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
              {calendarSchedule.map((item) => (
                <div key={item.id} className="rounded-md border border-border bg-background p-3">
                  <p className="text-sm font-semibold">{formatDate(item.date)}</p>
                  <div className="mt-3">
                    <StatusBadge tone={item.status === 'cancelled' ? 'warning' : item.status === 'completed' ? 'success' : 'info'}>
                      {getStatusLabel(item.status)}
                    </StatusBadge>
                  </div>
                  <p className="mt-3 text-sm">{item.start_time ? formatTimeRange(item.start_time, item.end_time) : item.notes}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sem escala no período selecionado.</p>
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">Data</th>
                  <th className="py-3 pr-4 font-medium">Horário</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 font-medium">Obs.</th>
                </tr>
              </thead>
              <tbody>
                {listSchedule.length ? (
                  listSchedule.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4">{formatDate(item.date)}</td>
                      <td className="py-3 pr-4">{formatTimeRange(item.start_time, item.end_time)}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge tone={item.status === 'cancelled' ? 'warning' : item.status === 'completed' ? 'success' : 'info'}>
                          {getStatusLabel(item.status)}
                        </StatusBadge>
                      </td>
                      <td className="py-3 text-muted-foreground">{item.notes || '-'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      Sem registros no período selecionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DataPanel>
      </div>
    </AppShell>
  );
}
