'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Clock3 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { demoSchedule, demoTechnicians } from '@/lib/demo-data';
import { formatDate } from '@/lib/formatters';
import type { Schedule } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

function getStatusLabel(status: Schedule['status']) {
  if (status === 'cancelled') return 'Folga';
  if (status === 'completed') return 'Concluído';
  return 'Escalado';
}

export default function TechnicianSchedulePage() {
  const { user, loading } = useAppSession();
  const [schedule, setSchedule] = useState<Schedule[]>([]);

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

  if (loading || !user) {
    return <LoadingState />;
  }

  const scheduled = visibleSchedule.filter((item) => item.status === 'scheduled').length;
  const dayOff = visibleSchedule.filter((item) => item.status === 'cancelled').length;

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader eyebrow="Agenda" title="Minha escala" description="Visualize turnos planejados, folgas e atendimentos concluídos." />

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard title="Próximas escalas" value={scheduled} hint="Turnos planejados" icon={CalendarDays} />
        <MetricCard title="Folgas" value={dayOff} hint="Folgas marcadas" icon={CalendarDays} tone="warning" />
        <MetricCard title="Próximo horário" value={visibleSchedule[0]?.start_time ?? 'Folga'} hint={visibleSchedule[0] ? formatDate(visibleSchedule[0].date) : 'Sem agenda'} icon={Clock3} />
      </div>

      <div className="mt-5">
        <DataPanel title="Calendário semanal" description="Escala planejada para os próximos dias.">
          <div className="grid gap-3 md:grid-cols-7">
            {visibleSchedule.slice(0, 7).map((item) => (
              <div key={item.id} className="rounded-md border border-border bg-background p-3">
                <p className="text-sm font-semibold">{formatDate(item.date)}</p>
                <div className="mt-3">
                  <StatusBadge tone={item.status === 'cancelled' ? 'warning' : item.status === 'completed' ? 'success' : 'info'}>
                    {getStatusLabel(item.status)}
                  </StatusBadge>
                </div>
                <p className="mt-3 text-sm">{item.start_time ? `${item.start_time} - ${item.end_time}` : item.notes}</p>
              </div>
            ))}
          </div>
        </DataPanel>
      </div>

      <div className="mt-5">
        <DataPanel title="Lista de escala" description="Histórico visível ao colaborador.">
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
                {visibleSchedule.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4">{formatDate(item.date)}</td>
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
