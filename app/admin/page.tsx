'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, UploadCloud, Users, WalletCards, Wrench } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { compactName, formatCurrency, formatNumber, monthKeyFromDate, normalizeText } from '@/lib/formatters';
import type { Payroll, Service, Technician } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

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

type TechnicianSummary = {
  technician: Technician;
  serviceCount: number;
  grossValue: number;
  payrollItem?: Payroll;
  payrollCost: number;
  result: number | null;
  hasActivity: boolean;
};

function moneyValue(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundCurrency(value: number | string | null | undefined) {
  return Math.round((moneyValue(value) + Number.EPSILON) * 100) / 100;
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
  const datePrefix = String(service.date_performed ?? '').match(/^(\d{4}-\d{2})/);
  if (datePrefix?.[1]) return datePrefix[1];

  const dateMonth = monthKeyFromDate(service.date_performed);
  if (dateMonth) return dateMonth;

  const savedCompetence = String(service.competence_month ?? '').trim();
  return /^\d{4}-\d{2}$/.test(savedCompetence) ? savedCompetence : '';
}

function serviceBelongsToTechnician(service: Service, technician: Technician) {
  if (service.technician_id === technician.id) return true;

  const serviceTechnicianName = normalizeText(service.technician_name);
  return Boolean(serviceTechnicianName && serviceTechnicianName === normalizeText(technician.name));
}

function getPayrollCost(payrollItem: Payroll) {
  return roundCurrency(moneyValue(payrollItem.net_total) + moneyValue(payrollItem.va_deduction) + moneyValue(payrollItem.vr_deduction));
}

function summarizeNames(rows: TechnicianSummary[]) {
  const names = rows.map((row) => compactName(row.technician.name));
  if (!names.length) return 'Nenhum';
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}

function PriorityItem({
  title,
  value,
  description,
  tone,
  href,
  action,
}: {
  title: string;
  value: string | number;
  description: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
  href: string;
  action: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <StatusBadge tone={tone}>{value}</StatusBadge>
      </div>
      <Button asChild variant="secondary" size="sm" className="mt-3 w-full justify-between">
        <Link href={href}>
          {action}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}

export default function AdminDashboard() {
  const { user, loading } = useAppSession();
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [competenceMonth, setCompetenceMonth] = useState(defaultCompetenceMonth);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      const [techniciansResult, servicesResult, payrollResult] = await Promise.allSettled([
        fetch('/api/technicians'),
        fetch('/api/services'),
        fetch('/api/payroll'),
      ]);
      const errors: string[] = [];

      if (techniciansResult.status === 'fulfilled' && techniciansResult.value.ok) {
        const data = await techniciansResult.value.json();
        if (mounted) setTechnicians(Array.isArray(data.technicians) ? data.technicians : []);
      } else {
        errors.push('técnicos');
        if (mounted) setTechnicians([]);
      }

      if (servicesResult.status === 'fulfilled' && servicesResult.value.ok) {
        const data = await servicesResult.value.json();
        if (mounted) setServices(Array.isArray(data.services) ? data.services : []);
      } else {
        errors.push('OS');
        if (mounted) setServices([]);
      }

      if (payrollResult.status === 'fulfilled' && payrollResult.value.ok) {
        const data = await payrollResult.value.json();
        if (mounted) setPayroll(Array.isArray(data.payrolls) ? data.payrolls : []);
      } else {
        errors.push('folha');
        if (mounted) setPayroll([]);
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

  const competenceOptions = useMemo(() => {
    const values = new Set<string>();

    services.forEach((service) => {
      const competence = getServiceCompetence(service);
      if (competence) values.add(competence);
    });

    payroll.forEach((item) => {
      const competence = String(item.competence_month ?? '').trim();
      if (/^\d{4}-\d{2}$/.test(competence)) values.add(competence);
    });

    return Array.from(values).sort((left, right) => right.localeCompare(left, 'pt-BR'));
  }, [payroll, services]);

  useEffect(() => {
    if (!competenceOptions.length) return;
    if (!competenceOptions.includes(competenceMonth)) {
      setCompetenceMonth(competenceOptions[0]);
    }
  }, [competenceMonth, competenceOptions]);

  const servicesInCompetence = useMemo(
    () => services.filter((service) => getServiceCompetence(service) === competenceMonth),
    [competenceMonth, services],
  );

  const payrollInCompetence = useMemo(
    () => payroll.filter((item) => item.competence_month === competenceMonth),
    [competenceMonth, payroll],
  );

  const summaries = useMemo<TechnicianSummary[]>(() => {
    return technicians
      .map((technician) => {
        const technicianServices = servicesInCompetence.filter((service) => serviceBelongsToTechnician(service, technician));
        const payrollItem = payrollInCompetence.find((item) => item.technician_id === technician.id);
        const grossValue = roundCurrency(technicianServices.reduce((total, service) => total + moneyValue(service.value), 0));
        const payrollCost = payrollItem ? getPayrollCost(payrollItem) : 0;
        const hasActivity = Boolean(technicianServices.length || payrollItem);

        return {
          technician,
          serviceCount: technicianServices.length,
          grossValue,
          payrollItem,
          payrollCost,
          result: payrollItem ? roundCurrency(moneyValue(payrollItem.total_services_value) - payrollCost) : null,
          hasActivity,
        };
      })
      .filter((row) => row.hasActivity || row.technician.status === 'active')
      .sort((left, right) => {
        if (right.grossValue !== left.grossValue) return right.grossValue - left.grossValue;
        if (Number(Boolean(right.payrollItem)) !== Number(Boolean(left.payrollItem))) {
          return Number(Boolean(right.payrollItem)) - Number(Boolean(left.payrollItem));
        }
        return left.technician.name.localeCompare(right.technician.name, 'pt-BR');
      });
  }, [payrollInCompetence, servicesInCompetence, technicians]);

  if (loading || isDataLoading || !user) {
    return <LoadingState />;
  }

  const activeTechnicians = technicians.filter((technician) => technician.status === 'active');
  const rowsWithServices = summaries.filter((row) => row.serviceCount > 0);
  const pendingPayrollRows = summaries.filter((row) => row.serviceCount > 0 && !row.payrollItem);
  const negativeResultRows = summaries.filter((row) => typeof row.result === 'number' && row.result < 0);
  const activeWithoutServicesRows = summaries.filter((row) => row.technician.status === 'active' && row.serviceCount === 0);
  const totalGrossValue = roundCurrency(servicesInCompetence.reduce((total, service) => total + moneyValue(service.value), 0));
  const payrollCostTotal = roundCurrency(payrollInCompetence.reduce((total, item) => total + getPayrollCost(item), 0));
  const closedResultTotal = roundCurrency(
    payrollInCompetence.reduce((total, item) => total + (moneyValue(item.total_services_value) - getPayrollCost(item)), 0),
  );
  const payrollProgress = rowsWithServices.length ? Math.round((payrollInCompetence.length / rowsWithServices.length) * 100) : 0;

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Painel administrativo"
        title="Visão geral"
        description="Resumo objetivo da operação: OS lançadas, folha, pendências e resultado da competência."
      >
        <StatusBadge tone="info">{formatCompetenceLabel(competenceMonth)}</StatusBadge>
      </PageHeader>

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Valor bruto" value={formatCurrency(totalGrossValue)} hint="Soma das OS do mês" icon={Wrench} tone="success" />
        <MetricCard title="OS" value={formatNumber(servicesInCompetence.length)} hint={`${rowsWithServices.length} técnico(s)`} icon={Wrench} />
        <MetricCard title="Folha finalizada" value={formatCurrency(payrollCostTotal)} hint={`${payrollInCompetence.length} cálculo(s) salvo(s)`} icon={WalletCards} />
        <MetricCard title="Resultado fechado" value={formatCurrency(closedResultTotal)} hint="Bruto salvo - folha salva" icon={WalletCards} tone={closedResultTotal >= 0 ? 'success' : 'danger'} accentText />
        <MetricCard title="Pendentes" value={pendingPayrollRows.length} hint="Técnicos com OS sem folha" icon={AlertTriangle} tone={pendingPayrollRows.length ? 'warning' : 'success'} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-[1fr_1.25fr]">
        <DataPanel title="Competência" description="Escolha o mês que será analisado no painel.">
          <label className="flex max-w-sm flex-col gap-2">
            <span className="text-xs font-medium uppercase text-muted-foreground">Mês de referência</span>
            <span className="flex h-12 items-center gap-3 rounded-md border border-border bg-background px-3">
              <CalendarDays className="h-4 w-4 text-primary" />
              <input
                type="month"
                value={competenceMonth}
                onChange={(event) => setCompetenceMonth(event.target.value)}
                className="w-full bg-transparent text-base font-semibold outline-none"
              />
            </span>
          </label>
          <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Selecionado: </span>
            <strong>{formatCompetenceLabel(competenceMonth)}</strong>
          </div>
        </DataPanel>

        <DataPanel title="Atalhos úteis" description="Ações mais comuns para manter a operação atualizada.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Button asChild variant="secondary" className="justify-between">
              <Link href="/admin/services">
                <span className="inline-flex items-center gap-2">
                  <UploadCloud className="h-4 w-4" />
                  Importar OS
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" className="justify-between">
              <Link href="/admin/payroll">
                <span className="inline-flex items-center gap-2">
                  <WalletCards className="h-4 w-4" />
                  Calcular folha
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" className="justify-between">
              <Link href="/admin/technicians">
                <span className="inline-flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Técnicos
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" className="justify-between">
              <Link href="/admin/schedule">
                <span className="inline-flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" />
                  Escala
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </DataPanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.6fr]">
        <DataPanel title="Prioridades" description="O que merece atenção agora.">
          <div className="space-y-3">
            <PriorityItem
              title="Fechar folha"
              value={pendingPayrollRows.length ? 'Pendente' : 'Ok'}
              tone={pendingPayrollRows.length ? 'warning' : 'success'}
              description={
                pendingPayrollRows.length
                  ? `Falta finalizar: ${summarizeNames(pendingPayrollRows)}.`
                  : 'Todos os técnicos com OS já têm cálculo salvo.'
              }
              href="/admin/payroll"
              action="Abrir folha"
            />
            <PriorityItem
              title="Resultado negativo"
              value={negativeResultRows.length ? 'Atenção' : 'Ok'}
              tone={negativeResultRows.length ? 'danger' : 'success'}
              description={
                negativeResultRows.length
                  ? `Revisar fechamento de ${summarizeNames(negativeResultRows)}.`
                  : 'Nenhum cálculo salvo está negativo.'
              }
              href="/admin/payroll"
              action="Revisar cálculos"
            />
            <PriorityItem
              title="Ativos sem OS"
              value={activeWithoutServicesRows.length}
              tone={activeWithoutServicesRows.length ? 'info' : 'success'}
              description={
                activeWithoutServicesRows.length
                  ? `${summarizeNames(activeWithoutServicesRows)} sem OS nesta competência.`
                  : 'Todos os técnicos ativos têm OS no mês.'
              }
              href="/admin/services"
              action="Ver OS"
            />
          </div>
        </DataPanel>

        <DataPanel
          title="Produção por técnico"
          description={`Fechamento da competência: ${payrollProgress}% concluído.`}
        >
          {summaries.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Técnico</th>
                    <th className="py-3 pr-4 font-medium">OS</th>
                    <th className="py-3 pr-4 font-medium">Bruto</th>
                    <th className="py-3 pr-4 font-medium">Folha</th>
                    <th className="py-3 pr-4 font-medium">Resultado</th>
                    <th className="py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((row) => (
                    <tr key={row.technician.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{row.technician.name}</div>
                        <div className="text-xs text-muted-foreground">{row.technician.qra || row.technician.email || '-'}</div>
                      </td>
                      <td className="py-3 pr-4">{row.serviceCount}</td>
                      <td className="py-3 pr-4">{formatCurrency(row.grossValue)}</td>
                      <td className="py-3 pr-4">{row.payrollItem ? formatCurrency(row.payrollCost) : '-'}</td>
                      <td className={`py-3 pr-4 font-semibold ${typeof row.result === 'number' && row.result < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {row.payrollItem ? formatCurrency(row.result) : '-'}
                      </td>
                      <td className="py-3">
                        {row.payrollItem ? (
                          <StatusBadge tone="success">Finalizado</StatusBadge>
                        ) : row.serviceCount > 0 ? (
                          <StatusBadge tone="warning">Pendente</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">Sem OS</StatusBadge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-secondary/30 px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhum dado real encontrado para a competência selecionada.
            </div>
          )}
        </DataPanel>
      </div>

      <div className="mt-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
        Equipe ativa: {activeTechnicians.length}/{technicians.length}. O painel usa apenas dados cadastrados em Serviços, Técnicos e Folha.
      </div>
    </AppShell>
  );
}
