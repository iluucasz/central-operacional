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
import { compactName, formatCurrency, formatNumber, normalizeText, resolveCompetenceMonth } from '@/lib/formatters';
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
  return resolveCompetenceMonth(service.competence_month, service.date_performed);
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
    <Link
      href={href}
      className="group block rounded-2xl border border-border bg-background p-4 shadow-sm transition hover:border-primary/40 hover:bg-muted/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <StatusBadge tone={tone}>{value}</StatusBadge>
      </div>

      <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary">
        {action}
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </Link>
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

  const selectedCompetenceYear = Number(competenceMonth.slice(0, 4)) || new Date().getFullYear();
  const selectedCompetenceMonth = Number(competenceMonth.slice(5, 7)) || new Date().getMonth() + 1;
  const competenceYearOptions = useMemo(() => {
    const years = competenceOptions
      .map((value) => Number(value.slice(0, 4)))
      .filter((value) => Number.isInteger(value));

    return Array.from(new Set([selectedCompetenceYear, ...years])).sort((left, right) => left - right);
  }, [competenceOptions, selectedCompetenceYear]);

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
  const rowsWithPayrollObligation = summaries.filter((row) => row.hasActivity || row.technician.status === 'active');
  const pendingPayrollRows = rowsWithPayrollObligation.filter((row) => !row.payrollItem);
  const negativeResultRows = summaries.filter((row) => typeof row.result === 'number' && row.result < 0);
  const activeWithoutServicesRows = summaries.filter((row) => row.technician.status === 'active' && row.serviceCount === 0);
  const totalGrossValue = roundCurrency(servicesInCompetence.reduce((total, service) => total + moneyValue(service.value), 0));
  const payrollCostTotal = roundCurrency(payrollInCompetence.reduce((total, item) => total + getPayrollCost(item), 0));
  const closedResultTotal = roundCurrency(
    payrollInCompetence.reduce((total, item) => total + (moneyValue(item.total_services_value) - getPayrollCost(item)), 0),
  );
  const hasPayrollWorkInCompetence = rowsWithPayrollObligation.length > 0;
  const isPayrollAwaitingClosure = hasPayrollWorkInCompetence && pendingPayrollRows.length > 0;
  const payrollProgress = rowsWithServices.length ? Math.round((payrollInCompetence.length / rowsWithServices.length) * 100) : 0;
  const shortcutCards = [
    {
      href: '/admin/services',
      title: 'Importar OS',
      description: 'Enviar e revisar as ordens de serviço da competência.',
      icon: UploadCloud,
    },
    {
      href: '/admin/payroll',
      title: 'Calcular folha',
      description: 'Abrir os fechamentos e salvar os cálculos do mês.',
      icon: WalletCards,
    },
    {
      href: '/admin/technicians',
      title: 'Técnicos',
      description: 'Atualizar cadastro, comissão e situação da equipe.',
      icon: Users,
    },
    {
      href: '/admin/schedule',
      title: 'Escala',
      description: 'Organizar a cobertura e revisar a programação da equipe.',
      icon: CalendarDays,
    },
  ];

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
        <MetricCard
          title="Folha finalizada"
          value={isPayrollAwaitingClosure ? 'Aguardando' : formatCurrency(payrollCostTotal)}
          hint={
            isPayrollAwaitingClosure
              ? `Feche a folha de ${pendingPayrollRows.length} técnico(s) para liberar o total.`
              : `${payrollInCompetence.length} cálculo(s) salvo(s)`
          }
          icon={WalletCards}
          tone={isPayrollAwaitingClosure ? 'warning' : 'default'}
        />
        <MetricCard
          title="Resultado fechado"
          value={isPayrollAwaitingClosure ? 'Aguardando' : formatCurrency(closedResultTotal)}
          hint={isPayrollAwaitingClosure ? 'O resultado final aparece após o fechamento completo da folha.' : 'Bruto salvo - folha salva'}
          icon={WalletCards}
          tone={isPayrollAwaitingClosure ? 'warning' : closedResultTotal >= 0 ? 'success' : 'danger'}
          accentText
        />
        <MetricCard title="Pendentes" value={pendingPayrollRows.length} hint="Técnicos da competência sem folha" icon={AlertTriangle} tone={pendingPayrollRows.length ? 'warning' : 'success'} />
      </div>

      {isPayrollAwaitingClosure ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          A competência {formatCompetenceLabel(competenceMonth)} ainda aguarda fechamento da folha. Finalize os cálculos em{' '}
          <Link href="/admin/payroll" className="font-semibold underline underline-offset-2">
            Folha de pagamento
          </Link>{' '}
          para liberar os valores finais do painel.
        </div>
      ) : null}

      <div className="mb-4 grid gap-4 xl:grid-cols-[1fr_1.25fr]">
        <DataPanel title="Competência" description="Escolha o mês que será analisado no painel.">
          <div className="grid gap-3 md:max-w-xl md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Mês</span>
              <select
                value={String(selectedCompetenceMonth)}
                onChange={(event) => setCompetenceMonth(`${selectedCompetenceYear}-${String(Number(event.target.value)).padStart(2, '0')}`)}
                className="min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              >
                {monthNames.map((month, index) => (
                  <option key={month} value={index + 1}>
                    {month}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Ano</span>
              <select
                value={String(selectedCompetenceYear)}
                onChange={(event) => setCompetenceMonth(`${event.target.value}-${String(selectedCompetenceMonth).padStart(2, '0')}`)}
                className="min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              >
                {competenceYearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </DataPanel>

        <DataPanel title="Atalhos úteis" description="Ações mais comuns para manter a operação atualizada.">
          <div className="grid gap-3 sm:grid-cols-2">
            {shortcutCards.map(({ href, title, description, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group rounded-2xl border border-border bg-background p-4 shadow-sm transition hover:border-primary/40 hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>

                <div className="mt-4 space-y-1">
                  <div className="text-base font-semibold text-foreground">{title}</div>
                  <p className="text-sm leading-5 text-muted-foreground">{description}</p>
                </div>
              </Link>
            ))}
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
          description={
            isPayrollAwaitingClosure
              ? `Fechamento aguardando a folha de ${pendingPayrollRows.length} técnico(s).`
              : hasPayrollWorkInCompetence
                ? `Fechamento da competência: ${payrollProgress}% concluído.`
                : 'Sem OS com impacto em folha nesta competência.'
          }
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
