'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Landmark,
  MoreHorizontal,
  PencilLine,
  Plus,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  Undo2,
  WalletCards,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAppSession } from '@/hooks/use-app-session';
import { formatCurrency, formatDate, normalizeText } from '@/lib/formatters';
import type { FinancialEntry, FinancialEntryStatus, FinancialEntryType } from '@/lib/types';

type EntryFormData = {
  type: FinancialEntryType;
  description: string;
  category: string;
  amount: number;
  due_date: string;
  competence_month: string;
  status: FinancialEntryStatus;
  paid_amount: number;
  paid_at: string;
  billing_mode: 'single' | 'installments' | 'recurring';
  installments_count: number;
  recurring_months: number;
  notes: string;
};

type DreRow = {
  category: string;
  revenue: number;
  expense: number;
  result: number;
};

type MonthSummary = {
  receivableTotal: number;
  payableTotal: number;
  competenceResult: number;
  paidReceivableTotal: number;
  paidPayableTotal: number;
  cashResult: number;
  reserveTotal: number;
  investmentTotal: number;
};

function getLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const todayKey = getLocalDateKey();
const defaultCompetenceMonth = todayKey.slice(0, 7);
const inputClassName = 'min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring';
const financialCategories = [
  'Geral',
  'Cartão de crédito',
  'Financiamento',
  'Aluguel',
  'Energia',
  'Água',
  'Internet',
  'Telefone',
  'Impostos',
  'Fornecedores',
  'Manutenção',
  'Combustível',
  'Folha',
  'Marketing',
  'Reserva',
  'Investimentos',
  'Outros',
];

function createInitialFormData(type: FinancialEntryType = 'payable'): EntryFormData {
  return {
    type,
    description: '',
    category: '',
    amount: 0,
    due_date: todayKey,
    competence_month: defaultCompetenceMonth,
    status: 'pending',
    paid_amount: 0,
    paid_at: '',
    billing_mode: 'single',
    installments_count: 2,
    recurring_months: 12,
    notes: '',
  };
}

