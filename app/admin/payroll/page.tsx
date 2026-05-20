'use client';

import { useEffect, useMemo, useState } from 'react';
import { Calculator, Search, Trophy, WalletCards } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { demoPayroll, demoServices, demoTechnicians } from '@/lib/demo-data';
import { formatCurrency, formatHours, normalizeText } from '@/lib/formatters';
import type { Payroll, Service, Technician } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

const DEFAULT_BASE_SALARY = 2664;
const DEFAULT_VA_ALLOWANCE = 249;
const DEFAULT_VR_ALLOWANCE = 699.6;

export default function PayrollPage() {
  const { user, loading } = useAppSession();
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [query, setQuery] = useState('');
  const [calculatingId, setCalculatingId] = useState('');
  const [competenceMonth, setCompetenceMonth] = useState(new Date().toISOString().slice(0, 7));

  useEffect(() => {
    async function loadData() {
      if (!user) return;
      const [payrollRes, techniciansRes, servicesRes] = await Promise.all([fetch('/api/payroll'), fetch('/api/technicians'), fetch('/api/services')]);

      if (payrollRes.ok) {
        const data = await payrollRes.json();
        setPayroll(data.payrolls ?? []);
      }

      if (techniciansRes.ok) {
        const data = await techniciansRes.json();
        setTechnicians(data.technicians ?? []);
      }

      if (servicesRes.ok) {
        const data = await servicesRes.json();
        setServices(data.services ?? []);
      }
    }

    loadData();
  }, [user]);

  const visiblePayroll = payroll.length ? payroll : demoPayroll;
  const visibleTechnicians = technicians.length ? technicians : demoTechnicians;
  const visibleServices = services.length ? services : demoServices;
  const payrollForMetrics = visiblePayroll.filter((item) => item.competence_month === competenceMonth);
  const metricPayroll = payrollForMetrics.length ? payrollForMetrics : visiblePayroll;

  const rows = useMemo(() => {
    return visibleTechnicians.map((technician) => {
      const payrollItem = visiblePayroll.find((item) => item.technician_id === technician.id && item.competence_month === competenceMonth);
      const technicianServices = visibleServices.filter((service) => service.technician_id === technician.id);
      const totalServices = technicianServices.reduce((total, service) => total + Number(service.value), 0);
      const baseSalary = Number(technician.base_salary) > 0 ? Number(technician.base_salary) : DEFAULT_BASE_SALARY;
      const vaAllowance = Number(technician.va_allowance) > 0 ? Number(technician.va_allowance) : DEFAULT_VA_ALLOWANCE;
      const vrAllowance = Number(technician.vr_allowance) > 0 ? Number(technician.vr_allowance) : DEFAULT_VR_ALLOWANCE;
      const fixedCompensation = baseSalary + vaAllowance + vrAllowance;
      const commissionPercentage = Number(technician.commission_percentage) > 0 ? Number(technician.commission_percentage) : 25;
      const targetCompensation = (totalServices * commissionPercentage) / 100;
      const estimatedCommission = Math.max(0, targetCompensation - fixedCompensation);
      const estimatedAward = technicianServices.length >= 160 ? 600 : technicianServices.length >= 80 ? 250 : 0;

      return {
        technician,
        totalServices,
        serviceCount: technicianServices.length,
        payroll: payrollItem,
        estimatedCommission,
        estimatedAward,
        estimatedNet: fixedCompensation + estimatedCommission + estimatedAward,
      };
    });
  }, [competenceMonth, visiblePayroll, visibleServices, visibleTechnicians]);

  const filteredRows = rows.filter((row) => {
    const haystack = normalizeText(`${row.technician.name} ${row.technician.qra}`);
    return !query || haystack.includes(normalizeText(query));
  });

  async function calculatePayroll(technicianId: string) {
    setCalculatingId(technicianId);
    const response = await fetch('/api/payroll/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ technicianId, competenceMonth }),
    });

    if (response.ok) {
      const data = await response.json();
      setPayroll((current) => [data.payroll, ...current.filter((item) => item.id !== data.payroll.id)]);
    }
    setCalculatingId('');
  }

  if (loading || !user) {
    return <LoadingState />;
  }

  const hasClosedMetricPayroll = payrollForMetrics.length > 0;
  const totalNet = hasClosedMetricPayroll
    ? metricPayroll.reduce((total, item) => total + Number(item.net_total), 0)
    : rows.reduce((total, row) => total + Number(row.estimatedNet), 0);
  const totalCommission = hasClosedMetricPayroll
    ? metricPayroll.reduce((total, item) => total + Number(item.commission_value), 0)
    : rows.reduce((total, row) => total + Number(row.estimatedCommission), 0);
  const totalAward = hasClosedMetricPayroll
    ? metricPayroll.reduce((total, item) => total + Number(item.extraordinary_award_value ?? 0), 0)
    : rows.reduce((total, row) => total + Number(row.estimatedAward), 0);
  const totalHourBank = metricPayroll.reduce((total, item) => total + Number(item.hour_bank_balance), 0);
  const closedCount = rows.filter((row) => row.payroll).length;

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Fechamento"
        title="Folha de pagamento"
        description="Resumo por competência com comissão, benefícios, descontos, banco de horas e líquido."
      >
        <label className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm">
          <span className="text-muted-foreground">Competência</span>
          <input
            type="month"
            value={competenceMonth}
            onChange={(event) => setCompetenceMonth(event.target.value)}
            className="bg-transparent font-medium outline-none"
          />
        </label>
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Líquido total" value={formatCurrency(totalNet)} hint="Soma dos fechamentos" icon={WalletCards} tone="success" />
        <MetricCard title="Comissões" value={formatCurrency(totalCommission)} hint="Sobre produção" icon={Calculator} />
        <MetricCard title="Extraordinário" value={formatCurrency(totalAward)} hint="Premiação por meta" icon={Trophy} tone="warning" />
        <MetricCard title="Banco de horas" value={formatHours(totalHourBank)} hint="Saldo consolidado" icon={Calculator} tone="warning" />
        <MetricCard title="Fechados" value={`${closedCount}/${rows.length}`} hint="Técnicos com folha" icon={WalletCards} />
      </div>

      <div className="mt-5">
        <DataPanel
          title="Fechamento por técnico"
          description="Use calcular para atualizar a folha a partir das regras atuais."
          action={
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar técnico" className="w-56 bg-transparent text-sm outline-none" />
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">Técnico</th>
                  <th className="py-3 pr-4 font-medium">OS</th>
                  <th className="py-3 pr-4 font-medium">Produção</th>
                  <th className="py-3 pr-4 font-medium">Comissão</th>
                  <th className="py-3 pr-4 font-medium">Extraordinário</th>
                  <th className="py-3 pr-4 font-medium">Banco</th>
                  <th className="py-3 pr-4 font-medium">Líquido</th>
                  <th className="py-3 font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.technician.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4 font-medium">{row.technician.name}</td>
                    <td className="py-3 pr-4">{row.serviceCount}</td>
                    <td className="py-3 pr-4">{formatCurrency(row.totalServices)}</td>
                    <td className="py-3 pr-4">{formatCurrency(row.payroll?.commission_value ?? row.estimatedCommission)}</td>
                    <td className="py-3 pr-4">{formatCurrency(row.payroll?.extraordinary_award_value ?? row.estimatedAward)}</td>
                    <td className="py-3 pr-4">{formatHours(row.payroll?.hour_bank_balance ?? 0)}</td>
                    <td className="py-3 pr-4 font-semibold">{formatCurrency(row.payroll?.net_total ?? row.estimatedNet)}</td>
                    <td className="py-3">
                      {row.payroll ? (
                        <StatusBadge tone="success">Calculada</StatusBadge>
                      ) : (
                        <button type="button" onClick={() => calculatePayroll(row.technician.id)} className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50" disabled={calculatingId === row.technician.id}>
                          {calculatingId === row.technician.id ? 'Calculando' : 'Calcular'}
                        </button>
                      )}
                    </td>
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
