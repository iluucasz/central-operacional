'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, FileText, WalletCards, Wrench } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { ProgressGauge } from '@/components/progress-gauge';
import { StatusBadge } from '@/components/status-badge';
import { formatCurrency, formatDate, formatHours, formatNumber, formatTime, formatTimeRange, monthKeyFromDate } from '@/lib/formatters';
import type { Payroll, Schedule, Service, ServiceFortnight, WorkHours } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

const chartColors = ['#168a65', '#d06b36', '#3e6fba', '#b48b17', '#914b8f', '#2f8fa1', '#6b7280'];
const SERVICES_PAGE_SIZE = 12;
const defaultCompetenceMonth = new Date().toISOString().slice(0, 7);
const monthNames = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

type PeriodFilter = 'monthly' | ServiceFortnight;

const periodOptions: Array<{ value: PeriodFilter; label: string; description: string }> = [
  { value: 'monthly', label: 'Mensal', description: 'Todas as OS do mês' },
  { value: 'Q1', label: 'Q1', description: 'Primeira quinzena' },
  { value: 'Q2', label: 'Q2', description: 'Segunda quinzena' },
];

function moneyValue(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundCurrency(value: number | string | null | undefined) {
  return Math.round((moneyValue(value) + Number.EPSILON) * 100) / 100;
}

function getServiceCompetence(service: Service) {
  const datePrefix = String(service.date_performed ?? '').match(/^(\d{4}-\d{2})/);
  if (datePrefix?.[1]) return datePrefix[1];

  const dateMonth = monthKeyFromDate(service.date_performed);
  if (dateMonth) return dateMonth;

  const savedCompetence = String(service.competence_month ?? '').trim();
  return /^\d{4}-\d{2}$/.test(savedCompetence) ? savedCompetence : '';
}

function getDateDay(value: string | Date | null | undefined) {
  if (!value) return 0;

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return Number(value.slice(8, 10));
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getDate();
}

function getServicePeriod(service: Service): ServiceFortnight {
  if (service.fortnight_period === 'Q1' || service.fortnight_period === 'Q2') {
    return service.fortnight_period;
  }

  return getDateDay(service.date_performed) <= 15 ? 'Q1' : 'Q2';
}

function getDateKey(value: string | Date | null | undefined) {
  if (!value) return '';

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function getPeriodLabel(period: PeriodFilter) {
  return periodOptions.find((item) => item.value === period)?.label ?? 'Mensal';
}

function formatCompetence(value: string) {
  const [year, month] = value.split('-');
  const monthNumber = Number(month);

  if (!year || !month || !monthNames[monthNumber - 1]) {
    return value || 'Sem data';
  }

  return `${monthNames[monthNumber - 1]}/${year}`;
}

function matchesPeriod(dateValue: string | Date | null | undefined, period: PeriodFilter) {
  if (period === 'monthly') return true;
  return getDateDay(dateValue) <= 15 ? period === 'Q1' : period === 'Q2';
}

export default function TechnicianDashboard() {
  const { user, loading } = useAppSession();
  const [services, setServices] = useState<Service[]>([]);
  const [workHours, setWorkHours] = useState<WorkHours[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [competenceMonth, setCompetenceMonth] = useState(defaultCompetenceMonth);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('monthly');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [servicesPage, setServicesPage] = useState(1);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      const technicianId = user.technicianId ?? user.userId;
      const [servicesResult, hoursResult, payrollResult, scheduleResult] = await Promise.allSettled([
        fetch(`/api/services?technicianId=${technicianId}`),
        fetch(`/api/work-hours?technicianId=${technicianId}`),
        fetch(`/api/payroll?technicianId=${technicianId}`),
        fetch(`/api/schedule?technicianId=${technicianId}`),
      ]);
      const errors: string[] = [];

      if (servicesResult.status === 'fulfilled' && servicesResult.value.ok) {
        const data = await servicesResult.value.json();
        if (mounted) setServices(Array.isArray(data.services) ? data.services : []);
      } else {
        errors.push('OS');
        if (mounted) setServices([]);
      }

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

  const competenceOptions = useMemo(() => {
    const values = new Set<string>();

    services.forEach((service) => {
      const competence = getServiceCompetence(service);
      if (competence) values.add(competence);
    });

    workHours.forEach((item) => {
      const competence = monthKeyFromDate(item.date);
      if (competence) values.add(competence);
    });

    payroll.forEach((item) => {
      const competence = String(item.competence_month ?? '').trim();
      if (/^\d{4}-\d{2}$/.test(competence)) values.add(competence);
    });

    return Array.from(values).sort((left, right) => right.localeCompare(left, 'pt-BR'));
  }, [payroll, services, workHours]);

  useEffect(() => {
    if (!competenceOptions.length) return;
    if (!competenceOptions.includes(competenceMonth)) {
      setCompetenceMonth(competenceOptions[0]);
    }
  }, [competenceMonth, competenceOptions]);

  const monthlyServices = useMemo(
    () => services.filter((service) => getServiceCompetence(service) === competenceMonth),
    [competenceMonth, services],
  );

  const periodServices = useMemo(
    () => monthlyServices.filter((service) => periodFilter === 'monthly' || getServicePeriod(service) === periodFilter),
    [monthlyServices, periodFilter],
  );

  const servicesByType = useMemo(() => {
    const grouped = new Map<string, number>();

    periodServices.forEach((service) => {
      grouped.set(service.service_type, (grouped.get(service.service_type) ?? 0) + 1);
    });

    return Array.from(grouped.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count);
  }, [periodServices]);

  const filteredServices = useMemo(() => {
    return periodServices.filter((service) => !typeFilter || service.service_type === typeFilter);
  }, [periodServices, typeFilter]);

  const monthlyWorkHours = useMemo(
    () => workHours.filter((item) => monthKeyFromDate(item.date) === competenceMonth),
    [competenceMonth, workHours],
  );

  const periodWorkHours = useMemo(
    () => monthlyWorkHours.filter((item) => matchesPeriod(item.date, periodFilter)),
    [monthlyWorkHours, periodFilter],
  );

  const q1ServicesCount = monthlyServices.filter((service) => getServicePeriod(service) === 'Q1').length;
  const q2ServicesCount = monthlyServices.filter((service) => getServicePeriod(service) === 'Q2').length;
  const currentPayroll = payroll.find((item) => item.competence_month === competenceMonth);
  const nextSchedule = useMemo(() => {
    const todayKey = getDateKey(new Date());

    return schedule
      .filter((item) => item.status !== 'cancelled' && getDateKey(item.date) >= todayKey)
      .sort((left, right) => {
        const dateComparison = getDateKey(left.date).localeCompare(getDateKey(right.date));
        if (dateComparison !== 0) return dateComparison;
        return String(left.start_time ?? '').localeCompare(String(right.start_time ?? ''));
      })[0];
  }, [schedule]);

  const servicesPageCount = Math.max(Math.ceil(filteredServices.length / SERVICES_PAGE_SIZE), 1);
  const visibleServiceRows = useMemo(() => {
    const startIndex = (servicesPage - 1) * SERVICES_PAGE_SIZE;
    return filteredServices.slice(startIndex, startIndex + SERVICES_PAGE_SIZE);
  }, [filteredServices, servicesPage]);
  const servicesStartRange = filteredServices.length ? (servicesPage - 1) * SERVICES_PAGE_SIZE + 1 : 0;
  const servicesEndRange = Math.min(servicesPage * SERVICES_PAGE_SIZE, filteredServices.length);

  useEffect(() => {
    setServicesPage(1);
  }, [competenceMonth, filteredServices.length, periodFilter, typeFilter]);

  if (loading || isDataLoading || !user) {
    return <LoadingState />;
  }

  const technicianName = user.name || user.email;
  const payrollClosed = Boolean(currentPayroll);
  const netTotal = roundCurrency(currentPayroll?.net_total);
  const periodHours = periodWorkHours.reduce((total, item) => total + moneyValue(item.hours_worked), 0);
  const monthlyHourBalance = currentPayroll ? moneyValue(currentPayroll.hour_bank_balance) : monthlyWorkHours.reduce((total, item) => total + moneyValue(item.hours_worked), 0);
  const selectedPeriodLabel = getPeriodLabel(periodFilter);
  const nextScheduleTime = nextSchedule?.start_time ? formatTime(nextSchedule.start_time) : 'Sem escala';
  const nextScheduleHint = nextSchedule
    ? `${formatDate(nextSchedule.date)}${nextSchedule.end_time ? ` • ${formatTimeRange(nextSchedule.start_time, nextSchedule.end_time)}` : ''}`
    : 'Nenhum registro futuro';

  return (
    <AppShell role={user.role} userName={technicianName || user.email}>
      <PageHeader
        eyebrow="Dashboard individual"
        title={technicianName}
        description="Produção, pagamento, banco de horas e próxima escala com dados reais."
      >
        <StatusBadge tone={payrollClosed ? 'success' : 'warning'}>{payrollClosed ? 'Folha fechada' : 'Folha aguardando'}</StatusBadge>
      </PageHeader>

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Em conta"
          value={payrollClosed ? formatCurrency(netTotal) : 'Aguardando...'}
          hint={payrollClosed ? `Folha ${formatCompetence(competenceMonth)}` : 'Folha ainda não finalizada'}
          icon={WalletCards}
          tone={payrollClosed ? 'success' : 'warning'}
        />
        <MetricCard title="Ordens" value={formatNumber(filteredServices.length)} hint={`${selectedPeriodLabel} no recorte atual`} icon={Wrench} />
        <MetricCard
          title="Banco de horas"
          value={formatHours(periodFilter === 'monthly' ? monthlyHourBalance : periodHours)}
          hint={periodFilter === 'monthly' && payrollClosed ? 'Saldo da folha fechada' : 'Horas lançadas no recorte'}
          icon={Clock3}
          tone="warning"
          accentText
        />
        <MetricCard title="Próxima escala" value={nextScheduleTime} hint={nextScheduleHint} icon={CalendarDays} />
      </div>

      <div className="mb-5">
        <DataPanel title="Filtros" description="Escolha a data e o recorte que serão usados nos indicadores, metas e OS.">
          <div className="grid gap-4 lg:grid-cols-[minmax(16rem,0.5fr)_1fr]">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase text-muted-foreground">Data</span>
              <span className="flex h-12 items-center gap-3 rounded-md border border-border bg-background px-3">
                <CalendarDays className="h-4 w-4 text-primary" />
                <select
                  value={competenceMonth}
                  onChange={(event) => setCompetenceMonth(event.target.value)}
                  className="w-full bg-transparent text-sm font-semibold outline-none"
                >
                  {competenceOptions.length ? (
                    competenceOptions.map((competence) => (
                      <option key={competence} value={competence}>
                        {formatCompetence(competence)}
                      </option>
                    ))
                  ) : (
                    <option value={competenceMonth}>{formatCompetence(competenceMonth)}</option>
                  )}
                </select>
              </span>
            </label>

            <div>
              <span className="text-xs font-medium uppercase text-muted-foreground">Período</span>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {periodOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPeriodFilter(option.value)}
                    className={`rounded-md border px-3 py-2 text-left transition ${
                      periodFilter === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-secondary'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className={`mt-0.5 block text-xs ${periodFilter === option.value ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                      {option.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </DataPanel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <DataPanel title="Metas por competência" description="Meta 1: 80 OS. Meta 2: 160 OS. Clique em um card para mudar o período.">
          <div className="grid gap-3 sm:grid-cols-3">
            <ProgressGauge
              title="Mensal"
              value={monthlyServices.length}
              max={Math.max(160, monthlyServices.length)}
              subtitle="OS no mês"
              active={periodFilter === 'monthly'}
              celebrationLevel={monthlyServices.length >= 160 ? 'mega' : monthlyServices.length >= 80 ? 'goal' : undefined}
              onClick={() => setPeriodFilter('monthly')}
            />
            <ProgressGauge
              title="Q1"
              value={q1ServicesCount}
              max={Math.max(80, q1ServicesCount)}
              subtitle="OS no Q1"
              active={periodFilter === 'Q1'}
              celebrationLevel={q1ServicesCount >= 80 ? 'goal' : undefined}
              onClick={() => setPeriodFilter('Q1')}
            />
            <ProgressGauge
              title="Q2"
              value={q2ServicesCount}
              max={Math.max(80, q2ServicesCount)}
              subtitle="OS no Q2"
              active={periodFilter === 'Q2'}
              celebrationLevel={q2ServicesCount >= 80 ? 'goal' : undefined}
              onClick={() => setPeriodFilter('Q2')}
            />
          </div>
        </DataPanel>

        <DataPanel title="Serviços por tipo" description="Clique em uma barra para refinar o recorte.">
          {servicesByType.length ? (
            <>
              <div className="h-84">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={servicesByType} margin={{ left: -24, right: 12, bottom: 28 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={82} />
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
              {typeFilter ? (
                <button type="button" onClick={() => setTypeFilter(null)} className="mt-3 rounded-md border border-border px-3 py-2 text-sm">
                  Limpar filtro de tipo: {typeFilter}
                </button>
              ) : null}
            </>
          ) : (
            <EmptyState icon={Wrench} title="Sem tipos no recorte" description="Não há OS para agrupar nesse período." />
          )}
        </DataPanel>
      </div>

      <div className="mt-5">
        <DataPanel title="Serviços realizados" description="OS realizadas no recorte atual.">
          {filteredServices.length ? (
            <div className="overflow-hidden rounded-md border border-border">
              <div className="overflow-x-auto">
                <table className="w-full min-w-180 text-sm">
                  <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">OS</th>
                      <th className="px-4 py-3 text-left font-medium">Tipo</th>
                      <th className="px-4 py-3 text-left font-medium">Período</th>
                      <th className="px-4 py-3 text-left font-medium">Data</th>
                      <th className="px-4 py-3 text-left font-medium">Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleServiceRows.map((service) => (
                      <tr key={service.id} className="border-t border-border">
                        <td className="px-4 py-3 font-medium">{service.order_code}</td>
                        <td className="px-4 py-3 text-muted-foreground">{service.service_type}</td>
                        <td className="px-4 py-3">
                          <StatusBadge tone="info">{getServicePeriod(service)}</StatusBadge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(service.date_performed)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{service.time_performed ? formatTime(service.time_performed) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-border bg-card px-3 py-2 text-sm text-muted-foreground">
                <span>
                  {servicesStartRange} - {servicesEndRange} / {filteredServices.length}
                </span>
                <button
                  type="button"
                  onClick={() => setServicesPage((page) => Math.max(page - 1, 1))}
                  disabled={servicesPage === 1}
                  aria-label="Página anterior"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setServicesPage((page) => Math.min(page + 1, servicesPageCount))}
                  disabled={servicesPage === servicesPageCount}
                  aria-label="Próxima página"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          ) : (
            <EmptyState icon={FileText} title="Nenhuma OS no recorte" description="Altere a competência, período ou tipo para visualizar serviços reais." />
          )}
        </DataPanel>
      </div>
    </AppShell>
  );
}
