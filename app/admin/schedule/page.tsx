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
import { formatDate, normalizeText } from '@/lib/formatters';
import type { Schedule, Technician } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

const initialFormData = {
  technician_id: '',
  date: new Date().toISOString().split('T')[0],
  start_time: '08:00',
  end_time: '17:00',
  status: 'scheduled' as Schedule['status'],
  notes: '',
};

type ScheduleFormData = typeof initialFormData;

function createInitialFormData(): ScheduleFormData {
  return { ...initialFormData };
}

function getDateKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
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

  const visibleSchedule = schedule.length ? schedule : demoSchedule;
  const visibleTechnicians = technicians.length ? technicians : demoTechnicians.filter((technician) => technician.status === 'active');
  const sortedTechnicians = [...visibleTechnicians].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  const inputClassName = 'min-h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition focus:ring-2 focus:ring-ring';
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

    const response = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setFormError(data?.error || 'Nao foi possivel salvar a escala.');
      setIsSubmitting(false);
      return;
    }

    const created = (await response.json()) as Schedule;
    const selectedTechnician = sortedTechnicians.find((technician) => technician.id === formData.technician_id);

    setSchedule((current) => [
      {
        ...created,
        technician_name: created.technician_name || selectedTechnician?.name || formData.technician_id,
      },
      ...current,
    ]);
    handleFormDialogChange(false);
    setIsSubmitting(false);
  }

  if (loading || !user) {
    return <LoadingState />;
  }

  const scheduled = filteredSchedule.filter((item) => item.status === 'scheduled').length;
  const completed = filteredSchedule.filter((item) => item.status === 'completed').length;
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
          Nova escala
        </Button>
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard title="Escalados" value={scheduled} hint="Turnos futuros" icon={CalendarDays} />
        <MetricCard title="Concluídos" value={completed} hint="Turnos realizados" icon={Clock3} tone="success" />
        <MetricCard title="Folgas" value={dayOff} hint="Folgas planejadas" icon={CalendarDays} tone="warning" />
        <MetricCard title="Técnicos" value={visibleTechnicians.length} hint="Na visão da escala" icon={Users} />
      </div>

      <Dialog open={isFormDialogOpen} onOpenChange={handleFormDialogChange}>
        <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-4xl">
          <div className="flex max-h-[88vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Cadastrar escala</DialogTitle>
              <DialogDescription className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Escala planejada fica separada das horas realizadas.
              </DialogDescription>
            </DialogHeader>

            <form id="schedule-form" onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-7">
              {formError ? <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{formError}</div> : null}

              <div className="grid gap-5 lg:grid-cols-[1fr_0.95fr]">
                <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                  <div className="mb-5 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Planejamento</p>
                    <h3 className="text-base font-semibold text-foreground">Colaborador, dia e status</h3>
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
                      <span className="mb-1.5 block font-medium">Data</span>
                      <input
                        type="date"
                        value={formData.date}
                        onChange={(event) => setFormData((current) => ({ ...current, date: event.target.value }))}
                        className={inputClassName}
                        required
                      />
                    </label>

                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Status</span>
                      <select
                        value={formData.status}
                        onChange={(event) => setFormData((current) => ({ ...current, status: event.target.value as Schedule['status'] }))}
                        className={inputClassName}
                      >
                        <option value="scheduled">Escalado</option>
                        <option value="completed">Concluído</option>
                        <option value="cancelled">Folga/cancelado</option>
                      </select>
                    </label>
                  </div>
                </section>

                <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                  <div className="mb-5 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Turno</p>
                    <h3 className="text-base font-semibold text-foreground">Horário e observação</h3>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
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

                    <label className="text-sm md:col-span-2">
                      <span className="mb-1.5 block font-medium">Observação</span>
                      <textarea
                        value={formData.notes}
                        onChange={(event) => setFormData((current) => ({ ...current, notes: event.target.value }))}
                        className="min-h-28 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
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
                {isSubmitting ? 'Salvando...' : 'Salvar escala'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mt-5">
        <DataPanel title="Visão geral da escala" description="Matriz de todos os prestadores por dia, com folgas e turnos planejados.">
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
                const entriesByDate = new Map(
                  visibleSchedule
                    .filter((item) => item.technician_id === technician.id)
                    .map((item) => [getDateKey(item.date), item]),
                );

                return (
                  <div key={technician.id} className="grid grid-cols-[220px_repeat(7,1fr)] border-b border-border last:border-0">
                    <div className="py-3 pr-3 text-sm font-medium">{technician.name}</div>
                    {weekDates.map((date) => {
                      const entry = entriesByDate.get(date);

                      return (
                        <div key={date} className="py-2 pr-3">
                          <div className="min-h-20 rounded-md border border-border bg-background p-2 text-xs">
                            {entry ? (
                              <>
                                <StatusBadge tone={entry.status === 'cancelled' ? 'warning' : entry.status === 'completed' ? 'success' : 'info'}>
                                  {getStatusLabel(entry.status)}
                                </StatusBadge>
                                <p className="mt-2 font-medium">{entry.start_time ? `${entry.start_time} - ${entry.end_time}` : 'Sem turno'}</p>
                              </>
                            ) : (
                              <span className="text-muted-foreground">Sem escala</span>
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
                    <td className="py-3 pr-4">{item.start_time ? `${item.start_time} - ${item.end_time}` : '-'}</td>
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