function moneyValue(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundCurrency(value: number | string | null | undefined) {
  return Math.round((moneyValue(value) + Number.EPSILON) * 100) / 100;
}

function getDaysUntil(dateKey: string) {
  const today = new Date(`${todayKey}T00:00:00`);
  const dueDate = new Date(`${dateKey}T00:00:00`);
  return Math.ceil((dueDate.getTime() - today.getTime()) / 86_400_000);
}

function formatCompetenceLabel(value: string) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[2]}/${match[1]}` : value || 'Sem competência';
}

function formatDayCount(value: number) {
  return `${value} ${value === 1 ? 'dia' : 'dias'}`;
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function getPreviousMonthKey(value: string) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getPaidAmount(entry: FinancialEntry) {
  return roundCurrency(Math.min(moneyValue(entry.amount), moneyValue(entry.paid_amount)));
}

function getOpenAmount(entry: FinancialEntry) {
  return roundCurrency(Math.max(0, moneyValue(entry.amount) - getPaidAmount(entry)));
}

function isEntryFullyPaid(entry: FinancialEntry) {
  return entry.status === 'paid' || getOpenAmount(entry) <= 0;
}

function isEntryPartiallyPaid(entry: FinancialEntry) {
  return !isEntryFullyPaid(entry) && getPaidAmount(entry) > 0;
}

function isReserveCategory(value: string | null | undefined) {
  return normalizeText(value).includes('reserva');
}

function isInvestmentCategory(value: string | null | undefined) {
  const normalized = normalizeText(value);
  return normalized.includes('investimento') || normalized.includes('investimentos');
}

function summarizeMonthEntries(entries: FinancialEntry[]): MonthSummary {
  const receivableTotal = roundCurrency(
    entries.filter((entry) => entry.type === 'receivable').reduce((total, entry) => total + moneyValue(entry.amount), 0),
  );
  const payableTotal = roundCurrency(
    entries.filter((entry) => entry.type === 'payable').reduce((total, entry) => total + moneyValue(entry.amount), 0),
  );
  const paidReceivableTotal = roundCurrency(
    entries.filter((entry) => entry.type === 'receivable').reduce((total, entry) => total + getPaidAmount(entry), 0),
  );
  const paidPayableTotal = roundCurrency(
    entries.filter((entry) => entry.type === 'payable').reduce((total, entry) => total + getPaidAmount(entry), 0),
  );
  const reserveTotal = roundCurrency(entries.filter((entry) => isReserveCategory(entry.category)).reduce((total, entry) => total + moneyValue(entry.amount), 0));
  const investmentTotal = roundCurrency(entries.filter((entry) => isInvestmentCategory(entry.category)).reduce((total, entry) => total + moneyValue(entry.amount), 0));

  return {
    receivableTotal,
    payableTotal,
    competenceResult: roundCurrency(receivableTotal - payableTotal),
    paidReceivableTotal,
    paidPayableTotal,
    cashResult: roundCurrency(paidReceivableTotal - paidPayableTotal),
    reserveTotal,
    investmentTotal,
  };
}

function getTypeLabel(type: FinancialEntryType) {
  return type === 'payable' ? 'A pagar' : 'A receber';
}

function getEntryBadge(entry: FinancialEntry): { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' } {
  if (isEntryFullyPaid(entry)) {
    return { label: entry.type === 'payable' ? 'Pago' : 'Recebido', tone: 'success' };
  }

  if (isEntryPartiallyPaid(entry)) {
    return { label: 'Parcial', tone: 'info' };
  }

  const daysUntil = getDaysUntil(entry.due_date);
  if (daysUntil < 0) return { label: 'Atrasada', tone: 'danger' };
  if (daysUntil <= 7) return { label: 'A vencer', tone: 'warning' };
  return { label: 'Pendente', tone: 'neutral' };
}

function getDueLabel(entry: FinancialEntry) {
  if (isEntryFullyPaid(entry)) {
    return entry.paid_at ? `Baixada em ${formatDate(entry.paid_at)}` : 'Baixada';
  }

  if (isEntryPartiallyPaid(entry)) {
    return `Restam ${formatCurrency(getOpenAmount(entry))}`;
  }

  const daysUntil = getDaysUntil(entry.due_date);
  if (daysUntil < 0) return `${formatDayCount(Math.abs(daysUntil))} em atraso`;
  if (daysUntil === 0) return 'Vence hoje';
  if (daysUntil <= 7) return `Vence em ${formatDayCount(daysUntil)}`;
  return formatDate(entry.due_date);
}

function sortEntries(left: FinancialEntry, right: FinancialEntry) {
  if (left.status !== right.status) {
    return left.status === 'pending' ? -1 : 1;
  }

  const dateCompare = left.due_date.localeCompare(right.due_date);
  if (dateCompare !== 0) return dateCompare;

  return left.description.localeCompare(right.description, 'pt-BR');
}

export default function AdminFinanceiroPage() {
  const { user, loading } = useAppSession();
  const [entries, setEntries] = useState<FinancialEntry[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | FinancialEntryType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | FinancialEntryStatus | 'partial' | 'due_soon' | 'overdue'>('all');
  const [competenceMonth, setCompetenceMonth] = useState(defaultCompetenceMonth);
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [paymentEntry, setPaymentEntry] = useState<FinancialEntry | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentDate, setPaymentDate] = useState(todayKey);
  const [paymentError, setPaymentError] = useState('');
  const [isPaymentSubmitting, setIsPaymentSubmitting] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [formData, setFormData] = useState<EntryFormData>(() => createInitialFormData());
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rowActionId, setRowActionId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadEntries() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      try {
        const response = await fetch('/api/finance');
        if (!response.ok) {
          throw new Error('Finance API failed');
        }

        const data = await response.json();
        if (mounted) {
          setEntries(Array.isArray(data.entries) ? data.entries : []);
        }
      } catch (error) {
        console.error('[admin/financeiro] load entries error:', error);
        if (mounted) {
          setEntries([]);
          setDataError('Não foi possível carregar os dados financeiros.');
        }
      } finally {
        if (mounted) {
          setIsDataLoading(false);
        }
      }
    }

    loadEntries();

    return () => {
      mounted = false;
    };
  }, [user]);

  const competenceOptions = useMemo(() => {
    return Array.from(new Set([defaultCompetenceMonth, ...entries.map((entry) => entry.competence_month).filter(Boolean)])).sort((left, right) =>
      right.localeCompare(left, 'pt-BR'),
    );
  }, [entries]);

  useEffect(() => {
    if (!competenceOptions.includes(competenceMonth)) {
      setCompetenceMonth(competenceOptions[0] ?? defaultCompetenceMonth);
    }
  }, [competenceMonth, competenceOptions]);

  const entriesInCompetence = useMemo(
    () => entries.filter((entry) => entry.competence_month === competenceMonth),
    [competenceMonth, entries],
  );

  const previousCompetenceMonth = getPreviousMonthKey(competenceMonth);
  const entriesInPreviousCompetence = useMemo(
    () => entries.filter((entry) => entry.competence_month === previousCompetenceMonth),
    [entries, previousCompetenceMonth],
  );

  const summary = useMemo(() => {
    const monthSummary = summarizeMonthEntries(entriesInCompetence);
    const pendingEntries = entries.filter((entry) => !isEntryFullyPaid(entry));
    const overdueEntries = pendingEntries.filter((entry) => getDaysUntil(entry.due_date) < 0);
    const dueSoonEntries = pendingEntries.filter((entry) => {
      const daysUntil = getDaysUntil(entry.due_date);
      return daysUntil >= 0 && daysUntil <= 7;
    });

    return {
      ...monthSummary,
      overdueEntries,
      dueSoonEntries,
    };
  }, [entries, entriesInCompetence]);

  const previousSummary = useMemo(() => summarizeMonthEntries(entriesInPreviousCompetence), [entriesInPreviousCompetence]);
  const reserveInvestmentEntriesInCompetence = useMemo(
    () => entriesInCompetence.filter((entry) => isReserveCategory(entry.category) || isInvestmentCategory(entry.category)),
    [entriesInCompetence],
  );
  const reserveInvestmentTotals = useMemo(() => {
    const reserveTotal = roundCurrency(entries.filter((entry) => isReserveCategory(entry.category)).reduce((total, entry) => total + moneyValue(entry.amount), 0));
    const investmentTotal = roundCurrency(entries.filter((entry) => isInvestmentCategory(entry.category)).reduce((total, entry) => total + moneyValue(entry.amount), 0));

    return {
      reserveTotal,
      investmentTotal,
      total: roundCurrency(reserveTotal + investmentTotal),
    };
  }, [entries]);

  const dreRows = useMemo<DreRow[]>(() => {
    const rows = new Map<string, DreRow>();

    entriesInCompetence.forEach((entry) => {
      const category = entry.category || 'Geral';
      const current = rows.get(category) ?? { category, revenue: 0, expense: 0, result: 0 };

      if (entry.type === 'receivable') {
        current.revenue += moneyValue(entry.amount);
      } else {
        current.expense += moneyValue(entry.amount);
      }

      current.result = roundCurrency(current.revenue - current.expense);
      rows.set(category, current);
    });

    return Array.from(rows.values()).sort((left, right) => Math.abs(right.result) - Math.abs(left.result));
  }, [entriesInCompetence]);

  const filteredEntries = useMemo(() => {
    return entriesInCompetence
      .filter((entry) => {
        if (typeFilter !== 'all' && entry.type !== typeFilter) return false;

        if (statusFilter === 'pending') {
          if (isEntryFullyPaid(entry)) return false;
        }

        if (statusFilter === 'paid') {
          if (!isEntryFullyPaid(entry)) return false;
        }

        if (statusFilter === 'partial') {
          if (!isEntryPartiallyPaid(entry)) return false;
        }

        if (statusFilter === 'due_soon') {
          const daysUntil = getDaysUntil(entry.due_date);
          if (isEntryFullyPaid(entry) || daysUntil < 0 || daysUntil > 7) return false;
        }

        if (statusFilter === 'overdue') {
          if (isEntryFullyPaid(entry) || getDaysUntil(entry.due_date) >= 0) return false;
        }

        const haystack = normalizeText(`${entry.description} ${entry.category} ${entry.notes ?? ''} ${getTypeLabel(entry.type)} ${entry.status}`);
        return !query || haystack.includes(normalizeText(query));
      })
      .sort(sortEntries);
  }, [entriesInCompetence, query, statusFilter, typeFilter]);

  function openCreateDialog(type: FinancialEntryType = 'payable') {
    setEditingEntryId(null);
    setFormData({ ...createInitialFormData(type), competence_month: competenceMonth });
    setFormError('');
    setIsFormDialogOpen(true);
  }

  function openEditDialog(entry: FinancialEntry) {
    setEditingEntryId(entry.id);
    setFormData({
      type: entry.type,
      description: entry.description,
      category: entry.category,
      amount: moneyValue(entry.amount),
      due_date: entry.due_date,
      competence_month: entry.competence_month,
      status: isEntryFullyPaid(entry) ? 'paid' : 'pending',
      paid_amount: getPaidAmount(entry),
      paid_at: entry.paid_at ?? '',
      billing_mode: 'single',
      installments_count: entry.installment_total ?? 1,
      recurring_months: entry.installment_total ?? 1,
      notes: entry.notes ?? '',
    });
    setFormError('');
    setIsFormDialogOpen(true);
  }

  function handleFormDialogChange(open: boolean) {
    if (isSubmitting && !open) return;

    setIsFormDialogOpen(open);
    if (!open) {
      setEditingEntryId(null);
      setFormData(createInitialFormData());
      setFormError('');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setFormError('');

    try {
      const paidAmount = formData.status === 'paid' && formData.paid_amount <= 0 ? formData.amount : formData.paid_amount;
      const payload = {
        id: editingEntryId,
        ...formData,
        category: formData.category.trim() || 'Geral',
        status: paidAmount >= formData.amount ? 'paid' : 'pending',
        paid_amount: paidAmount,
        paid_at: paidAmount > 0 ? formData.paid_at || todayKey : '',
      };
      const response = await fetch('/api/finance', {
        method: editingEntryId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        setFormError(data.error || 'Não foi possível salvar a conta.');
        return;
      }

      const createdEntries = Array.isArray(data.entries) ? data.entries : [data];

      setEntries((current) => {
        if (editingEntryId) {
          return current.map((entry) => (entry.id === editingEntryId ? data : entry));
        }

        return [...createdEntries, ...current];
      });
      setIsFormDialogOpen(false);
      setEditingEntryId(null);
      setFormData(createInitialFormData());
    } finally {
      setIsSubmitting(false);
    }
  }

  async function updateEntry(entry: FinancialEntry, overrides: Partial<EntryFormData>) {
    setRowActionId(entry.id);
    setDataError('');

    try {
      const nextStatus = overrides.status ?? entry.status;
      const nextPaidAmount = overrides.paid_amount ?? getPaidAmount(entry);
      const response = await fetch('/api/finance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...entry,
          ...overrides,
          status: nextStatus,
          paid_amount: nextPaidAmount,
          paid_at: nextPaidAmount > 0 || nextStatus === 'paid' ? overrides.paid_at || entry.paid_at || todayKey : '',
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setDataError(data.error || 'Não foi possível atualizar a conta.');
        return false;
      }

      setEntries((current) => current.map((item) => (item.id === entry.id ? data : item)));
      return true;
    } finally {
      setRowActionId(null);
    }
  }

  function openPaymentDialog(entry: FinancialEntry) {
    const remainingAmount = getOpenAmount(entry);

    setPaymentEntry(entry);
    setPaymentAmount(remainingAmount || moneyValue(entry.amount));
    setPaymentDate(todayKey);
    setPaymentError('');
    setIsPaymentDialogOpen(true);
  }

  function handlePaymentDialogChange(open: boolean) {
    if (isPaymentSubmitting && !open) return;

    setIsPaymentDialogOpen(open);
    if (!open) {
      setPaymentEntry(null);
      setPaymentAmount(0);
      setPaymentDate(todayKey);
      setPaymentError('');
    }
  }

  async function handlePaymentSubmit() {
    if (!paymentEntry) return;

    const amount = roundCurrency(paymentAmount);
    const remainingAmount = getOpenAmount(paymentEntry);

    if (amount <= 0) {
      setPaymentError('Informe um valor de baixa maior que zero.');
      return;
    }

    if (amount > remainingAmount) {
      setPaymentError(`O valor máximo para esta baixa é ${formatCurrency(remainingAmount)}.`);
      return;
    }

    setIsPaymentSubmitting(true);
    setPaymentError('');

    try {
      const nextPaidAmount = roundCurrency(getPaidAmount(paymentEntry) + amount);
      const updated = await updateEntry(paymentEntry, {
        paid_amount: nextPaidAmount,
        status: nextPaidAmount >= moneyValue(paymentEntry.amount) ? 'paid' : 'pending',
        paid_at: paymentDate || todayKey,
      });
      if (updated) {
        handlePaymentDialogChange(false);
      }
    } finally {
      setIsPaymentSubmitting(false);
    }
  }

  async function deleteEntry(entry: FinancialEntry) {
    if (!window.confirm(`Excluir "${entry.description}" do financeiro?`)) return;

    setRowActionId(entry.id);
    setDataError('');

    try {
      const response = await fetch(`/api/finance?id=${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      const data = await response.json();

      if (!response.ok) {
        setDataError(data.error || 'Não foi possível excluir a conta.');
        return;
      }

      setEntries((current) => current.filter((item) => item.id !== entry.id));
    } finally {
      setRowActionId(null);
    }
  }

  if (loading || isDataLoading || !user) {
    return <LoadingState />;
  }

  const resultTone = summary.competenceResult >= 0 ? 'success' : 'danger';
  const alertEntries = [...summary.overdueEntries, ...summary.dueSoonEntries].sort(sortEntries).slice(0, 6);
  const isInstallmentCreation = !editingEntryId && formData.billing_mode === 'installments';
  const isRecurringCreation = !editingEntryId && formData.billing_mode === 'recurring';
  const installmentPreviewAmount = isInstallmentCreation ? roundCurrency(formData.amount / Math.max(1, formData.installments_count)) : 0;
  const paymentRemainingAmount = paymentEntry ? getOpenAmount(paymentEntry) : 0;
  const paymentPaidAmount = paymentEntry ? getPaidAmount(paymentEntry) : 0;

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Módulo administrativo"
        title="Controle de Despesas"
        description="Contas a pagar e a receber, baixas, vencimentos e DRE por competência."
      >
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => openCreateDialog('receivable')}>
            <TrendingUp className="h-4 w-4" />
            A receber
          </Button>
          <Button type="button" onClick={() => openCreateDialog('payable')}>
            <Plus className="h-4 w-4" />
            Nova conta
          </Button>
        </div>
      </PageHeader>

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      {alertEntries.length ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                {formatCount(summary.overdueEntries.length, 'conta atrasada', 'contas atrasadas')} e{' '}
                {formatCount(summary.dueSoonEntries.length, 'conta vencendo', 'contas vencendo')} nos próximos 7 dias.
              </p>
              <p className="mt-1 text-amber-700">
                Próximo item: {alertEntries[0].description} - {formatCurrency(alertEntries[0].amount)} ({getDueLabel(alertEntries[0])}).
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Receitas" value={formatCurrency(summary.receivableTotal)} hint="Regime de competência" icon={TrendingUp} tone="success" />
        <MetricCard title="Despesas" value={formatCurrency(summary.payableTotal)} hint={`Mês anterior: ${formatCurrency(previousSummary.payableTotal)}`} icon={TrendingDown} tone="warning" />
        <MetricCard
          title="Resultado"
          value={formatCurrency(summary.competenceResult)}
          hint={`Anterior: ${formatCurrency(previousSummary.competenceResult)} | Caixa: ${formatCurrency(summary.cashResult)}`}
          icon={Landmark}
          tone={resultTone}
          accentText
        />
        <MetricCard title="A vencer" value={summary.dueSoonEntries.length} hint="Próximos 7 dias" icon={Clock3} tone={summary.dueSoonEntries.length ? 'warning' : 'success'} />
        <MetricCard title="Atrasadas" value={summary.overdueEntries.length} hint="Pendências vencidas" icon={AlertTriangle} tone={summary.overdueEntries.length ? 'danger' : 'success'} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Despesas mês anterior" value={formatCurrency(previousSummary.payableTotal)} hint={formatCompetenceLabel(previousCompetenceMonth)} icon={TrendingDown} tone="warning" />
        <MetricCard
          title="Resultado anterior"
          value={formatCurrency(previousSummary.competenceResult)}
          hint="Receitas - despesas"
          icon={Landmark}
          tone={previousSummary.competenceResult >= 0 ? 'success' : 'danger'}
          accentText
        />
        <MetricCard title="Reservas do mês" value={formatCurrency(summary.reserveTotal)} hint={`Total: ${formatCurrency(reserveInvestmentTotals.reserveTotal)}`} icon={WalletCards} tone="success" />
        <MetricCard title="Investimentos do mês" value={formatCurrency(summary.investmentTotal)} hint={`Total: ${formatCurrency(reserveInvestmentTotals.investmentTotal)}`} icon={TrendingUp} tone="success" />
      </div>

      <div className="mt-5">
        <DataPanel title="Competência e filtros" description="Recorte mensal para contas, vencimentos e DRE.">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.75fr))_auto] xl:items-end">
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar conta, categoria ou observação"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Competência</span>
              <select value={competenceMonth} onChange={(event) => setCompetenceMonth(event.target.value)} className={inputClassName}>
                {competenceOptions.map((competence) => (
                  <option key={competence} value={competence}>
                    {formatCompetenceLabel(competence)}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Tipo</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | FinancialEntryType)} className={inputClassName}>
                <option value="all">Todos</option>
                <option value="payable">A pagar</option>
                <option value="receivable">A receber</option>
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | FinancialEntryStatus | 'partial' | 'due_soon' | 'overdue')}
                className={inputClassName}
              >
                <option value="all">Todos</option>
                <option value="pending">Pendente</option>
                <option value="partial">Parcial</option>
                <option value="paid">Baixada</option>
                <option value="due_soon">A vencer</option>
                <option value="overdue">Atrasadas</option>
              </select>
            </label>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery('');
                setTypeFilter('all');
                setStatusFilter('all');
              }}
            >
              Limpar
            </Button>
          </div>
        </DataPanel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_0.8fr]">
        <DataPanel
          title="Contas cadastradas"
          description={`${formatCount(filteredEntries.length, 'registro encontrado', 'registros encontrados')} na competência ${formatCompetenceLabel(competenceMonth)}.`}
        >
          {filteredEntries.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Conta</th>
                    <th className="py-3 pr-4 font-medium">Tipo</th>
                    <th className="py-3 pr-4 font-medium">Valor</th>
                    <th className="py-3 pr-4 font-medium">Vencimento</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => {
                    const badge = getEntryBadge(entry);
                    const rowIsBusy = rowActionId === entry.id;

                    return (
                      <tr key={entry.id} className="border-b border-border last:border-0">
                        <td className="py-3 pr-4">
                          <div className="font-medium text-foreground">{entry.description}</div>
                          <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span>{entry.category || 'Geral'}</span>
                            {(entry.installment_total ?? 1) > 1 ? (
                              <span>{entry.is_recurring ? 'Recorrente' : 'Parcela'} {entry.installment_number ?? 1}/{entry.installment_total}</span>
                            ) : null}
                            {entry.notes ? <span className="max-w-80 truncate">{entry.notes}</span> : null}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <StatusBadge tone={entry.type === 'receivable' ? 'success' : 'warning'}>{getTypeLabel(entry.type)}</StatusBadge>
                        </td>
                        <td className={`py-3 pr-4 font-semibold ${entry.type === 'receivable' ? 'text-emerald-700' : 'text-rose-700'}`}>
                          <div>{formatCurrency(entry.amount)}</div>
                          {getPaidAmount(entry) > 0 ? (
                            <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                              Baixado {formatCurrency(getPaidAmount(entry))}
                              {getOpenAmount(entry) > 0 ? ` | aberto ${formatCurrency(getOpenAmount(entry))}` : ''}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-3 pr-4">
                          <div>{formatDate(entry.due_date)}</div>
                          <div className="text-xs text-muted-foreground">{getDueLabel(entry)}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                        </td>
                        <td className="py-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Ações para ${entry.description}`} disabled={rowIsBusy}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {!isEntryFullyPaid(entry) ? (
                                <DropdownMenuItem onSelect={() => openPaymentDialog(entry)}>
                                  <CheckCircle2 className="h-4 w-4" />
                                  Dar baixa
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onSelect={() => void updateEntry(entry, { status: 'pending', paid_amount: 0, paid_at: '' })}>
                                  <Undo2 className="h-4 w-4" />
                                  Reabrir
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onSelect={() => openEditDialog(entry)}>
                                <PencilLine className="h-4 w-4" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onSelect={() => void deleteEntry(entry)}>
                                <Trash2 className="h-4 w-4" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={WalletCards} title="Nenhuma conta encontrada" description="Cadastre contas a pagar ou a receber para iniciar o controle financeiro." />
          )}
        </DataPanel>

        <div className="space-y-5">
          <DataPanel title="DRE por competência" description="Receitas menos despesas lançadas no mês.">
            {dreRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                      <th className="py-3 pr-4 font-medium">Categoria</th>
                      <th className="py-3 pr-4 font-medium">Receita</th>
                      <th className="py-3 pr-4 font-medium">Despesa</th>
                      <th className="py-3 font-medium">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dreRows.map((row) => (
                      <tr key={row.category} className="border-b border-border last:border-0">
                        <td className="py-3 pr-4 font-medium">{row.category}</td>
                        <td className="py-3 pr-4 text-emerald-700">{formatCurrency(row.revenue)}</td>
                        <td className="py-3 pr-4 text-rose-700">{formatCurrency(row.expense)}</td>
                        <td className={`py-3 font-semibold ${row.result >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatCurrency(row.result)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={Landmark} title="Sem dados para a DRE" description="A DRE aparece conforme as contas da competência forem cadastradas." />
            )}
          </DataPanel>

          <DataPanel title="Reservas e investimentos" description="Valores classificados nas categorias Reserva ou Investimentos.">
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase text-muted-foreground">Acumulado</p>
                <p className="mt-1 text-base font-semibold">{formatCurrency(reserveInvestmentTotals.total)}</p>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase text-muted-foreground">No mês</p>
                <p className="mt-1 text-base font-semibold">{formatCurrency(summary.reserveTotal + summary.investmentTotal)}</p>
              </div>
            </div>

            {reserveInvestmentEntriesInCompetence.length ? (
              <div className="space-y-2">
                {reserveInvestmentEntriesInCompetence.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{entry.description}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{entry.category} - {formatDate(entry.due_date)}</p>
                    </div>
                    <strong className="text-sm">{formatCurrency(entry.amount)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={WalletCards} title="Sem reservas no mês" description="Use as categorias Reserva ou Investimentos para acompanhar esse bloco." />
            )}
          </DataPanel>

          <DataPanel title="Alertas de vencimento" description="Pendências ordenadas pela data mais urgente.">
            {alertEntries.length ? (
              <div className="space-y-2">
                {alertEntries.map((entry) => {
                  const badge = getEntryBadge(entry);

                  return (
                    <div key={entry.id} className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{entry.description}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(entry.due_date)} - {formatCurrency(entry.amount)}
                        </p>
                      </div>
                      <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={CalendarDays} title="Sem vencimentos urgentes" description="Não há contas atrasadas ou vencendo nos próximos 7 dias." />
            )}
          </DataPanel>
        </div>
      </div>

      <Dialog open={isFormDialogOpen} onOpenChange={handleFormDialogChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingEntryId ? 'Editar conta' : 'Nova conta financeira'}</DialogTitle>
            <DialogDescription>Cadastre contas a pagar ou a receber com vencimento, competência e status de baixa.</DialogDescription>
          </DialogHeader>

          <form id="finance-entry-form" onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            {formError ? <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 md:col-span-2">{formError}</div> : null}

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Tipo</span>
              <select
                value={formData.type}
                onChange={(event) => setFormData((current) => ({ ...current, type: event.target.value as FinancialEntryType }))}
                className={inputClassName}
              >
                <option value="payable">Conta a pagar</option>
                <option value="receivable">Conta a receber</option>
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Status</span>
              <select
                value={formData.status}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    status: event.target.value as FinancialEntryStatus,
                    paid_amount: event.target.value === 'paid' ? current.paid_amount || current.amount : 0,
                    paid_at: event.target.value === 'paid' ? current.paid_at || todayKey : '',
                  }))
                }
                className={inputClassName}
              >
                <option value="pending">Pendente</option>
                <option value="paid">Baixada</option>
              </select>
            </label>

            <label className="text-sm md:col-span-2">
              <span className="mb-1.5 block font-medium">Descrição</span>
              <input
                value={formData.description}
                onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                className={inputClassName}
                required
              />
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Categoria</span>
              <input
                value={formData.category}
                onChange={(event) => setFormData((current) => ({ ...current, category: event.target.value }))}
                placeholder="Ex.: Financiamento, aluguel"
                list="financial-category-suggestions"
                className={inputClassName}
              />
              <datalist id="financial-category-suggestions">
                {financialCategories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">{isInstallmentCreation ? 'Valor total' : 'Valor'}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.amount || ''}
                onChange={(event) => setFormData((current) => ({ ...current, amount: Number(event.target.value) }))}
                className={inputClassName}
                required
              />
              {isInstallmentCreation ? (
                <span className="mt-1 block text-xs text-muted-foreground">O sistema divide esse total nas parcelas.</span>
              ) : null}
            </label>

            {!editingEntryId ? (
              <>
                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Lançamento</span>
                  <select
                    value={formData.billing_mode}
                    onChange={(event) =>
                      setFormData((current) => ({
                        ...current,
                        billing_mode: event.target.value as EntryFormData['billing_mode'],
                      }))
                    }
                    className={inputClassName}
                  >
                    <option value="single">Único</option>
                    <option value="installments">Parcelado</option>
                    <option value="recurring">Recorrente mensal</option>
                  </select>
                </label>

                {isInstallmentCreation ? (
                  <label className="text-sm">
                    <span className="mb-1.5 block font-medium">Parcelas</span>
                    <input
                      type="number"
                      min="2"
                      max="120"
                      step="1"
                      value={formData.installments_count}
                      onChange={(event) => setFormData((current) => ({ ...current, installments_count: Number(event.target.value) }))}
                      className={inputClassName}
                    />
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Aproximadamente {formatCurrency(installmentPreviewAmount)} por parcela.
                    </span>
                  </label>
                ) : null}

                {isRecurringCreation ? (
                  <label className="text-sm">
                    <span className="mb-1.5 block font-medium">Meses recorrentes</span>
                    <input
                      type="number"
                      min="2"
                      max="120"
                      step="1"
                      value={formData.recurring_months}
                      onChange={(event) => setFormData((current) => ({ ...current, recurring_months: Number(event.target.value) }))}
                      className={inputClassName}
                    />
                    <span className="mt-1 block text-xs text-muted-foreground">Repete a mesma conta mês a mês.</span>
                  </label>
                ) : null}
              </>
            ) : null}

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Vencimento</span>
              <input
                type="date"
                value={formData.due_date}
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    due_date: event.target.value,
                    competence_month: current.competence_month || event.target.value.slice(0, 7),
                  }))
                }
                className={inputClassName}
                required
              />
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Competência</span>
              <input
                type="month"
                value={formData.competence_month}
                onChange={(event) => setFormData((current) => ({ ...current, competence_month: event.target.value }))}
                className={inputClassName}
                required
              />
            </label>

            {formData.status === 'paid' ? (
              <>
                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Valor baixado</span>
                  <input
                    type="number"
                    min="0"
                    max={formData.amount || undefined}
                    step="0.01"
                    value={formData.paid_amount || ''}
                    onChange={(event) => setFormData((current) => ({ ...current, paid_amount: Number(event.target.value) }))}
                    className={inputClassName}
                  />
                </label>

                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Data da baixa</span>
                  <input
                    type="date"
                    value={formData.paid_at}
                    onChange={(event) => setFormData((current) => ({ ...current, paid_at: event.target.value }))}
                    className={inputClassName}
                  />
                </label>
              </>
            ) : null}

            <label className="text-sm md:col-span-2">
              <span className="mb-1.5 block font-medium">Observações</span>
              <textarea
                value={formData.notes}
                onChange={(event) => setFormData((current) => ({ ...current, notes: event.target.value }))}
                className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              />
            </label>
          </form>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleFormDialogChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" form="finance-entry-form" disabled={isSubmitting}>
              {isSubmitting ? 'Salvando...' : editingEntryId ? 'Salvar alterações' : 'Salvar conta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isPaymentDialogOpen} onOpenChange={handlePaymentDialogChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dar baixa</DialogTitle>
            <DialogDescription>
              Informe o valor pago ou recebido para atualizar a conta.
            </DialogDescription>
          </DialogHeader>

          {paymentEntry ? (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p className="font-medium text-foreground">{paymentEntry.description}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <div>
                    <span className="block text-xs text-muted-foreground">Total</span>
                    <strong>{formatCurrency(paymentEntry.amount)}</strong>
                  </div>
                  <div>
                    <span className="block text-xs text-muted-foreground">Já baixado</span>
                    <strong>{formatCurrency(paymentPaidAmount)}</strong>
                  </div>
                  <div>
                    <span className="block text-xs text-muted-foreground">Em aberto</span>
                    <strong>{formatCurrency(paymentRemainingAmount)}</strong>
                  </div>
                </div>
              </div>

              {paymentError ? <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{paymentError}</div> : null}

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Valor desta baixa</span>
                  <input
                    type="number"
                    min="0.01"
                    max={paymentRemainingAmount || undefined}
                    step="0.01"
                    value={paymentAmount || ''}
                    onChange={(event) => setPaymentAmount(Number(event.target.value))}
                    className={inputClassName}
                  />
                </label>

                <Button type="button" variant="outline" onClick={() => setPaymentAmount(paymentRemainingAmount)} disabled={paymentRemainingAmount <= 0}>
                  Pagar total
                </Button>
              </div>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Data da baixa</span>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                  className={inputClassName}
                />
              </label>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handlePaymentDialogChange(false)} disabled={isPaymentSubmitting}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handlePaymentSubmit()} disabled={isPaymentSubmitting || !paymentEntry}>
              {isPaymentSubmitting ? 'Baixando...' : 'Confirmar baixa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
