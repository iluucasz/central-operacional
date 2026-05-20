'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, Clock3, FileText, Target, WalletCards, Wrench } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { ProgressGauge } from '@/components/progress-gauge';
import { StatusBadge } from '@/components/status-badge';
import { demoPayroll, demoSchedule, demoServices, demoTechnicians, demoWorkHours } from '@/lib/demo-data';
import { compactName, formatCurrency, formatDate, formatHours, formatNumber, yearFromCompetence } from '@/lib/formatters';
import type { Payroll, Schedule, Service, WorkHours } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

const chartColors = ['#168a65', '#d06b36', '#3e6fba', '#b48b17', '#914b8f', '#2f8fa1', '#6b7280'];

export default function TechnicianDashboard() {
  const { user, loading } = useAppSession();
  const [services, setServices] = useState<Service[]>([]);
  const [workHours, setWorkHours] = useState<WorkHours[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [yearFilter, setYearFilter] = useState<string | null>(null);
  const [competenceFilter, setCompetenceFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!user) return;
      const technicianId = user.technicianId ?? user.userId;

      const [servicesRes, hoursRes, payrollRes, scheduleRes] = await Promise.allSettled([
        fetch(`/api/services?technicianId=${technicianId}`),
        fetch(`/api/work-hours?technicianId=${technicianId}`),
        fetch(`/api/payroll?technicianId=${technicianId}`),
        fetch(`/api/schedule?technicianId=${technicianId}`),
      ]);

      if (servicesRes.status === 'fulfilled' && servicesRes.value.ok) {
        const data = await servicesRes.value.json();
        setServices(data.services ?? []);
      }

      if (hoursRes.status === 'fulfilled' && hoursRes.value.ok) {
        const data = await hoursRes.value.json();
        setWorkHours(data.workHours ?? []);
      }

      if (payrollRes.status === 'fulfilled' && payrollRes.value.ok) {
        const data = await payrollRes.value.json();
        setPayroll(data.payrolls ?? []);
      }

      if (scheduleRes.status === 'fulfilled' && scheduleRes.value.ok) {
        const data = await scheduleRes.value.json();
        setSchedule(data.schedules ?? []);
      }
    }

    loadData();
  }, [user]);

  const fallbackTechnician = demoTechnicians[0];
  const visibleServices = services.length ? services : demoServices.filter((service) => service.technician_id === fallbackTechnician.id);
  const visibleWorkHours = workHours.length ? workHours : demoWorkHours.filter((item) => item.technician_id === fallbackTechnician.id);
  const visiblePayroll = payroll.length ? payroll : demoPayroll.filter((item) => item.technician_id === fallbackTechnician.id);
  const visibleSchedule = schedule.length ? schedule : demoSchedule.filter((item) => item.technician_id === fallbackTechnician.id);
  const usingDemoData = !services.length;

  const scopedByYear = useMemo(() => {
    return visibleServices.filter((service) => !yearFilter || yearFromCompetence(service.competence_month) === yearFilter);
  }, [visibleServices, yearFilter]);

  const filteredServices = useMemo(() => {
    return scopedByYear.filter((service) => {
      if (competenceFilter && service.competence_month !== competenceFilter) return false;
      if (typeFilter && service.service_type !== typeFilter) return false;
      return true;
    });
  }, [competenceFilter, scopedByYear, typeFilter]);

  const servicesByType = useMemo(() => {
    const grouped = new Map<string, number>();
    scopedByYear.forEach((service) => grouped.set(service.service_type, (grouped.get(service.service_type) ?? 0) + 1));
    return Array.from(grouped.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [scopedByYear]);

  const servicesByCompetence = useMemo(() => {
    const grouped = new Map<string, number>();
    scopedByYear.forEach((service) => grouped.set(service.competence_month, (grouped.get(service.competence_month) ?? 0) + 1));
    return Array.from(grouped.entries()).map(([competence, count]) => ({ competence, count }));
  }, [scopedByYear]);

  if (loading || !user) {
    return <LoadingState />;
  }

  const payrollSummary = visiblePayroll[0];
  const serviceTotal = filteredServices.reduce((total, service) => total + Number(service.value), 0);
  const totalHours = visibleWorkHours.reduce((total, item) => total + Number(item.hours_worked), 0);
  const hourBank = Number(payrollSummary?.hour_bank_balance ?? 0);
  const years = Array.from(new Set(visibleServices.map((service) => yearFromCompetence(service.competence_month)))).sort();
  const competences = Array.from(new Set(scopedByYear.map((service) => service.competence_month)));
  const technicianName = user.name || fallbackTechnician.name;
  const netTotal = Number(payrollSummary?.net_total ?? 0);

  const breakdown = [
    { label: 'Salário base', value: Number(payrollSummary?.base_salary ?? fallbackTechnician.base_salary), sign: 'plus' },
    { label: 'Comissão', value: Number(payrollSummary?.commission_value ?? 0), sign: 'plus' },
    { label: 'Hora extra', value: Number(payrollSummary?.extra_hours_value ?? 0), sign: 'plus' },
    { label: 'VA', value: Number(payrollSummary?.va_deduction ?? fallbackTechnician.va_allowance), sign: 'plus' },
    { label: 'VR', value: Number(payrollSummary?.vr_deduction ?? fallbackTechnician.vr_allowance), sign: 'plus' },
    { label: 'Adiantamento', value: Number(payrollSummary?.advances_total ?? 0), sign: 'minus' },
    { label: 'Descontos', value: Number(payrollSummary?.discounts_total ?? 0), sign: 'minus' },
  ];

  return (
    <AppShell role={user.role} userName={technicianName || user.email}>
      <PageHeader
        eyebrow="Dashboard individual"
        title={technicianName}
        description="Produção, metas, pagamento, banco de horas e agenda em uma única visão."
      >
        {usingDemoData ? <StatusBadge tone="warning">Amostra</StatusBadge> : <StatusBadge tone="success">Dados atualizados</StatusBadge>}
      </PageHeader>

      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Total a receber" value={formatCurrency(netTotal)} hint="Conforme fechamento da competência" icon={WalletCards} tone="success" />
        <MetricCard title="Ordens" value={formatNumber(scopedByYear.length)} hint={`${filteredServices.length} no filtro atual`} icon={Wrench} />
        <MetricCard title="Valor bruto" value={formatCurrency(serviceTotal)} hint="No recorte atual" icon={FileText} />
        <MetricCard title="Banco de horas" value={formatHours(hourBank)} hint={`${formatHours(totalHours)} trabalhadas`} icon={Clock3} tone={hourBank < 0 ? 'danger' : 'warning'} />
        <MetricCard title="Proxima escala" value={visibleSchedule[0]?.start_time ?? 'Folga'} hint={visibleSchedule[0] ? formatDate(visibleSchedule[0].date) : 'Sem agenda'} icon={CalendarDays} />
      </div>

      <DataPanel title="Filtros de competência">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-xs font-semibold uppercase text-muted-foreground">Ano</span>
            <button
              type="button"
              onClick={() => {
                setYearFilter(null);
                setCompetenceFilter(null);
              }}
              className={`rounded-md border px-3 py-1.5 text-sm ${!yearFilter ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}
            >
              Todos
            </button>
            {years.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => {
                  setYearFilter(year);
                  setCompetenceFilter(null);
                }}
                className={`rounded-md border px-3 py-1.5 text-sm ${yearFilter === year ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}
              >
                {year}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-xs font-semibold uppercase text-muted-foreground">Competência</span>
            <button
              type="button"
              onClick={() => setCompetenceFilter(null)}
              className={`rounded-md border px-3 py-1.5 text-sm ${!competenceFilter ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}
            >
              Todas
            </button>
            {competences.map((competence) => (
              <button
                key={competence}
                type="button"
                onClick={() => setCompetenceFilter(competence)}
                className={`rounded-md border px-3 py-1.5 text-sm ${competenceFilter === competence ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}
              >
                {competence}
              </button>
            ))}
          </div>
        </div>
      </DataPanel>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <DataPanel title="Metas por competência" description="Meta 1: 80 OS. Meta 2: 160 OS. Clique em uma competência para filtrar.">
          <div className="grid gap-3 sm:grid-cols-2">
            <ProgressGauge
              title="Total no recorte"
              value={scopedByYear.length}
              max={Math.max(160, scopedByYear.length)}
              subtitle="OS no recorte"
              active={!competenceFilter}
              onClick={() => setCompetenceFilter(null)}
            />
            {servicesByCompetence.map((item) => (
              <ProgressGauge
                key={item.competence}
                title={item.competence}
                value={item.count}
                active={competenceFilter === item.competence}
                onClick={() => setCompetenceFilter(competenceFilter === item.competence ? null : item.competence)}
              />
            ))}
          </div>
        </DataPanel>

        <DataPanel title="Serviços por tipo" description="Clique em uma barra para refinar o recorte.">
          <div className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={servicesByType} margin={{ left: -24, right: 12 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={76} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} onClick={(data) => setTypeFilter(typeFilter === data.name ? null : data.name)}>
                    {servicesByType.map((_, index) => (
                      <Cell key={`bar-${index}`} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={servicesByType} dataKey="count" nameKey="name" innerRadius={46} outerRadius={78}>
                    {servicesByType.map((_, index) => (
                      <Cell key={`pie-${index}`} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          {typeFilter ? (
            <button type="button" onClick={() => setTypeFilter(null)} className="mt-3 rounded-md border border-border px-3 py-2 text-sm">
              Limpar filtro de tipo: {typeFilter}
            </button>
          ) : null}
        </DataPanel>
      </div>

      <div className="mt-5">
        <DataPanel title="Composição salarial" description="Composição do valor líquido exibido ao colaborador, sem detalhar premiação extraordinária.">
          <div className="space-y-3">
            {breakdown.map((item) => (
              <div key={item.label} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <span className={`text-sm font-semibold ${item.sign === 'minus' ? 'text-rose-600' : 'text-foreground'}`}>
                  {item.sign === 'minus' ? '-' : ''}
                  {formatCurrency(item.value)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-md bg-secondary p-3">
              <span className="font-semibold">Líquido a receber</span>
              <span className="text-lg font-semibold text-primary">{formatCurrency(netTotal)}</span>
            </div>
          </div>
        </DataPanel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <DataPanel title="Agenda curta" description="Próximos registros de escala e folga.">
          <div className="space-y-3">
            {visibleSchedule.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium">{formatDate(item.date)}</p>
                  <p className="text-xs text-muted-foreground">{item.start_time ? `${item.start_time} - ${item.end_time}` : item.notes}</p>
                </div>
                <StatusBadge tone={item.status === 'scheduled' ? 'info' : item.status === 'completed' ? 'success' : 'warning'}>
                  {item.status === 'cancelled' ? 'Folga' : item.status === 'completed' ? 'Concluído' : 'Escalado'}
                </StatusBadge>
              </div>
            ))}
          </div>
        </DataPanel>

        <DataPanel title="Resumo pessoal" description="Leitura rápida para o colaborador.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border bg-background p-3">
              <p className="text-xs text-muted-foreground">Nome exibido</p>
              <p className="mt-1 font-semibold">{compactName(technicianName)}</p>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <p className="text-xs text-muted-foreground">Tipo mais frequente</p>
              <p className="mt-1 font-semibold">{servicesByType[0]?.name ?? '-'}</p>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <p className="text-xs text-muted-foreground">Competências</p>
              <p className="mt-1 font-semibold">{competences.length}</p>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <p className="text-xs text-muted-foreground">Meta principal</p>
              <p className="mt-1 font-semibold">{scopedByYear.length >= 160 ? 'Meta 2 batida' : scopedByYear.length >= 80 ? 'Meta 1 batida' : 'Em andamento'}</p>
            </div>
          </div>
        </DataPanel>
      </div>
    </AppShell>
  );
}
