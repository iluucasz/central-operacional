'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, Plus, Search, Users } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { demoSchedule, demoTechnicians } from '@/lib/demo-data';
import { formatDate, formatTimeRange, normalizeText } from '@/lib/formatters';
import type { Schedule, Technician } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

type SchedulePattern = 'single' | 'all_sundays' | 'alternate_saturdays' | 'alternate_weekends';

const initialFormData = {
  technician_id: '',
  date: new Date().toISOString().split('T')[0],
  start_time: '08:00',
  end_time: '17:00',
  status: 'cancelled' as Schedule['status'],
  pattern: 'single' as SchedulePattern,
  notes: '',
};

type ScheduleFormData = typeof initialFormData;

const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const weekdayLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const DEFAULT_START_TIME = '08:00';
const DEFAULT_END_TIME = '17:00';

function createInitialFormData(): ScheduleFormData {
  return { ...initialFormData };
}

function getDateKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}

function createDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split('-').map(Number);

  return {
    year,
    month: Math.max((month || 1) - 1, 0),
    day: day || 1,
  };
}

function getMonthWeeks(year: number, month: number) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells: Array<number | null> = [
    ...Array.from({ length: firstDayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
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
    if (!best) {
      return entry;
    }

    const entryTimestamp = getScheduleTimestamp(entry);
    const bestTimestamp = getScheduleTimestamp(best);

    if (entryTimestamp > bestTimestamp || (entryTimestamp === bestTimestamp && getSchedulePriority(entry.status) > getSchedulePriority(best.status))) {
      return entry;
    }

    return best;
  }, undefined);
}

function getScheduleDates(formData: ScheduleFormData) {
  if (formData.pattern === 'single') return [formData.date];

  const { year, month } = parseDateKey(formData.date);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthDays = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;

    return {
      day,
      key: createDateKey(year, month, day),
      weekday: new Date(year, month, day).getDay(),
    };
  });

  if (formData.pattern === 'all_sundays') {
    return monthDays.filter((date) => date.weekday === 0).map((date) => date.key);
  }

  const saturdays = monthDays.filter((date) => date.weekday === 6);

  if (formData.pattern === 'alternate_saturdays') {
    return saturdays.filter((_, index) => index % 2 === 0).map((date) => date.key);
  }

  return saturdays
    .filter((_, index) => index % 2 === 0)
    .flatMap((date) => {
      const sunday = date.day + 1 <= daysInMonth ? createDateKey(year, month, date.day + 1) : null;
      return sunday ? [date.key, sunday] : [date.key];
    });
}

function getStatusLabel(status: Schedule['status']) {
  if (status === 'cancelled') return 'Folga';
  if (status === 'completed') return 'Concluído';
  return 'Escalado';
}

