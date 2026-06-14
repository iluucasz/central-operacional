'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Landmark,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
  WalletCards,
  Wrench,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { useAppSession } from '@/hooks/use-app-session';
import { formatCurrency, formatNumber, normalizeText, resolveCompetenceMonth } from '@/lib/formatters';
import type { Payroll, Service, Technician } from '@/lib/types';

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

const shortMonthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const chartColors = ['#0f766e', '#2563eb', '#d97706', '#be123c', '#7c3aed', '#0891b2', '#65a30d', '#c2410c'];
const currentDate = new Date();
const currentYear = String(currentDate.getFullYear());
const currentMonth = `${currentYear}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

type MonthSummary = {
  monthKey: string;
  monthLabel: string;
  serviceRevenue: number;
  revenue: number;
  payrollCost: number;
  expenses: number;
  profit: number;
  margin: number;
  services: number;
  payrolls: number;
  employees: number;
};

type RawMonthSummary = Omit<MonthSummary, 'employees'> & {
  employeeIds: Set<string>;
};

type TechnicianFinancialSummary = {
  id: string;
  name: string;
  serviceCount: number;
  revenue: number;
  payrollCost: number;
  profit: number;
  margin: number;
};

type TypeRevenueSummary = {
  name: string;
  revenue: number;
  count: number;
};

function moneyValue(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundCurrency(value: number | string | null | undefined) {
  return Math.round((moneyValue(value) + Number.EPSILON) * 100) / 100;
}

function formatPercent(value: number | string | null | undefined) {
  return `${Number(value ?? 0).toLocaleString('pt-BR', {
    maximumFractionDigits: 1,
  })}%`;
}

function formatCompactCurrency(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  });
}

function formatChartCurrency(value: unknown) {
  return formatCurrency(Number(value ?? 0));
}

function formatChartPercent(value: unknown) {
  return formatPercent(Number(value ?? 0));
}

function formatCompetenceLabel(value: string) {
  const [year, month] = value.split('-');
  const monthNumber = Number(month);

  if (!year || !month || !monthNames[monthNumber - 1]) {
    return value || 'Sem competência';
  }

  return `${month.padStart(2, '0')}/${year} - ${monthNames[monthNumber - 1]}`;
}

function getServiceCompetence(service: Service) {
  return resolveCompetenceMonth(service.competence_month, service.date_performed);
}

function getPayrollCost(payroll: Payroll) {
  return roundCurrency(moneyValue(payroll.net_total) + moneyValue(payroll.va_deduction) + moneyValue(payroll.vr_deduction));
}

function calcMargin(profit: number, revenue: number) {
  return revenue > 0 ? roundCurrency((profit / revenue) * 100) : 0;
}

function createRawMonthSummary(monthKey: string): RawMonthSummary {
  const monthNumber = Number(monthKey.slice(5, 7));

  return {
    monthKey,
    monthLabel: shortMonthNames[monthNumber - 1] ?? monthKey,
    serviceRevenue: 0,
    revenue: 0,
    payrollCost: 0,
    expenses: 0,
    profit: 0,
    margin: 0,
    services: 0,
    payrolls: 0,
    employeeIds: new Set<string>(),
  };
}

function getMonthKeys(year: string) {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
}

function finalizeMonthSummary(raw: RawMonthSummary): MonthSummary {
  const revenue = roundCurrency(raw.serviceRevenue);
  const expenses = roundCurrency(raw.payrollCost);
  const profit = roundCurrency(revenue - expenses);

  return {
    ...raw,
    serviceRevenue: roundCurrency(raw.serviceRevenue),
    revenue,
    payrollCost: roundCurrency(raw.payrollCost),
    expenses,
    profit,
    margin: calcMargin(profit, revenue),
    employees: raw.employeeIds.size,
  };
}

function createEmptyMonth(monthKey: string): MonthSummary {
  return finalizeMonthSummary(createRawMonthSummary(monthKey));
}

function sumMonthlyData(rows: MonthSummary[]) {
  const revenue = roundCurrency(rows.reduce((total, row) => total + row.revenue, 0));
  const serviceRevenue = roundCurrency(rows.reduce((total, row) => total + row.serviceRevenue, 0));
  const payrollCost = roundCurrency(rows.reduce((total, row) => total + row.payrollCost, 0));
  const expenses = roundCurrency(rows.reduce((total, row) => total + row.expenses, 0));
  const profit = roundCurrency(revenue - expenses);

  return {
    revenue,
    serviceRevenue,
    payrollCost,
    expenses,
    profit,
    margin: calcMargin(profit, revenue),
    services: rows.reduce((total, row) => total + row.services, 0),
    payrolls: rows.reduce((total, row) => total + row.payrolls, 0),
  };
}

function getMetricTone(value: number): 'success' | 'danger' {
  return value >= 0 ? 'success' : 'danger';
}

export default function AdminFaturamentoPage() {
  const { user, loading } = useAppSession();
  const [services, setServices] = useState<Service[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [employeeQuery, setEmployeeQuery] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      const [servicesResult, payrollResult, techniciansResult] = await Promise.allSettled([
        fetch('/api/services'),
        fetch('/api/payroll'),
        fetch('/api/technicians'),
      ]);
      const errors: string[] = [];

      if (servicesResult.status === 'fulfilled' && servicesResult.value.ok) {
        const data = await servicesResult.value.json();
        if (mounted) setServices(Array.isArray(data.services) ? data.services : []);
      } else {
        errors.push('serviços');
        if (mounted) setServices([]);
      }

      if (payrollResult.status === 'fulfilled' && payrollResult.value.ok) {
        const data = await payrollResult.value.json();
        if (mounted) setPayroll(Array.isArray(data.payrolls) ? data.payrolls : []);
      } else {
        errors.push('folha');
        if (mounted) setPayroll([]);
      }

      if (techniciansResult.status === 'fulfilled' && techniciansResult.value.ok) {
        const data = await techniciansResult.value.json();
        if (mounted) setTechnicians(Array.isArray(data.technicians) ? data.technicians : []);
      } else {
        errors.push('funcionários');
        if (mounted) setTechnicians([]);
      }

      if (mounted) {
        setDataError(errors.length ? `Não foi possível carregar dados de ${errors.join(', ')}.` : '');
        setIsDataLoading(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [user]);

  const activeTechnicianIds = useMemo(
    () => new Set(technicians.filter((technician) => technician.status === 'active').map((technician) => technician.id)),
    [technicians],
  );
  const activeServices = useMemo(
    () => services.filter((service) => activeTechnicianIds.has(service.technician_id)),
    [activeTechnicianIds, services],
  );
  const activePayroll = useMemo(
    () => payroll.filter((item) => activeTechnicianIds.has(item.technician_id)),
    [activeTechnicianIds, payroll],
  );

  const yearOptions = useMemo(() => {
    const values = new Set<string>([currentYear]);

    activeServices.forEach((service) => {
      const competence = getServiceCompetence(service);
      if (/^\d{4}-\d{2}$/.test(competence)) values.add(competence.slice(0, 4));
    });

    activePayroll.forEach((item) => {
      if (/^\d{4}-\d{2}$/.test(item.competence_month)) values.add(item.competence_month.slice(0, 4));
    });

    return Array.from(values).sort((left, right) => right.localeCompare(left, 'pt-BR'));
  }, [activePayroll, activeServices]);

  useEffect(() => {
    if (!yearOptions.includes(selectedYear)) {
      setSelectedYear(yearOptions[0] ?? currentYear);
    }
  }, [selectedYear, yearOptions]);

  useEffect(() => {
    if (!selectedMonth.startsWith(`${selectedYear}-`)) {
      setSelectedMonth(selectedYear === currentYear ? currentMonth : `${selectedYear}-12`);
    }
  }, [selectedMonth, selectedYear]);

  const technicianNameMap = useMemo(() => {
    return new Map(technicians.map((technician) => [technician.id, technician.name]));
  }, [technicians]);

  const monthlyData = useMemo(() => {
    const months = new Map(getMonthKeys(selectedYear).map((monthKey) => [monthKey, createRawMonthSummary(monthKey)]));

    activeServices.forEach((service) => {
      const competence = getServiceCompetence(service);
      const summary = months.get(competence);
      if (!summary) return;

      summary.serviceRevenue += moneyValue(service.value);
      summary.services += 1;
      if (service.technician_id) summary.employeeIds.add(service.technician_id);
    });

    activePayroll.forEach((item) => {
      const summary = months.get(item.competence_month);
      if (!summary) return;

      summary.payrollCost += getPayrollCost(item);
      summary.payrolls += 1;
      if (item.technician_id) summary.employeeIds.add(item.technician_id);
    });

    return Array.from(months.values()).map(finalizeMonthSummary);
  }, [activePayroll, activeServices, selectedYear]);

  const selectedMonthData = monthlyData.find((row) => row.monthKey === selectedMonth) ?? createEmptyMonth(selectedMonth);
  const annualData = useMemo(() => sumMonthlyData(monthlyData), [monthlyData]);

  const servicesInMonth = useMemo(
    () => activeServices.filter((service) => getServiceCompetence(service) === selectedMonth),
    [activeServices, selectedMonth],
  );

  const payrollInMonth = useMemo(
    () => activePayroll.filter((item) => item.competence_month === selectedMonth),
    [activePayroll, selectedMonth],
  );

  const typeRevenueData = useMemo<TypeRevenueSummary[]>(() => {
    const groups = new Map<string, TypeRevenueSummary>();

    servicesInMonth.forEach((service) => {
      const key = service.service_type || 'Sem tipo';
      const current = groups.get(key) ?? { name: key, revenue: 0, count: 0 };
      current.revenue = roundCurrency(current.revenue + moneyValue(service.value));
      current.count += 1;
      groups.set(key, current);
    });

    return Array.from(groups.values())
      .sort((left, right) => right.revenue - left.revenue)
      .slice(0, 8);
  }, [servicesInMonth]);

  const technicianRows = useMemo<TechnicianFinancialSummary[]>(() => {
    const rows = new Map<string, TechnicianFinancialSummary>();

    function getRow(id: string, fallbackName: string) {
      const row = rows.get(id) ?? {
        id,
        name: technicianNameMap.get(id) || fallbackName || 'Funcionário sem nome',
        serviceCount: 0,
        revenue: 0,
        payrollCost: 0,
        profit: 0,
        margin: 0,
      };
      rows.set(id, row);
      return row;
    }

    servicesInMonth.forEach((service) => {
      const id = service.technician_id || normalizeText(service.technician_name || 'sem-funcionario');
      const row = getRow(id, service.technician_name || service.technician_id);
      row.serviceCount += 1;
      row.revenue = roundCurrency(row.revenue + moneyValue(service.value));
    });

    payrollInMonth.forEach((item) => {
      const row = getRow(item.technician_id, technicianNameMap.get(item.technician_id) || item.technician_id);
      row.payrollCost = roundCurrency(row.payrollCost + getPayrollCost(item));
    });

    return Array.from(rows.values())
      .map((row) => ({
        ...row,
        profit: roundCurrency(row.revenue - row.payrollCost),
        margin: calcMargin(row.revenue - row.payrollCost, row.revenue),
      }))
      .filter((row) => {
        const haystack = normalizeText(`${row.name} ${row.id}`);
        return !employeeQuery || haystack.includes(normalizeText(employeeQuery));
      })
      .sort((left, right) => {
        if (right.revenue !== left.revenue) return right.revenue - left.revenue;
        return right.payrollCost - left.payrollCost;
      });
  }, [employeeQuery, payrollInMonth, servicesInMonth, technicianNameMap]);

  const costComposition = useMemo(() => {
    return [
      { name: 'Folha', value: selectedMonthData.payrollCost },
    ].filter((item) => item.value > 0);
  }, [selectedMonthData.payrollCost]);

  const revenueComposition = useMemo(() => {
    return [
      { name: 'Serviços', value: selectedMonthData.serviceRevenue },
    ].filter((item) => item.value > 0);
  }, [selectedMonthData.serviceRevenue]);

  const payrollShare = selectedMonthData.revenue > 0 ? (selectedMonthData.payrollCost / selectedMonthData.revenue) * 100 : 0;
  const expenseShare = selectedMonthData.revenue > 0 ? (selectedMonthData.expenses / selectedMonthData.revenue) * 100 : 0;
  const monthlyAverageTicket = selectedMonthData.services > 0 ? selectedMonthData.serviceRevenue / selectedMonthData.services : 0;
  const annualAverageTicket = annualData.services > 0 ? annualData.serviceRevenue / annualData.services : 0;
  const hasAnyData = activeServices.length || activePayroll.length;

  if (loading || isDataLoading || !user) {
    return <LoadingState />;
  }

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Dashboard gerencial"
        title="Faturamento"
        description="Faturamento de serviços, custo de folha e lucro por mês e por ano."
      >
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="info">{formatCompetenceLabel(selectedMonth)}</StatusBadge>
          <StatusBadge tone={annualData.profit >= 0 ? 'success' : 'danger'}>Ano {selectedYear}</StatusBadge>
        </div>
      </PageHeader>

      {dataError ? <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{dataError}</div> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard title="Faturamento mensal" value={formatCurrency(selectedMonthData.revenue)} hint="Receita de serviços" icon={TrendingUp} tone="success" />
        <MetricCard
          title="Lucro mensal"
          value={formatCurrency(selectedMonthData.profit)}
          hint={`Margem ${formatPercent(selectedMonthData.margin)}`}
          icon={Landmark}
          tone={getMetricTone(selectedMonthData.profit)}
          accentText
        />
        <MetricCard title="Faturamento anual" value={formatCurrency(annualData.revenue)} hint={`${formatNumber(annualData.services)} OS no ano`} icon={CalendarDays} />
        <MetricCard
          title="Lucro anual"
          value={formatCurrency(annualData.profit)}
          hint={`Margem ${formatPercent(annualData.margin)}`}
          icon={TrendingUp}
          tone={getMetricTone(annualData.profit)}
          accentText
        />
        <MetricCard title="Custo da folha" value={formatCurrency(selectedMonthData.payrollCost)} hint={`${formatNumber(selectedMonthData.payrolls)} fechamento(s)`} icon={WalletCards} tone="warning" />
        <MetricCard title="Ticket médio" value={formatCurrency(monthlyAverageTicket)} hint={`Ano: ${formatCurrency(annualAverageTicket)}`} icon={Wrench} />
      </div>

      <div className="mt-5">
        <DataPanel title="Período de análise" description="Escolha o ano para os gráficos e o mês para os rankings e composições.">
          <div className="grid gap-3 md:grid-cols-[minmax(0,0.55fr)_minmax(0,0.7fr)_1fr] md:items-end">
            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Ano</span>
              <select
                value={selectedYear}
                onChange={(event) => {
                  const year = event.target.value;
                  setSelectedYear(year);
                  setSelectedMonth(year === currentYear ? currentMonth : `${year}-12`);
                }}
                className="min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Mês</span>
              <select
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              >
                {getMonthKeys(selectedYear).map((monthKey, index) => (
                  <option key={monthKey} value={monthKey}>
                    {String(index + 1).padStart(2, '0')}/{selectedYear} - {monthNames[index]}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase text-muted-foreground">Folha / receita</p>
                <p className="mt-1 text-base font-semibold">{formatPercent(payrollShare)}</p>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase text-muted-foreground">Custos / receita</p>
                <p className="mt-1 text-base font-semibold">{formatPercent(expenseShare)}</p>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase text-muted-foreground">Funcionários no mês</p>
                <p className="mt-1 text-base font-semibold">{formatNumber(selectedMonthData.employees)}</p>
              </div>
            </div>
          </div>
        </DataPanel>
      </div>

      {!hasAnyData ? (
        <div className="mt-5">
          <EmptyState icon={AlertTriangle} title="Sem dados financeiros" description="O dashboard aparece conforme houver OS e folha cadastradas." />
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
        <DataPanel title="Evolução mensal" description="Faturamento, custos e lucro do ano selecionado.">
          <div className="h-86">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyData} margin={{ left: -10, right: 12, top: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={formatCompactCurrency} />
                <Tooltip formatter={(value) => formatChartCurrency(value)} />
                <Legend />
                <Bar dataKey="revenue" name="Faturamento" fill="#0f766e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Custos" fill="#d97706" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="profit" name="Lucro" stroke="#2563eb" strokeWidth={3} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </DataPanel>

        <DataPanel title="Composição do mês" description="Origem do faturamento e custo de folha da competência.">
          <div className="grid gap-4">
            <div>
              <p className="mb-2 text-sm font-medium">Faturamento</p>
              {revenueComposition.length ? (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip formatter={(value) => formatChartCurrency(value)} />
                      <Pie data={revenueComposition} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={3}>
                        {revenueComposition.map((_, index) => (
                          <Cell key={`revenue-${index}`} fill={chartColors[index % chartColors.length]} />
                        ))}
                      </Pie>
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState icon={TrendingUp} title="Sem faturamento no mês" />
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Custos</p>
              {costComposition.length ? (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip formatter={(value) => formatChartCurrency(value)} />
                      <Pie data={costComposition} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={3}>
                        {costComposition.map((_, index) => (
                          <Cell key={`cost-${index}`} fill={chartColors[(index + 2) % chartColors.length]} />
                        ))}
                      </Pie>
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState icon={TrendingDown} title="Sem custos no mês" />
              )}
            </div>
          </div>
        </DataPanel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <DataPanel title="Margem de lucro" description="Percentual de lucro sobre o faturamento mensal.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData} margin={{ left: -18, right: 12, top: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `${value}%`} />
                <Tooltip formatter={(value) => formatChartPercent(value)} />
                <Line type="monotone" dataKey="margin" name="Margem" stroke="#7c3aed" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </DataPanel>

        <DataPanel title="Faturamento por tipo de serviço" description={`Top tipos em ${formatCompetenceLabel(selectedMonth)}.`}>
          {typeRevenueData.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={typeRevenueData} layout="vertical" margin={{ left: 18, right: 16, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatCompactCurrency} />
                  <YAxis dataKey="name" type="category" width={112} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatChartCurrency(value)} />
                  <Bar dataKey="revenue" name="Faturamento" radius={[0, 4, 4, 0]}>
                    {typeRevenueData.map((_, index) => (
                      <Cell key={`type-${index}`} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={Wrench} title="Sem serviços no mês" description="Não há OS para agrupar por tipo nesta competência." />
          )}
        </DataPanel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_0.75fr]">
        <DataPanel
          title="Resultado por funcionário"
          description="Faturamento gerado, custo de folha e lucro bruto no mês selecionado."
          action={
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={employeeQuery}
                onChange={(event) => setEmployeeQuery(event.target.value)}
                placeholder="Buscar funcionário"
                className="w-48 bg-transparent text-sm outline-none"
              />
            </div>
          }
        >
          {technicianRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Funcionário</th>
                    <th className="py-3 pr-4 font-medium">OS</th>
                    <th className="py-3 pr-4 font-medium">Faturamento</th>
                    <th className="py-3 pr-4 font-medium">Folha</th>
                    <th className="py-3 pr-4 font-medium">Lucro bruto</th>
                    <th className="py-3 font-medium">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {technicianRows.slice(0, 12).map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4 font-medium">{row.name}</td>
                      <td className="py-3 pr-4">{formatNumber(row.serviceCount)}</td>
                      <td className="py-3 pr-4 text-emerald-700">{formatCurrency(row.revenue)}</td>
                      <td className="py-3 pr-4 text-amber-700">{formatCurrency(row.payrollCost)}</td>
                      <td className={`py-3 pr-4 font-semibold ${row.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatCurrency(row.profit)}</td>
                      <td className="py-3">
                        <StatusBadge tone={row.margin >= 0 ? 'success' : 'danger'}>{formatPercent(row.margin)}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Users} title="Sem funcionários no recorte" description="Não há OS ou folha no mês selecionado para montar o ranking." />
          )}
        </DataPanel>

        <DataPanel title="Leitura rápida" description="Indicadores gerenciais da competência.">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background p-3">
              <span className="text-muted-foreground">Receita de serviços</span>
              <strong>{formatCurrency(selectedMonthData.serviceRevenue)}</strong>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background p-3">
              <span className="text-muted-foreground">Custo de folha</span>
              <strong>{formatCurrency(selectedMonthData.payrollCost)}</strong>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background p-3">
              <span className="text-muted-foreground">OS lançadas</span>
              <strong>{formatNumber(selectedMonthData.services)}</strong>
            </div>
          </div>
        </DataPanel>
      </div>
    </AppShell>
  );
}
