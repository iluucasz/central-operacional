'use client';

import { useEffect, useState } from 'react';
import { Clock3, Trophy, WalletCards } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { demoPayroll, demoTechnicians } from '@/lib/demo-data';
import { formatCurrency, formatHours } from '@/lib/formatters';
import type { Payroll } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

export default function TechnicianPayrollPage() {
  const { user, loading } = useAppSession();
  const [payroll, setPayroll] = useState<Payroll[]>([]);

  useEffect(() => {
    async function loadPayroll() {
      if (!user) return;
      const technicianId = user.technicianId ?? user.userId;
      const response = await fetch(`/api/payroll?technicianId=${technicianId}`);
      if (response.ok) {
        const data = await response.json();
        setPayroll(data.payrolls ?? []);
      }
    }

    loadPayroll();
  }, [user]);

  const fallbackTechnician = demoTechnicians[0];
  const visiblePayroll = payroll.length ? payroll : demoPayroll.filter((item) => item.technician_id === fallbackTechnician.id);
  const currentPayroll = visiblePayroll[0];
  const hourBankBalance = Number(currentPayroll?.hour_bank_balance ?? 0);
  const hourBankHint = hourBankBalance < 0 ? 'Colaborador devendo horas' : hourBankBalance > 0 ? 'Empresa devendo horas' : 'Saldo zerado';

  if (loading || !user) {
    return <LoadingState />;
  }

  const totalDiscounts = Number(currentPayroll?.discounts_total ?? 0) + Number(currentPayroll?.advances_total ?? 0);

  const items = [
    { label: 'Salário base', value: currentPayroll?.base_salary ?? 0, sign: 'plus' },
    { label: 'VA', value: currentPayroll?.va_deduction ?? 0, sign: 'plus' },
    { label: 'VR', value: currentPayroll?.vr_deduction ?? 0, sign: 'plus' },
    { label: 'Comissão por serviços', value: currentPayroll?.commission_value ?? 0, sign: 'plus' },
    { label: 'Horas extras', value: currentPayroll?.extra_hours_value ?? 0, sign: 'plus' },
    { label: 'Premiação extraordinária', value: currentPayroll?.extraordinary_award_value ?? 0, sign: 'plus' },
    { label: 'Adiantamentos', value: currentPayroll?.advances_total ?? 0, sign: 'minus' },
    { label: 'Descontos', value: currentPayroll?.discounts_total ?? 0, sign: 'minus' },
  ];

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader eyebrow="Financeiro" title="Meu pagamento" description="Detalhamento do fechamento de folha por competência." />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Líquido" value={formatCurrency(currentPayroll?.net_total ?? 0)} hint={currentPayroll?.competence_month ?? 'Sem competência'} icon={WalletCards} tone="success" />
        <MetricCard title="Comissão" value={formatCurrency(currentPayroll?.commission_value ?? 0)} hint="Valor diluído no holerite" icon={WalletCards} />
        <MetricCard title="Extraordinário" value={formatCurrency(currentPayroll?.extraordinary_award_value ?? 0)} hint="Meta de 80 ou 160 OS" icon={Trophy} tone="warning" />
        <MetricCard title="Descontos" value={formatCurrency(totalDiscounts)} hint="Adiantamento + descontos" icon={WalletCards} tone="danger" />
        <MetricCard title="Banco de horas" value={formatHours(hourBankBalance)} hint={hourBankHint} icon={Clock3} tone={hourBankBalance < 0 ? 'danger' : 'warning'} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <DataPanel title="Composição" description="Valores positivos e descontos da competência.">
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.label} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <span className={`text-sm font-semibold ${item.sign === 'minus' ? 'text-rose-600' : 'text-foreground'}`}>
                  {item.sign === 'minus' ? '-' : ''}
                  {formatCurrency(item.value)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-md bg-secondary p-3">
              <span className="font-semibold">Total líquido</span>
              <span className="text-lg font-semibold text-primary">{formatCurrency(currentPayroll?.net_total ?? 0)}</span>
            </div>
          </div>
        </DataPanel>

        <DataPanel title="Histórico de competências" description="Fechamentos disponíveis ao técnico.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">Competência</th>
                  <th className="py-3 pr-4 font-medium">Produção</th>
                  <th className="py-3 pr-4 font-medium">Comissão</th>
                  <th className="py-3 pr-4 font-medium">Extraordinário</th>
                  <th className="py-3 pr-4 font-medium">Banco</th>
                  <th className="py-3 font-medium">Líquido</th>
                </tr>
              </thead>
              <tbody>
                {visiblePayroll.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4">{item.competence_month}</td>
                    <td className="py-3 pr-4">{formatCurrency(item.total_services_value)}</td>
                    <td className="py-3 pr-4">{formatCurrency(item.commission_value)}</td>
                    <td className="py-3 pr-4">{formatCurrency(item.extraordinary_award_value ?? 0)}</td>
                    <td className="py-3 pr-4">{formatHours(item.hour_bank_balance)}</td>
                    <td className="py-3 font-semibold">{formatCurrency(item.net_total)}</td>
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
