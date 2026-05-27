'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock3, Search } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { demoPayroll, demoTechnicians, demoWorkHours } from '@/lib/demo-data';
import { formatDate, formatHours, formatTime, normalizeText } from '@/lib/formatters';
import type { WorkHours } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

const MONTHLY_HOURS_TARGET = 220;
const MONTHLY_HOURS_WARNING_FLOOR = 200;

export default function TechnicianHoursPage() {
  const { user, loading } = useAppSession();
  const [workHours, setWorkHours] = useState<WorkHours[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    async function loadHours() {
      if (!user) return;
      const technicianId = user.technicianId ?? user.userId;
      const response = await fetch(`/api/work-hours?technicianId=${technicianId}`);
      if (response.ok) {
        const data = await response.json();
        setWorkHours(data.workHours ?? []);
      }
    }

    loadHours();
  }, [user]);

  const fallbackTechnician = demoTechnicians[0];
  const visibleWorkHours = workHours.length ? workHours : demoWorkHours.filter((item) => item.technician_id === fallbackTechnician.id);
  const filteredWorkHours = useMemo(() => {
    return visibleWorkHours.filter((item) => {
      const haystack = normalizeText(`${item.date} ${item.week_number} ${item.month}`);
      return !query || haystack.includes(normalizeText(query));
    });
  }, [query, visibleWorkHours]);

  if (loading || !user) {
    return <LoadingState />;
  }

  const totalHours = filteredWorkHours.reduce((total, item) => total + Number(item.hours_worked), 0);
  const balance = totalHours - MONTHLY_HOURS_TARGET;
  const hoursTone = totalHours >= MONTHLY_HOURS_TARGET ? 'success' : totalHours >= MONTHLY_HOURS_WARNING_FLOOR ? 'warning' : 'danger';
  const balanceHint =
    balance >= 0
      ? `${formatHours(MONTHLY_HOURS_TARGET)} no total • ${formatHours(balance)} acima`
      : `${formatHours(MONTHLY_HOURS_TARGET)} no total • faltam ${formatHours(Math.abs(balance))}`;
  const payrollBalance = demoPayroll.find((item) => item.technician_id === fallbackTechnician.id)?.hour_bank_balance ?? balance;

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader eyebrow="Horas" title="Banco de horas" description="Horas realizadas, saldo diário e consolidado. Escala planejada e horas trabalhadas ficam separadas." />

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard title="Horas realizadas" value={formatHours(totalHours)} hint={`${filteredWorkHours.length} dia(s) no recorte`} icon={Clock3} tone={hoursTone} accentText />
        <MetricCard title="Horas totais" value={formatHours(MONTHLY_HOURS_TARGET)} hint="Meta fixa do mês" icon={Clock3} />
        <MetricCard title="Saldo do recorte" value={formatHours(balance)} hint={balanceHint} icon={Clock3} tone={hoursTone} accentText />
        <MetricCard title="Saldo acumulado" value={formatHours(payrollBalance)} hint="Conforme fechamento" icon={Clock3} tone={payrollBalance < 0 ? 'danger' : 'warning'} />
      </div>

      <div className="mt-5">
        <DataPanel
          title="Registro de horas"
          description="Importado da planilha de horas ou lancado no sistema."
          action={
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar semana" className="w-48 bg-transparent text-sm outline-none" />
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">Data</th>
                  <th className="py-3 pr-4 font-medium">Entrada</th>
                  <th className="py-3 pr-4 font-medium">Saída</th>
                  <th className="py-3 pr-4 font-medium">Trabalhadas</th>
                  <th className="py-3 pr-4 font-medium">Saldo dia</th>
                  <th className="py-3 font-medium">Semana</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkHours.map((item) => {
                  const dailyBalance = Number(item.hours_worked) - 8;

                  return (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4">{formatDate(item.date)}</td>
                      <td className="py-3 pr-4">{formatTime(item.start_time)}</td>
                      <td className="py-3 pr-4">{formatTime(item.end_time)}</td>
                      <td className="py-3 pr-4">{formatHours(item.hours_worked)}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge tone={dailyBalance < 0 ? 'danger' : dailyBalance > 0 ? 'success' : 'neutral'}>
                          {formatHours(dailyBalance)}
                        </StatusBadge>
                      </td>
                      <td className="py-3 text-muted-foreground">{item.week_number || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DataPanel>
      </div>
    </AppShell>
  );
}