export default function SchedulePage() {
  const { user, loading } = useAppSession();
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [query, setQuery] = useState('');
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [isCalendarDialogOpen, setIsCalendarDialogOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarWeek, setCalendarWeek] = useState('all');
  const [formData, setFormData] = useState<ScheduleFormData>(createInitialFormData);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function loadData() {
      if (!user) return;
      const [scheduleRes, techniciansRes] = await Promise.all([fetch('/api/schedule'), fetch('/api/technicians')]);

      if (scheduleRes.ok) {
        const data = await scheduleRes.json();
        setSchedule(data.schedules ?? []);
      }

      if (techniciansRes.ok) {
        const data = await techniciansRes.json();
        setTechnicians(data.technicians ?? []);
      }
    }

    loadData();
  }, [user]);

  const visibleSchedule = schedule.length || technicians.length ? schedule : demoSchedule;
  const visibleTechnicians = technicians.length ? technicians : demoTechnicians.filter((technician) => technician.status === 'active');
  const sortedTechnicians = [...visibleTechnicians].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  const inputClassName = 'min-h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition focus:ring-2 focus:ring-ring';
  const calendarWeeks = useMemo(() => getMonthWeeks(calendarYear, calendarMonth), [calendarMonth, calendarYear]);
  const displayedCalendarWeeks = calendarWeek === 'all' ? calendarWeeks : [calendarWeeks[Number(calendarWeek)] ?? calendarWeeks[0]].filter(Boolean);
  const calendarYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from(new Set([currentYear, ...visibleSchedule.map((item) => Number(getDateKey(item.date).slice(0, 4)))]))
      .filter((year) => Number.isFinite(year))
      .sort((left, right) => left - right);
  }, [visibleSchedule]);
  const scheduleByDate = useMemo(() => {
    const grouped = new Map<string, Schedule[]>();

    visibleSchedule.forEach((item) => {
      const key = getDateKey(item.date);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });

    return grouped;
  }, [visibleSchedule]);
  const weekDates = useMemo(() => {
    const dates = Array.from(new Set(visibleSchedule.map((item) => getDateKey(item.date)))).sort();
    if (dates.length >= 7) return dates.slice(0, 7);

    const start = new Date();
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date.toISOString().slice(0, 10);
    });
  }, [visibleSchedule]);

  const filteredSchedule = useMemo(() => {
    return visibleSchedule.filter((item) => {
      const haystack = normalizeText(`${item.technician_name} ${item.notes} ${item.status}`);
      return !query || haystack.includes(normalizeText(query));
    });
  }, [query, visibleSchedule]);
  const plannedDates = useMemo(() => getScheduleDates(formData), [formData]);

  useEffect(() => {
    if (calendarWeek !== 'all' && Number(calendarWeek) >= calendarWeeks.length) {
      setCalendarWeek('all');
    }
  }, [calendarWeek, calendarWeeks.length]);

  function getCalendarDayScheduled(day: number) {
    const dateKey = createDateKey(calendarYear, calendarMonth, day);
    const dayEntries = scheduleByDate.get(dateKey) ?? [];
    const entriesByTechnician = new Map<string, Schedule[]>();

    dayEntries.forEach((entry) => {
      entriesByTechnician.set(entry.technician_id, [...(entriesByTechnician.get(entry.technician_id) ?? []), entry]);
    });

    return sortedTechnicians.reduce(
      (scheduled, technician) => {
        const entry = getBestScheduleEntry(entriesByTechnician.get(technician.id) ?? []);

        if (!entry) {
          scheduled.push({ name: technician.name, entry: null });
          return scheduled;
        }

        if (entry.status !== 'cancelled') {
          scheduled.push({ name: technician.name, entry });
        }

        return scheduled;
      },
      [] as Array<{ name: string; entry: Schedule | null }>,
    );
  }

  function resetForm() {
    setFormData(createInitialFormData());
    setFormError('');
  }

  function handleFormDialogChange(open: boolean) {
    setIsFormDialogOpen(open);

    if (!open) {
      resetForm();
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');
    setIsSubmitting(true);

    if (!formData.technician_id) {
      setFormError('Selecione um prestador.');
      setIsSubmitting(false);
      return;
    }

    if (!plannedDates.length) {
      setFormError('Nenhuma data encontrada para o padrão selecionado.');
      setIsSubmitting(false);
      return;
    }

    try {
      const selectedTechnician = sortedTechnicians.find((technician) => technician.id === formData.technician_id);
      const createdSchedules: Schedule[] = [];

      for (const date of plannedDates) {
        const response = await fetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            technician_id: formData.technician_id,
            date,
            start_time: formData.status === 'cancelled' ? DEFAULT_START_TIME : formData.start_time,
            end_time: formData.status === 'cancelled' ? DEFAULT_END_TIME : formData.end_time,
            status: formData.status,
            notes: formData.notes || (formData.status === 'cancelled' ? 'Folga planejada' : 'Escala em exceção'),
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || 'Nao foi possivel salvar a escala.');
        }

        const created = (await response.json()) as Schedule;
        createdSchedules.push({
          ...created,
          technician_name: created.technician_name || selectedTechnician?.name || formData.technician_id,
        });
      }

      setSchedule((current) => [...createdSchedules.reverse(), ...current]);
      handleFormDialogChange(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Nao foi possivel salvar a escala.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading || !user) {
    return <LoadingState />;
  }

  const today = new Date();
  const todayKey = createDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const todayEntries = scheduleByDate.get(todayKey) ?? [];
  const workingToday = sortedTechnicians.filter((technician) => {
    const entry = getBestScheduleEntry(todayEntries.filter((item) => item.technician_id === technician.id));
    return !entry || entry.status !== 'cancelled';
  }).length;
  const manualShifts = filteredSchedule.filter((item) => item.status !== 'cancelled').length;
  const dayOff = filteredSchedule.filter((item) => item.status === 'cancelled').length;

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Planejamento"
        title="Agenda e escala"
        description="Controle o planejado: turnos, folgas, disponibilidade e conflitos antes de comparar com horas realizadas."
      >
        <Button type="button" onClick={() => setIsFormDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Lançar folga
        </Button>
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard title="Trabalham hoje" value={workingToday} hint="Escala padrão" icon={CalendarDays} />
        <MetricCard title="Exceções" value={manualShifts} hint="Turnos lançados" icon={Clock3} tone="success" />
        <MetricCard title="Folgas" value={dayOff} hint="Folgas planejadas" icon={CalendarDays} tone="warning" />
        <MetricCard title="Técnicos" value={visibleTechnicians.length} hint="Na visão da escala" icon={Users} />
      </div>

      <Dialog open={isFormDialogOpen} onOpenChange={handleFormDialogChange}>
        <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-4xl">
          <div className="flex max-h-[88vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Lançar folga ou exceção</DialogTitle>
              <DialogDescription className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Por padrão, o sistema considera que todos trabalham. Use este cadastro para lançar folgas, faltas ou exceções de escala.
              </DialogDescription>
            </DialogHeader>

            <form id="schedule-form" onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-7">
              {formError ? <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{formError}</div> : null}

              <div className="grid gap-5 lg:grid-cols-[1fr_0.95fr]">
                <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                  <div className="mb-5 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Folga mensal</p>
                    <h3 className="text-base font-semibold text-foreground">Prestador e período</h3>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm md:col-span-2">
                      <span className="mb-1.5 block font-medium">Técnico</span>
                      <select
                        value={formData.technician_id}
                        onChange={(event) => setFormData((current) => ({ ...current, technician_id: event.target.value }))}
                        className={inputClassName}
                        required
                      >
                        <option value="">Selecione</option>
                        {sortedTechnicians.map((technician) => (
                          <option key={technician.id} value={technician.id}>
                            {technician.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Data ou mês</span>
                      <input
                        type="date"
                        value={formData.date}
                        onChange={(event) => setFormData((current) => ({ ...current, date: event.target.value }))}
                        className={inputClassName}
                        required
                      />
                    </label>

                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Aplicar em</span>
                      <select
                        value={formData.pattern}
                        onChange={(event) => setFormData((current) => ({ ...current, pattern: event.target.value as SchedulePattern }))}
                        className={inputClassName}
                      >
                        <option value="single">Apenas esta data</option>
                        <option value="all_sundays">Todos os domingos do mês</option>
                        <option value="alternate_saturdays">Sábados alternados</option>
                        <option value="alternate_weekends">Fim de semana alternado</option>
                      </select>
                    </label>

                    <label className="text-sm md:col-span-2">
                      <span className="mb-1.5 block font-medium">Lançamento</span>
                      <select
                        value={formData.status}
                        onChange={(event) => setFormData((current) => ({ ...current, status: event.target.value as Schedule['status'] }))}
                        className={inputClassName}
                      >
                        <option value="cancelled">Folga / indisponibilidade / falta</option>
                        <option value="scheduled">Escalado em exceção</option>
                        <option value="completed">Turno concluído</option>
                      </select>
                    </label>

                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm md:col-span-2">
                      <p className="font-semibold text-emerald-950">{plannedDates.length} lançamento(s) selecionado(s)</p>
                      <p className="mt-1 text-xs text-emerald-800">
                        {plannedDates.slice(0, 5).map(formatDate).join(', ')}
                        {plannedDates.length > 5 ? ` e mais ${plannedDates.length - 5}` : ''}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                  <div className="mb-5 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Detalhes</p>
                    <h3 className="text-base font-semibold text-foreground">Horário e observação</h3>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {formData.status !== 'cancelled' ? (
                      <>
                        <label className="text-sm">
                          <span className="mb-1.5 block font-medium">Entrada</span>
                          <input
                            type="time"
                            value={formData.start_time}
                            onChange={(event) => setFormData((current) => ({ ...current, start_time: event.target.value }))}
                            className={inputClassName}
                          />
                        </label>

                        <label className="text-sm">
                          <span className="mb-1.5 block font-medium">Saída</span>
                          <input
                            type="time"
                            value={formData.end_time}
                            onChange={(event) => setFormData((current) => ({ ...current, end_time: event.target.value }))}
                            className={inputClassName}
                          />
                        </label>
                      </>
                    ) : (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:col-span-2">
                        Folga lançada sem horário. O horário padrão continua sendo {formatTimeRange(DEFAULT_START_TIME, DEFAULT_END_TIME)} nos dias sem folga.
                      </div>
                    )}

                    <label className="text-sm md:col-span-2">
                      <span className="mb-1.5 block font-medium">Observação</span>
                      <textarea
                        value={formData.notes}
                        onChange={(event) => setFormData((current) => ({ ...current, notes: event.target.value }))}
                        placeholder="Ex.: folga mensal, falta, troca de plantão"
                        className="min-h-36 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
                      />
                    </label>
                  </div>
                </section>
              </div>
            </form>

            <DialogFooter className="border-t border-border/70 bg-background/95 px-6 py-4 sm:px-7">
              <Button type="button" variant="outline" onClick={() => handleFormDialogChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" form="schedule-form" disabled={isSubmitting} className="min-w-36">
                {isSubmitting ? 'Salvando...' : plannedDates.length > 1 ? `Salvar ${plannedDates.length} lançamentos` : formData.status === 'cancelled' ? 'Salvar folga' : 'Salvar exceção'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCalendarDialogOpen} onOpenChange={setIsCalendarDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-[1500px]">
          <div className="flex max-h-[92vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Calendário da escala</DialogTitle>
              <DialogDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Visualize por dia quem está escalado.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
              <div className="mb-5 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Semana</span>
                  <select value={calendarWeek} onChange={(event) => setCalendarWeek(event.target.value)} className={inputClassName}>
                    <option value="all">Todas</option>
                    {calendarWeeks.map((_, index) => (
                      <option key={index} value={index}>
                        Semana {index + 1}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Mês</span>
                  <select value={calendarMonth} onChange={(event) => setCalendarMonth(Number(event.target.value))} className={inputClassName}>
                    {monthNames.map((month, index) => (
                      <option key={month} value={index}>
                        {month}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Ano</span>
                  <select value={calendarYear} onChange={(event) => setCalendarYear(Number(event.target.value))} className={inputClassName}>
                    {calendarYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-end">
                  <div className="w-full rounded-xl border border-border bg-secondary/50 px-4 py-2.5 text-sm">
                    <p className="font-semibold text-foreground">{sortedTechnicians.length} prestadores</p>
                    <p className="text-xs text-muted-foreground">na visão do calendário</p>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <div className="min-w-[1180px]">
                  <div className="grid grid-cols-7 border-b border-border bg-slate-100 text-center text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">
                    {weekdayLabels.map((day) => (
                      <div key={day} className="px-3 py-3">
                        {day}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7">
                    {displayedCalendarWeeks.flatMap((week, weekIndex) =>
                      week.map((day, dayIndex) => {
                        if (!day) {
                          return <div key={`empty-${weekIndex}-${dayIndex}`} className="min-h-64 border-b border-r border-border bg-muted/20 last:border-r-0" />;
                        }

                        const scheduledForDay = getCalendarDayScheduled(day);

                        return (
                          <div key={`${calendarYear}-${calendarMonth}-${day}`} className="min-h-64 border-b border-r border-border bg-card p-3 last:border-r-0">
                            <div className="mb-3 flex items-start justify-between gap-2">
                              <div>
                                <p className="text-lg font-black text-foreground">{day}</p>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                  {scheduledForDay.length} escalado(s)
                                </p>
                              </div>
                              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">
                                {scheduledForDay.length}
                              </span>
                            </div>

                            <div className="max-h-52 overflow-y-auto pr-1">
                              {scheduledForDay.length ? (
                                <div className="space-y-1">
                                  {scheduledForDay.map(({ name, entry }) => (
                                    <div key={`${entry?.id ?? `default-${calendarYear}-${calendarMonth}-${day}-${name}`}`} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1">
                                      <p className="text-xs font-semibold text-emerald-950">{name}</p>
                                      <p className="text-[11px] text-emerald-700">
                                        {entry ? formatTimeRange(entry.start_time, entry.end_time) : formatTimeRange(DEFAULT_START_TIME, DEFAULT_END_TIME)}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">Ninguém escalado.</p>
                              )}
                            </div>
                          </div>
                        );
                      }),
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mt-5">
        <DataPanel
          title="Visão geral da escala"
          description="Matriz de todos os prestadores por dia, com folgas e turnos planejados."
          action={
            <Button type="button" variant="outline" onClick={() => setIsCalendarDialogOpen(true)}>
              <CalendarDays className="h-4 w-4" />
              Ver calendário
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <div className="min-w-225">
              <div className="grid grid-cols-[220px_repeat(7,1fr)] border-b border-border text-xs font-medium uppercase text-muted-foreground">
                <div className="py-2 pr-3">Técnico</div>
                {weekDates.map((date) => (
                  <div key={date} className="py-2 pr-3">
                    {formatDate(date)}
                  </div>
                ))}
              </div>
              {visibleTechnicians.slice(0, 8).map((technician) => {
                const entriesByDate = new Map<string, Schedule[]>();

                visibleSchedule
                  .filter((item) => item.technician_id === technician.id)
                  .forEach((item) => {
                    const dateKey = getDateKey(item.date);
                    entriesByDate.set(dateKey, [...(entriesByDate.get(dateKey) ?? []), item]);
                  });

                return (
                  <div key={technician.id} className="grid grid-cols-[220px_repeat(7,1fr)] border-b border-border last:border-0">
                    <div className="py-3 pr-3 text-sm font-medium">{technician.name}</div>
                    {weekDates.map((date) => {
                      const entry = getBestScheduleEntry(entriesByDate.get(date) ?? []);

                      return (
                        <div key={date} className="py-2 pr-3">
                          <div className="min-h-20 rounded-md border border-border bg-background p-2 text-xs">
                            {entry ? (
                              <>
                                <StatusBadge tone={entry.status === 'cancelled' ? 'warning' : entry.status === 'completed' ? 'success' : 'info'}>
                                  {getStatusLabel(entry.status)}
                                </StatusBadge>
                                <p className="mt-2 font-medium">
                                  {entry.status === 'cancelled' ? 'Dia de folga' : entry.start_time ? formatTimeRange(entry.start_time, entry.end_time) : 'Sem turno'}
                                </p>
                              </>
                            ) : (
                              <>
                                <StatusBadge tone="info">Trabalha</StatusBadge>
                                <p className="mt-2 font-medium">{formatTimeRange(DEFAULT_START_TIME, DEFAULT_END_TIME)}</p>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </DataPanel>
      </div>

      <div className="mt-5">
        <DataPanel
          title="Registros da escala"
          description={`${filteredSchedule.length} registro(s).`}
          action={
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" className="w-48 bg-transparent text-sm outline-none" />
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">Data</th>
                  <th className="py-3 pr-4 font-medium">Técnico</th>
                  <th className="py-3 pr-4 font-medium">Horário</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 font-medium">Obs.</th>
                </tr>
              </thead>
              <tbody>
                {filteredSchedule.slice(0, 60).map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4">{formatDate(item.date)}</td>
                    <td className="py-3 pr-4">{item.technician_name || item.technician_id}</td>
                    <td className="py-3 pr-4">{item.status === 'cancelled' ? 'Dia de folga' : formatTimeRange(item.start_time, item.end_time)}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge tone={item.status === 'cancelled' ? 'warning' : item.status === 'completed' ? 'success' : 'info'}>
                        {getStatusLabel(item.status)}
                      </StatusBadge>
                    </td>
                    <td className="py-3 text-muted-foreground">{item.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataPanel>
      </div>
    </AppShell>
  );
}
