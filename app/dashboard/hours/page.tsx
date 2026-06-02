'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock3, Search } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { formatDate, formatHours, formatTime, formatTimeRange, normalizeText } from '@/lib/formatters';
import type { Payroll, Schedule, WorkHours } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

const MONTHLY_HOURS_TARGET = 220;
const MONTHLY_HOURS_WARNING_FLOOR = 200;

export default function TechnicianHoursPage() {
  const { user, loading } = useAppSession();
  const [workHours, setWorkHours] = useState<WorkHours[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      const technicianId = user.technicianId ?? user.userId;
      const [hoursResult, payrollResult, scheduleResult] = await Promise.allSettled([
        fetch(`/api/work-hours?technicianId=${technicianId}`),
        fetch(`/api/payroll?technicianId=${technicianId}`),
        fetch(`/api/schedule?technicianId=${technicianId}`),
      ]);
      const errors: string[] = [];

      if (hoursResult.status === 'fulfilled' && hoursResult.value.ok) {
        const data = await hoursResult.value.json();
        if (mounted) setWorkHours(Array.isArray(data.workHours) ? data.workHours : []);
      } else {
        errors.push('banco de horas');
        if (mounted) setWorkHours([]);
      }

      if (payrollResult.status === 'fulfilled' && payrollResult.value.ok) {
        const data = await payrollResult.value.json();
        if (mounted) setPayroll(Array.isArray(data.payrolls) ? data.payrolls : []);
      } else {
        errors.push('folha');
        if (mounted) setPayroll([]);
      }

      if (scheduleResult.status === 'fulfilled' && scheduleResult.value.ok) {
        const data = await scheduleResult.value.json();
        if (mounted) setSchedule(Array.isArray(data.schedules) ? data.schedules : []);
      } else {
        errors.push('escala');
        if (mounted) setSchedule([]);
      }

      if (mounted) {
        setDataError(errors.length ? `Não foi possível carregar dados reais de ${errors.join(', ')}.` : '');
        setIsDataLoading(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [user]);

  const filteredWorkHours = useMemo(() => {
    return workHours.filter((item) => {
      const haystack = normalizeText(`${item.date} ${item.week_number} ${item.month}`);
      return !query || haystack.includes(normalizeText(query));
    });
  }, [query, workHours]);

  if (loading || isDataLoading || !user) {
    return <LoadingState />;
  }

  const totalHours = filteredWorkHours.reduce((total, item) => total + Number(item.hours_worked), 0);
  const balance = totalHours - MONTHLY_HOURS_TARGET;
  const hoursTone = totalHours >= MONTHLY_HOURS_TARGET ? 'success' : totalHours >= MONTHLY_HOURS_WARNING_FLOOR ? 'warning' : 'danger';
  const balanceHint =
    balance >= 0
      ? `${formatHours(MONTHLY_HOURS_TARGET)} no total • ${formatHours(balance)} acima`
      : `${formatHours(MONTHLY_HOURS_TARGET)} no total • faltam ${formatHours(Math.abs(balance))}`;
  const latestPayroll = payroll[0];
  const payrollBalance = latestPayroll?.hour_bank_balance ?? balance;
  const payrollBalanceHint = latestPayroll ? 'Conforme fechamento mais recente' : 'Sem fechamento encontrado';
  const todayKey = new Date().toISOString().slice(0, 10);
  const nextScheduledShift =
    schedule.find((item) => item.status !== 'cancelled' && String(item.date ?? '').slice(0, 10) >= todayKey) ??
    schedule.find((item) => item.status !== 'cancelled');
  const hasPlannedSchedule = Boolean(nextScheduledShift);

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader eyebrow="Horas" title="Banco de horas" description="Horas realizadas, saldo diário e consolidado. Escala planejada e horas trabalhadas ficam separadas." />

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}
      {!filteredWorkHours.length && hasPlannedSchedule ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Há escala planejada para {formatDate(nextScheduledShift?.date)}{nextScheduledShift?.start_time ? ` • ${formatTimeRange(nextScheduledShift.start_time, nextScheduledShift.end_time)}` : ''}, mas ainda não existem horas lançadas em banco para este técnico.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard title="Horas realizadas" value={formatHours(totalHours)} hint={`${filteredWorkHours.length} dia(s) no recorte`} icon={Clock3} tone={hoursTone} accentText />
        <MetricCard title="Horas totais" value={formatHours(MONTHLY_HOURS_TARGET)} hint="Meta fixa do mês" icon={Clock3} />
        <MetricCard title="Saldo do recorte" value={formatHours(balance)} hint={balanceHint} icon={Clock3} tone={hoursTone} accentText />
        <MetricCard title="Saldo acumulado" value={formatHours(payrollBalance)} hint={payrollBalanceHint} icon={Clock3} tone={payrollBalance < 0 ? 'danger' : 'warning'} />
      </div>

      <div className="mt-5">
        <DataPanel
          title="Registro de horas"
          description="Importado da planilha de horas ou lançado no sistema. Escala planejada não gera horas automaticamente."
          action={
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar semana" className="w-48 bg-transparent text-sm outline-none" />
            </div>
          }
        >
          {filteredWorkHours.length ? (
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
          ) : (
            <EmptyState
              icon={Clock3}
              title="Nenhum registro de horas"
              description={query ? 'Ajuste a busca para encontrar registros reais.' : hasPlannedSchedule ? 'Existe escala planejada, mas ainda não há apontamentos reais em banco de horas para este técnico.' : 'Ainda não há horas lançadas para este técnico. Escala e banco de horas são controles separados.'}
            />
          )}
        </DataPanel>
      </div>
    </AppShell>
  );
}
