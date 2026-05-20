'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, FileSpreadsheet, Users, WalletCards, Wrench } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { demoPayroll, demoSchedule, demoServices, demoTechnicians, demoWorkHours } from '@/lib/demo-data';
import { formatCurrency, formatHours, formatNumber } from '@/lib/formatters';
import type { Payroll, Schedule, Service, Technician, WorkHours } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

const DEFAULT_BASE_SALARY = 2664;
const DEFAULT_VA_ALLOWANCE = 249;
const DEFAULT_VR_ALLOWANCE = 699.6;

export default function AdminDashboard() {
  const { user, loading } = useAppSession();
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [workHours, setWorkHours] = useState<WorkHours[]>([]);
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);

  useEffect(() => {
    async function loadData() {
      if (!user) return;

      const [techniciansRes, servicesRes, hoursRes, scheduleRes, payrollRes] = await Promise.allSettled([
        fetch('/api/technicians'),
        fetch('/api/services'),
        fetch('/api/work-hours'),
        fetch('/api/schedule'),
        fetch('/api/payroll'),
      ]);

      if (techniciansRes.status === 'fulfilled' && techniciansRes.value.ok) {
        const data = await techniciansRes.value.json();
        setTechnicians(data.technicians ?? []);
      }

      if (servicesRes.status === 'fulfilled' && servicesRes.value.ok) {
        const data = await servicesRes.value.json();
        setServices(data.services ?? []);
      }

      if (hoursRes.status === 'fulfilled' && hoursRes.value.ok) {
        const data = await hoursRes.value.json();
        setWorkHours(data.workHours ?? []);
      }

      if (scheduleRes.status === 'fulfilled' && scheduleRes.value.ok) {
        const data = await scheduleRes.value.json();
        setSchedule(data.schedules ?? []);
      }

      if (payrollRes.status === 'fulfilled' && payrollRes.value.ok) {
        const data = await payrollRes.value.json();
        setPayroll(data.payrolls ?? []);
      }
    }

    loadData();
  }, [user]);

  const visibleTechnicians = technicians.length ? technicians : demoTechnicians;
  const visibleServices = services.length ? services : demoServices;
  const visibleWorkHours = workHours.length ? workHours : demoWorkHours;
  const visibleSchedule = schedule.length ? schedule : demoSchedule;
  const visiblePayroll = payroll.length ? payroll : demoPayroll;
  const usingDemoData = !technicians.length && !services.length;

  const productionByTechnician = useMemo(() => {
    return visibleTechnicians.map((technician) => {
      const technicianServices = visibleServices.filter((service) => service.technician_id === technician.id);
      const totalValue = technicianServices.reduce((total, service) => total + Number(service.value), 0);
      const fixedCompensation =
        (Number(technician.base_salary) > 0 ? Number(technician.base_salary) : DEFAULT_BASE_SALARY) +
        (Number(technician.va_allowance) > 0 ? Number(technician.va_allowance) : DEFAULT_VA_ALLOWANCE) +
        (Number(technician.vr_allowance) > 0 ? Number(technician.vr_allowance) : DEFAULT_VR_ALLOWANCE);
      const commissionPercentage = Number(technician.commission_percentage) > 0 ? Number(technician.commission_percentage) : 25;

      return {
        technician,
        services: technicianServices.length,
        totalValue,
        commission: Math.max(0, (totalValue * commissionPercentage) / 100 - fixedCompensation),
      };
    });
  }, [visibleServices, visibleTechnicians]);

  if (loading || !user) {
    return <LoadingState />;
  }

  const activeTechnicians = visibleTechnicians.filter((technician) => technician.status === 'active').length;
  const totalServicesValue = visibleServices.reduce((total, service) => total + Number(service.value), 0);
  const payrollTotal = visiblePayroll.reduce((total, item) => total + Number(item.net_total), 0);
  const totalHours = visibleWorkHours.reduce((total, item) => total + Number(item.hours_worked), 0);
  const dayOffCount = visibleSchedule.filter((item) => item.status === 'cancelled').length;
  const pendingClosures = visibleTechnicians.filter((technician) => {
    return !visiblePayroll.some((item) => item.technician_id === technician.id);
  }).length;

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Painel administrativo"
        title="Central operacional"
        description="Visão consolidada de produção, folha, horas e escala. A tela usa dados reais quando disponíveis e uma amostra do contexto quando o banco está vazio."
      >
        {usingDemoData ? <StatusBadge tone="warning">Amostra de contexto</StatusBadge> : <StatusBadge tone="success">Dados do banco</StatusBadge>}
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Técnicos ativos" value={`${activeTechnicians}/${visibleTechnicians.length}`} hint="Equipe operacional cadastrada" icon={Users} />
        <MetricCard title="OS no período" value={formatNumber(visibleServices.length)} hint={formatCurrency(totalServicesValue)} icon={Wrench} tone="success" />
        <MetricCard title="Folha estimada" value={formatCurrency(payrollTotal)} hint={`${visiblePayroll.length} fechamento(s)`} icon={WalletCards} />
        <MetricCard title="Banco de horas" value={formatHours(totalHours)} hint={`${dayOffCount} folga(s) planejadas`} icon={Clock3} tone="warning" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <DataPanel title="Produção por técnico" description="Volume de OS, valor bruto e comissão estimada por colaborador.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">Técnico</th>
                  <th className="py-3 pr-4 font-medium">QRA</th>
                  <th className="py-3 pr-4 font-medium">OS</th>
                  <th className="py-3 pr-4 font-medium">Bruto</th>
                  <th className="py-3 pr-4 font-medium">Comissão</th>
                  <th className="py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {productionByTechnician
                  .sort((a, b) => b.services - a.services)
                  .map(({ technician, services: count, totalValue, commission }) => (
                    <tr key={technician.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4 font-medium">{technician.name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{technician.qra || '-'}</td>
                      <td className="py-3 pr-4">{count}</td>
                      <td className="py-3 pr-4">{formatCurrency(totalValue)}</td>
                      <td className="py-3 pr-4">{formatCurrency(commission)}</td>
                      <td className="py-3">
                        <StatusBadge tone={technician.status === 'active' ? 'success' : 'neutral'}>
                          {technician.status === 'active' ? 'Ativo' : 'Inativo'}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </DataPanel>

        <DataPanel title="Checklist de fechamento" description="Pontos que precisam estar resolvidos antes de fechar a competência.">
          <div className="space-y-3">
            {[
              {
                icon: FileSpreadsheet,
                title: 'Importação validada',
                description: `${visibleServices.length} OS prontas para conciliação`,
                tone: 'success' as const,
              },
              {
                icon: Clock3,
                title: 'Banco de horas',
                description: 'Comparar escala prevista com horas realizadas',
                tone: 'warning' as const,
              },
              {
                icon: CalendarDays,
                title: 'Folgas na escala',
                description: `${dayOffCount} registros marcados como folga/cancelado`,
                tone: dayOffCount ? ('info' as const) : ('neutral' as const),
              },
              {
                icon: AlertTriangle,
                title: 'Fechamentos pendentes',
                description: `${pendingClosures} técnico(s) sem folha calculada`,
                tone: pendingClosures ? ('danger' as const) : ('success' as const),
              },
            ].map((item) => {
              const Icon = item.icon;

              return (
                <div key={item.title} className="flex gap-3 rounded-md border border-border bg-background p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{item.title}</p>
                      <StatusBadge tone={item.tone}>{item.tone === 'success' ? 'Ok' : 'Revisar'}</StatusBadge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </DataPanel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <DataPanel title="Fluxo recomendado" description="Ordem operacional para substituir as planilhas.">
          <ol className="space-y-3 text-sm">
            {['Importar planilhas da seguradora', 'Validar OS duplicadas e técnicos', 'Conferir horas realizadas', 'Fechar folha por competência'].map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </DataPanel>

        <DataPanel title="Alertas de escala" description="Planejado versus disponibilidade.">
          <div className="space-y-3 text-sm">
            {visibleSchedule.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                <div>
                  <p className="font-medium">{item.technician_name || 'Técnico'}</p>
                  <p className="text-xs text-muted-foreground">{item.notes || 'Sem observação'}</p>
                </div>
                <StatusBadge tone={item.status === 'scheduled' ? 'info' : item.status === 'completed' ? 'success' : 'warning'}>
                  {item.status === 'cancelled' ? 'Folga' : item.status === 'completed' ? 'Concluído' : 'Escalado'}
                </StatusBadge>
              </div>
            ))}
          </div>
        </DataPanel>

        <DataPanel title="Saúde da folha" description="Conferência rápida da competência atual.">
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span>Folhas calculadas</span>
                <span>{visiblePayroll.length}/{visibleTechnicians.length}</span>
              </div>
              <div className="h-2 rounded-full bg-secondary">
                <div
                  className="h-2 rounded-full bg-primary"
                  style={{ width: `${Math.min((visiblePayroll.length / Math.max(visibleTechnicians.length, 1)) * 100, 100)}%` }}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>O próximo passo é validar as regras do MODELO TESTE.xlsx contra uma competência real.</span>
            </div>
          </div>
        </DataPanel>
      </div>
    </AppShell>
  );
}
