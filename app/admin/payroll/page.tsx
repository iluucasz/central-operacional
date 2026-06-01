'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calculator, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CreditCard, Eye, RefreshCw, Save, Search, WalletCards } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatCurrency, monthKeyFromDate, normalizeText } from '@/lib/formatters';
import type { Discount, Payroll, Service, ServiceFortnight, Technician } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

const DEFAULT_BASE_SALARY = 2664.53;
const DEFAULT_VA_ALLOWANCE = 249;
const DEFAULT_VR_ALLOWANCE = 783;
const DEFAULT_COMMISSION_PERCENTAGE = 25;
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

type PayrollDraft = {
  technician_id: string;
  competence_month: string;
  total_services_value: number;
  commission_value: number;
  base_salary: number;
  va_deduction: number;
  vr_deduction: number;
  discounts_total: number;
  advances_total: number;
  extra_hours_value: number;
  extraordinary_award_value: number;
  hour_bank_balance: number;
  net_total: number;
};

type PayrollDraftField = keyof PayrollDraft;

type PayrollRow = {
  technician: Technician;
  payrollItem?: Payroll;
  hasMonthlyActivity: boolean;
  serviceCount: number;
  totalServicesValue: number;
  profitValue: number;
  serviceFortnightSummary: ServiceFortnightSummary;
  commissionPercentage: number;
  baseSalary: number;
  vaAllowance: number;
  vrAllowance: number;
  benefitsTotal: number;
  commission: number;
  discountsTotal: number;
  advancesTotal: number;
  totalDeductions: number;
  extraHoursValue: number;
  extraordinaryAward: number;
  cashNetTotal: number;
  payrollNetTotal: number;
};

type ServiceFortnightBucket = {
  count: number;
  totalValue: number;
};

type ServiceFortnightSummary = {
  Q1: ServiceFortnightBucket;
  Q2: ServiceFortnightBucket;
  unassigned: ServiceFortnightBucket;
};

const commissionFormulaFields: PayrollDraftField[] = [
  'total_services_value',
  'base_salary',
  'vr_deduction',
  'va_deduction',
];

function moneyValue(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function roundMoney(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return 0;

  return Math.round((numericValue + Number.EPSILON) * 100) / 100;
}

function formatMoneyInputValue(value: number) {
  return String(roundMoney(value));
}

function parseMoneyInputValue(value: string, fallbackValue: number) {
  if (!value.trim()) {
    return 0;
  }

  const normalizedValue = value.replace(',', '.');
  const numericValue = Number(normalizedValue);

  if (!Number.isFinite(numericValue)) {
    return roundMoney(fallbackValue);
  }

  return roundMoney(numericValue);
}

function formatCompetenceLabel(value: string) {
  const [year, month] = value.split('-');
  const monthNumber = Number(month);

  if (!year || !month || !monthNames[monthNumber - 1]) {
    return value || 'Sem competência';
  }

  return `${month.padStart(2, '0')}/${year} - ${monthNames[monthNumber - 1]}`;
}

function shiftCompetenceMonth(value: string, monthOffset: number) {
  const [year, month] = value.split('-').map(Number);

  if (!year || !month) {
    return value;
  }

  const shifted = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getServiceCompetence(service: Service) {
  const savedCompetence = String(service.competence_month ?? '').trim();
  if (/^\d{4}-\d{2}$/.test(savedCompetence)) return savedCompetence;

  const datePrefix = String(service.date_performed ?? '').match(/^(\d{4}-\d{2})/);
  if (datePrefix?.[1]) return datePrefix[1];

  const dateMonth = monthKeyFromDate(service.date_performed);
  if (dateMonth) return dateMonth;

  return '';
}

function createServiceFortnightBucket(): ServiceFortnightBucket {
  return {
    count: 0,
    totalValue: 0,
  };
}

function createServiceFortnightSummary(services: Service[]): ServiceFortnightSummary {
  const summary: ServiceFortnightSummary = {
    Q1: createServiceFortnightBucket(),
    Q2: createServiceFortnightBucket(),
    unassigned: createServiceFortnightBucket(),
  };

  services.forEach((service) => {
    const bucket = service.fortnight_period === 'Q1' || service.fortnight_period === 'Q2'
      ? summary[service.fortnight_period as ServiceFortnight]
      : summary.unassigned;

    bucket.count += 1;
    bucket.totalValue = roundMoney(bucket.totalValue + moneyValue(service.value));
  });

  return summary;
}

function formatServiceFortnightCountSummary(summary: ServiceFortnightSummary) {
  const parts: string[] = [];

  if (summary.Q1.count > 0) parts.push(`Q1 ${summary.Q1.count}`);
  if (summary.Q2.count > 0) parts.push(`Q2 ${summary.Q2.count}`);
  if (summary.unassigned.count > 0) parts.push(`Sem quinzena ${summary.unassigned.count}`);

  return parts.join(' | ') || 'Sem OS';
}

function formatServiceFortnightValueSummary(summary: ServiceFortnightSummary) {
  const parts: string[] = [];

  if (summary.Q1.totalValue > 0) parts.push(`Q1 ${formatCurrency(summary.Q1.totalValue)}`);
  if (summary.Q2.totalValue > 0) parts.push(`Q2 ${formatCurrency(summary.Q2.totalValue)}`);
  if (summary.unassigned.totalValue > 0) parts.push(`Sem quinzena ${formatCurrency(summary.unassigned.totalValue)}`);

  return parts.join(' | ') || 'Sem valor';
}

function serviceBelongsToTechnician(service: Service, technician: Technician) {
  if (service.technician_id === technician.id) return true;

  const serviceTechnicianName = normalizeText(service.technician_name);
  return Boolean(serviceTechnicianName && serviceTechnicianName === normalizeText(technician.name));
}

function getBaseSalary(technician: Technician) {
  const savedValue = moneyValue(technician.base_salary);
  return savedValue > 0 ? savedValue : DEFAULT_BASE_SALARY;
}

function getVaAllowance(technician: Technician) {
  const savedValue = moneyValue(technician.va_allowance);
  return savedValue > 0 ? savedValue : DEFAULT_VA_ALLOWANCE;
}

function getVrAllowance(technician: Technician) {
  const savedValue = moneyValue(technician.vr_allowance);
  return savedValue > 0 ? savedValue : DEFAULT_VR_ALLOWANCE;
}

function getCommissionPercentage(technician?: Technician | null) {
  const savedValue = Number(technician?.commission_percentage ?? 0);
  return savedValue > 0 ? savedValue : DEFAULT_COMMISSION_PERCENTAGE;
}

function calculateCalculationBase(totalServicesValue: number, commissionPercentage: number) {
  return roundMoney(Math.max(0, totalServicesValue) * (commissionPercentage / 100));
}

function calculateCommissionRemainder(
  calculationBase: number,
  baseSalary: number,
  vrAllowance: number,
  vaAllowance: number,
) {
  return roundMoney(
    Math.max(
      0,
      moneyValue(calculationBase) -
        moneyValue(baseSalary) -
        moneyValue(vrAllowance) -
        moneyValue(vaAllowance),
    ),
  );
}

function convertCalculationBaseToTotalServices(calculationBase: number, commissionPercentage: number) {
  if (commissionPercentage <= 0) {
    return roundMoney(calculationBase);
  }

  return roundMoney((Math.max(0, calculationBase) * 100) / commissionPercentage);
}

function calculateEstimatedAward(serviceCount: number) {
  if (serviceCount >= 160) return 600;
  if (serviceCount >= 80) return 250;
  return 0;
}

function calculateFormulaCommission(draft: PayrollDraft, commissionPercentage: number) {
  return calculateCommissionRemainder(
    calculateCalculationBase(moneyValue(draft.total_services_value), commissionPercentage),
    moneyValue(draft.base_salary),
    moneyValue(draft.vr_deduction),
    moneyValue(draft.va_deduction),
  );
}

function calculateCashNet(draft: PayrollDraft) {
  return roundMoney(
    moneyValue(draft.base_salary) +
      moneyValue(draft.commission_value) +
      moneyValue(draft.extra_hours_value) +
      moneyValue(draft.extraordinary_award_value) -
      moneyValue(draft.discounts_total) -
      moneyValue(draft.advances_total),
  );
}

function calculateBenefitTotal(draft: PayrollDraft) {
  return roundMoney(moneyValue(draft.va_deduction) + moneyValue(draft.vr_deduction));
}

function calculatePayrollNet(draft: PayrollDraft) {
  return roundMoney(moneyValue(draft.net_total) + calculateBenefitTotal(draft));
}

function normalizeDraft(payroll: Partial<PayrollDraft>): PayrollDraft {
  const draft: PayrollDraft = {
    technician_id: payroll.technician_id || '',
    competence_month: payroll.competence_month || '',
    total_services_value: roundMoney(payroll.total_services_value),
    commission_value: roundMoney(payroll.commission_value),
    base_salary: roundMoney(payroll.base_salary),
    va_deduction: roundMoney(payroll.va_deduction),
    vr_deduction: roundMoney(payroll.vr_deduction),
    discounts_total: roundMoney(payroll.discounts_total),
    advances_total: roundMoney(payroll.advances_total),
    extra_hours_value: roundMoney(payroll.extra_hours_value),
    extraordinary_award_value: roundMoney(payroll.extraordinary_award_value),
    hour_bank_balance: roundMoney(payroll.hour_bank_balance),
    net_total: roundMoney(payroll.net_total),
  };

  return {
    ...draft,
    net_total: payroll.net_total === undefined || payroll.net_total === null ? calculateCashNet(draft) : roundMoney(payroll.net_total),
  };
}

function createDraftFromRow(row: PayrollRow, competenceMonth: string) {
  return normalizeDraft({
    technician_id: row.technician.id,
    competence_month: competenceMonth,
    total_services_value: row.totalServicesValue,
    commission_value: row.commission,
    base_salary: row.baseSalary,
    va_deduction: row.vaAllowance,
    vr_deduction: row.vrAllowance,
    discounts_total: row.discountsTotal,
    advances_total: row.advancesTotal,
    extra_hours_value: row.extraHoursValue,
    extraordinary_award_value: row.extraordinaryAward,
    hour_bank_balance: 0,
    net_total: row.cashNetTotal,
  });
}

function MoneyInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  const [draftValue, setDraftValue] = useState(() => formatMoneyInputValue(value));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(formatMoneyInputValue(value));
    }
  }, [isEditing, value]);

  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
      <input
        type="number"
        step="0.01"
        inputMode="decimal"
        value={isEditing ? draftValue : formatMoneyInputValue(value)}
        onFocus={() => setIsEditing(true)}
        onChange={(event) => {
          const nextValue = event.target.value;
          setDraftValue(nextValue);

          if (!nextValue.trim()) {
            onChange(0);
            return;
          }

          onChange(parseMoneyInputValue(nextValue, value));
        }}
        onBlur={() => {
          const normalizedValue = parseMoneyInputValue(draftValue, value);
          setIsEditing(false);
          setDraftValue(formatMoneyInputValue(normalizedValue));
          onChange(normalizedValue);
        }}
        className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Ajuda"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold text-muted-foreground transition hover:border-primary hover:text-foreground"
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-xs px-3 py-2 text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export default function PayrollPage() {
  const { user, loading } = useAppSession();
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [query, setQuery] = useState('');
  const [openingTechnicianId, setOpeningTechnicianId] = useState('');
  const [competenceMonth, setCompetenceMonth] = useState(new Date().toISOString().slice(0, 7));
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [selectedRow, setSelectedRow] = useState<PayrollRow | null>(null);
  const [isPayrollDialogOpen, setIsPayrollDialogOpen] = useState(false);
  const [payrollDraft, setPayrollDraft] = useState<PayrollDraft | null>(null);
  const [draftError, setDraftError] = useState('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      const [payrollResult, techniciansResult, servicesResult, discountsResult] = await Promise.allSettled([
        fetch(`/api/payroll?competenceMonth=${competenceMonth}`),
        fetch('/api/technicians'),
        fetch(`/api/services?competenceMonth=${competenceMonth}`),
        fetch(`/api/discounts?competenceMonth=${competenceMonth}`),
      ]);
      const errors: string[] = [];

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

      if (discountsResult.status === 'fulfilled' && discountsResult.value.ok) {
        const data = await discountsResult.value.json();
        if (mounted) setDiscounts(Array.isArray(data.discounts) ? data.discounts : []);
      } else {
        errors.push('descontos');
        if (mounted) setDiscounts([]);
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
  }, [competenceMonth, user]);

  const rows = useMemo<PayrollRow[]>(() => {
    return technicians.map((technician) => {
      const payrollItem = payroll.find(
        (item) => item.technician_id === technician.id && item.competence_month === competenceMonth,
      );
      const technicianServices = services.filter(
        (service) => serviceBelongsToTechnician(service, technician) && getServiceCompetence(service) === competenceMonth,
      );
      const technicianDiscounts = discounts.filter(
        (discount) => discount.technician_id === technician.id && discount.competence_month === competenceMonth,
      );
      const hasMonthlyActivity = Boolean(payrollItem || technicianServices.length > 0 || technicianDiscounts.length > 0);
      const serviceFortnightSummary = createServiceFortnightSummary(technicianServices);
      const servicesTotal = roundMoney(technicianServices.reduce((total, service) => total + moneyValue(service.value), 0));
      const serviceCount = technicianServices.length;
      const totalServicesValue = roundMoney(servicesTotal || payrollItem?.total_services_value);
      const commissionPercentage = getCommissionPercentage(technician);
      const baseSalary = roundMoney(payrollItem ? payrollItem.base_salary : getBaseSalary(technician));
      const vaAllowance = roundMoney(payrollItem ? payrollItem.va_deduction : getVaAllowance(technician));
      const vrAllowance = roundMoney(payrollItem ? payrollItem.vr_deduction : getVrAllowance(technician));
      const benefitsTotal = roundMoney(vaAllowance + vrAllowance);
      const calculationBase = calculateCalculationBase(totalServicesValue, commissionPercentage);
      const commission = payrollItem
        ? roundMoney(payrollItem.commission_value)
        : calculateCommissionRemainder(calculationBase, baseSalary, vrAllowance, vaAllowance);
      const discountsTotal = payrollItem
        ? roundMoney(payrollItem.discounts_total)
        : roundMoney(technicianDiscounts
            .filter((discount) => discount.type === 'discount' || discount.type === 'other')
            .reduce((total, discount) => total + moneyValue(discount.amount), 0));
      const advancesTotal = payrollItem
        ? roundMoney(payrollItem.advances_total)
        : roundMoney(technicianDiscounts
            .filter((discount) => discount.type === 'advance')
            .reduce((total, discount) => total + moneyValue(discount.amount), 0));
      const totalDeductions = roundMoney(discountsTotal + advancesTotal);
      const extraHoursValue = roundMoney(payrollItem?.extra_hours_value);
      const extraordinaryAward = payrollItem
        ? roundMoney(payrollItem.extraordinary_award_value)
        : calculateEstimatedAward(serviceCount);
      const projectedCashNetTotal = payrollItem
        ? roundMoney(payrollItem.net_total)
        : roundMoney(baseSalary + commission + extraHoursValue + extraordinaryAward - totalDeductions);
      const cashNetTotal = hasMonthlyActivity ? projectedCashNetTotal : 0;
      const displayBenefitsTotal = hasMonthlyActivity ? benefitsTotal : 0;
      const displayCommission = hasMonthlyActivity ? commission : 0;
      const displayDiscountsTotal = hasMonthlyActivity ? discountsTotal : 0;
      const displayAdvancesTotal = hasMonthlyActivity ? advancesTotal : 0;
      const displayTotalDeductions = hasMonthlyActivity ? totalDeductions : 0;
      const displayExtraHoursValue = hasMonthlyActivity ? extraHoursValue : 0;
      const displayExtraordinaryAward = hasMonthlyActivity ? extraordinaryAward : 0;

      return {
        technician,
        payrollItem,
        hasMonthlyActivity,
        serviceCount,
        totalServicesValue,
        profitValue: hasMonthlyActivity ? roundMoney(totalServicesValue - roundMoney(cashNetTotal + displayBenefitsTotal)) : 0,
        serviceFortnightSummary,
        commissionPercentage,
        baseSalary,
        vaAllowance,
        vrAllowance,
        benefitsTotal: displayBenefitsTotal,
        commission: displayCommission,
        discountsTotal: displayDiscountsTotal,
        advancesTotal: displayAdvancesTotal,
        totalDeductions: displayTotalDeductions,
        extraHoursValue: displayExtraHoursValue,
        extraordinaryAward: displayExtraordinaryAward,
        cashNetTotal,
        payrollNetTotal: roundMoney(cashNetTotal + displayBenefitsTotal),
      };
    });
  }, [competenceMonth, discounts, payroll, services, technicians]);

  const filteredRows = rows.filter((row) => {
    const haystack = normalizeText(`${row.technician.name} ${row.technician.qra}`);
    return normalizeText(haystack).includes(normalizeText(query));
  });

  const rowsWithMonthlyActivity = rows.filter((row) => row.hasMonthlyActivity);

  const totalCashNet = rowsWithMonthlyActivity.reduce((total, row) => total + row.cashNetTotal, 0);
  const totalBenefits = rowsWithMonthlyActivity.reduce((total, row) => total + row.benefitsTotal, 0);
  const totalPayrollNet = rowsWithMonthlyActivity.reduce((total, row) => total + row.payrollNetTotal, 0);
  const totalServiceCount = rowsWithMonthlyActivity.reduce((total, row) => total + row.serviceCount, 0);
  const totalServicesValue = rowsWithMonthlyActivity.reduce((total, row) => total + row.totalServicesValue, 0);
  const totalProfit = rowsWithMonthlyActivity.reduce((total, row) => total + row.profitValue, 0);
  const closedCount = rowsWithMonthlyActivity.filter((row) => row.payrollItem).length;

  function resetDialogState() {
    setSelectedRow(null);
    setPayrollDraft(null);
    setDraftError('');
    setIsPreviewLoading(false);
    setIsSavingDraft(false);
  }

  function handleDialogOpenChange(open: boolean) {
    setIsPayrollDialogOpen(open);

    if (!open) {
      resetDialogState();
    }
  }

  async function loadPreview(row: PayrollRow) {
    setIsPreviewLoading(true);
    setOpeningTechnicianId(row.technician.id);
    setDraftError('');

    try {
      const response = await fetch('/api/payroll/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technicianId: row.technician.id,
          competenceMonth,
        }),
      });

      if (!response.ok) {
        throw new Error('Preview failed');
      }

      const data = await response.json();
      setPayrollDraft(normalizeDraft(data.payroll));
    } catch {
      setPayrollDraft(createDraftFromRow(row, competenceMonth));
      setDraftError('Não foi possível recalcular automaticamente. Revise os valores carregados antes de finalizar.');
    } finally {
      setIsPreviewLoading(false);
      setOpeningTechnicianId('');
    }
  }

  async function openPayrollDialog(row: PayrollRow) {
    setSelectedRow(row);
    setIsPayrollDialogOpen(true);
    setDraftError('');
    setPayrollDraft(row.payrollItem ? normalizeDraft(row.payrollItem) : null);
    await loadPreview(row);
  }

  function updateCalculationBase(value: number) {
    const commissionPercentage = selectedRow?.commissionPercentage ?? DEFAULT_COMMISSION_PERCENTAGE;
    updateDraftNumber('total_services_value', convertCalculationBaseToTotalServices(value, commissionPercentage));
  }

  function updateDraftNumber(field: PayrollDraftField, value: number) {
    setPayrollDraft((current) => {
      if (!current) return current;

      const commissionPercentage = selectedRow?.commissionPercentage ?? DEFAULT_COMMISSION_PERCENTAGE;

      const next = {
        ...current,
        [field]: roundMoney(value),
      };

      if (commissionFormulaFields.includes(field)) {
        next.commission_value = calculateFormulaCommission(next, commissionPercentage);
      }

      if (field !== 'net_total') {
        next.net_total = calculateCashNet(next);
      }

      return next;
    });
  }

  function applyCommissionFormula() {
    setPayrollDraft((current) => {
      if (!current) return current;
      const commissionPercentage = selectedRow?.commissionPercentage ?? DEFAULT_COMMISSION_PERCENTAGE;
      const next = {
        ...current,
        commission_value: calculateFormulaCommission(current, commissionPercentage),
      };

      return {
        ...next,
        net_total: calculateCashNet(next),
      };
    });
  }

  async function savePayrollDraft() {
    if (!payrollDraft) return;

    setIsSavingDraft(true);
    setDraftError('');

    try {
      const response = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizeDraft(payrollDraft)),
      });

      if (!response.ok) {
        throw new Error('Save failed');
      }

      const savedPayroll = (await response.json()) as Payroll;
      setPayroll((current) => {
        const others = current.filter(
          (item) =>
            item.technician_id !== savedPayroll.technician_id ||
            item.competence_month !== savedPayroll.competence_month,
        );

        return [savedPayroll, ...others];
      });
      setIsPayrollDialogOpen(false);
      resetDialogState();
    } catch {
      setDraftError('Não foi possível salvar o cálculo. Confira os valores e tente novamente.');
    } finally {
      setIsSavingDraft(false);
    }
  }

  const currentCommissionPercentage = selectedRow?.commissionPercentage ?? DEFAULT_COMMISSION_PERCENTAGE;
  const formulaCommission = payrollDraft ? calculateFormulaCommission(payrollDraft, currentCommissionPercentage) : 0;
  const formulaCashNet = payrollDraft ? calculateCashNet(payrollDraft) : 0;
  const previewPayrollNet = payrollDraft ? calculatePayrollNet(payrollDraft) : 0;
  const previewProfit = payrollDraft ? roundMoney(payrollDraft.total_services_value - previewPayrollNet) : 0;
  const hasSavedPayroll = Boolean(selectedRow?.payrollItem);
  const hasManualNetAdjustment = payrollDraft ? roundMoney(payrollDraft.net_total) !== roundMoney(formulaCashNet) : false;

  if (loading || isDataLoading || !user) {
    return <LoadingState />;
  }

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Fechamento"
        title="Folha de pagamento"
        description="Escolha a competência, abra a prévia do técnico, revise o resultado e salve somente quando estiver certo."
      />

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      <div className="mb-4 grid gap-3 xl:grid-cols-7">
        <MetricCard title="Em conta" value={formatCurrency(totalCashNet)} hint="Pagamento corrente" icon={WalletCards} tone="success" />
        <MetricCard title="Cartões" value={formatCurrency(totalBenefits)} hint="VR + VA" icon={CreditCard} />
        <MetricCard title="Líquido da folha" value={formatCurrency(totalPayrollNet)} hint="Em conta + cartões" icon={Calculator} tone="success" />
        <MetricCard title="OS" value={totalServiceCount} hint="Ordens do mês" icon={Calculator} />
        <MetricCard title="Valor bruto" value={formatCurrency(totalServicesValue)} hint="Produção do mês" icon={Calculator} />
        <MetricCard title="Lucro gerado" value={formatCurrency(totalProfit)} hint="Valor bruto - folha total" icon={WalletCards} tone={totalProfit >= 0 ? 'success' : 'danger'} accentText />
        <MetricCard title="Finalizados" value={`${closedCount}/${rowsWithMonthlyActivity.length}`} hint="Cálculos salvos com movimento" icon={WalletCards} />
      </div>

      <DataPanel
        title="Competência do fechamento"
        description="Troque a competência para navegar pelo fechamento. A visão soma apenas técnicos com movimento real ou cálculo salvo no mês." 
        className="mb-4"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
          <section className="rounded-2xl border border-border bg-muted/20 p-4 sm:p-5">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Competência ativa</p>
                <h3 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">{formatCompetenceLabel(competenceMonth)}</h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Use os botões laterais ou selecione o mês diretamente. A tabela e os cards são recalculados imediatamente para a competência escolhida.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-stretch">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setCompetenceMonth((current) => shiftCompetenceMonth(current, -1))}
                  aria-label="Competência anterior"
                  className="h-12 w-full sm:w-12"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>

                <label className="flex min-w-0 flex-col rounded-2xl border border-border bg-background px-4 py-3 shadow-sm">
                  <span className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    Mês de referência
                  </span>
                  <input
                    type="month"
                    value={competenceMonth}
                    onChange={(event) => setCompetenceMonth(event.target.value)}
                    className="mt-2 w-full bg-transparent text-xl font-semibold outline-none scheme-light"
                  />
                </label>

                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setCompetenceMonth((current) => shiftCompetenceMonth(current, 1))}
                  aria-label="Próxima competência"
                  className="h-12 w-full sm:w-12"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
              <span className="text-xs font-medium uppercase text-muted-foreground">Movimento do mês</span>
              <div className="mt-2 text-2xl font-semibold text-foreground">{rowsWithMonthlyActivity.length}</div>
              <p className="mt-1 text-sm text-muted-foreground">Técnicos com OS, desconto ou cálculo salvo nesta competência.</p>
            </div>
            <div className="rounded-2xl border border-border bg-background p-4 shadow-sm">
              <span className="text-xs font-medium uppercase text-muted-foreground">Leitura da tela</span>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Quando o mês não tiver movimento, os cards ficam zerados. Os técnicos continuam visíveis na tabela, mas aparecem como sem movimento até existir lançamento real.
              </p>
            </div>
          </div>
        </div>
      </DataPanel>

      {!rowsWithMonthlyActivity.length ? (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
          Esta competência ainda não tem movimento real. Enquanto não houver OS, desconto ou cálculo salvo, os totais do topo ficam zerados.
        </div>
      ) : null}

      <DataPanel
        title="Fechamento por técnico"
        description="A tabela mostra o resumo do mês com o breakdown de Q1 e Q2. Abra o cálculo para ver a prévia, revisar os valores e salvar o fechamento."
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
                <th className="py-3 pr-4 font-medium">Valor bruto</th>
                <th className="py-3 pr-4 font-medium">Comissão</th>
                <th className="py-3 pr-4 font-medium">Descontos</th>
                <th className="py-3 pr-4 font-medium">Em conta</th>
                <th className="py-3 pr-4 font-medium">Líquido da folha</th>
                <th className="py-3 pr-4 font-medium">LUCRO GERADO</th>
                <th className="py-3 pr-4 font-medium">Status</th>
                <th className="py-3 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.technician.id} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4">
                    <div className="font-medium">{row.technician.name}</div>
                    {row.technician.qra ? <div className="text-xs text-muted-foreground">{row.technician.qra}</div> : null}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{row.serviceCount}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.hasMonthlyActivity ? formatServiceFortnightCountSummary(row.serviceFortnightSummary) : 'Sem movimento na competência'}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{formatCurrency(row.totalServicesValue)}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.hasMonthlyActivity ? formatServiceFortnightValueSummary(row.serviceFortnightSummary) : 'Sem valor lançado'}
                    </div>
                  </td>
                  <td className="py-3 pr-4">{row.hasMonthlyActivity ? formatCurrency(row.commission) : '-'}</td>
                  <td className="py-3 pr-4">{row.hasMonthlyActivity ? formatCurrency(row.totalDeductions) : '-'}</td>
                  <td className="py-3 pr-4 font-semibold">{row.hasMonthlyActivity ? formatCurrency(row.cashNetTotal) : '-'}</td>
                  <td className="py-3 pr-4 font-semibold">{row.hasMonthlyActivity ? formatCurrency(row.payrollNetTotal) : '-'}</td>
                  <td className={`py-3 pr-4 font-semibold ${row.profitValue >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {row.hasMonthlyActivity ? formatCurrency(row.profitValue) : '-'}
                  </td>
                  <td className="py-3 pr-4">
                    {row.payrollItem ? (
                      <StatusBadge tone="success">Cálculo salvo</StatusBadge>
                    ) : row.hasMonthlyActivity ? (
                      <StatusBadge tone="warning">Não salvo</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">Sem movimento</StatusBadge>
                    )}
                  </td>
                  <td className="py-3">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => openPayrollDialog(row)}
                      disabled={openingTechnicianId === row.technician.id}
                    >
                      {row.payrollItem ? <Eye className="h-4 w-4" /> : <Calculator className="h-4 w-4" />}
                      {openingTechnicianId === row.technician.id ? 'Carregando' : row.payrollItem ? 'Revisar' : 'Abrir cálculo'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataPanel>

      <Dialog open={isPayrollDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="flex h-auto max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl">
          <DialogHeader className="shrink-0 border-b border-border p-4 pb-3 sm:p-6 sm:pb-4">
            <DialogTitle>{hasSavedPayroll ? 'Revisão do cálculo salvo' : 'Prévia do cálculo'}</DialogTitle>
            <DialogDescription>
              {selectedRow ? `${selectedRow.technician.name} - competência ${formatCompetenceLabel(competenceMonth)}` : 'Abra a prévia, revise e salve quando estiver certo.'}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {draftError ? <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{draftError}</div> : null}
            {selectedRow && selectedRow.serviceCount === 0 ? (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Existem OS cadastradas em Serviços, mas nenhuma está vinculada a este técnico nesta competência. Confira o técnico e a data da OS.
              </div>
            ) : null}

            {isPreviewLoading && !payrollDraft ? (
              <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">Calculando valores...</div>
            ) : null}

            {payrollDraft ? (
              <div className="space-y-5">
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">Resumo</h3>
                    <HelpTip text="Esses números já foram calculados automaticamente. Eles só ficam gravados na folha quando você clicar em salvar." />
                    <StatusBadge tone={hasSavedPayroll ? 'success' : 'warning'}>
                      {hasSavedPayroll ? 'Salvo' : 'Não salvo'}
                    </StatusBadge>
                    <StatusBadge tone={hasManualNetAdjustment ? 'warning' : 'info'}>
                      {hasManualNetAdjustment ? 'Ajuste manual' : 'Fórmula'}
                    </StatusBadge>
                    <StatusBadge tone="info">{currentCommissionPercentage}% bruto</StatusBadge>
                    {selectedRow ? <StatusBadge tone="info">{selectedRow.serviceCount} OS</StatusBadge> : null}
                    {selectedRow ? <StatusBadge tone="info">Q1 {selectedRow.serviceFortnightSummary.Q1.count}</StatusBadge> : null}
                    {selectedRow ? <StatusBadge tone="info">Q2 {selectedRow.serviceFortnightSummary.Q2.count}</StatusBadge> : null}
                    {selectedRow && selectedRow.serviceFortnightSummary.unassigned.count > 0 ? (
                      <StatusBadge tone="warning">Sem quinzena {selectedRow.serviceFortnightSummary.unassigned.count}</StatusBadge>
                    ) : null}
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-xs uppercase text-muted-foreground">Bruto</div>
                      <div className="mt-1 text-lg font-semibold">{formatCurrency(payrollDraft.total_services_value)}</div>
                    </div>
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-xs uppercase text-muted-foreground">Comissão</div>
                      <div className="mt-1 text-lg font-semibold">{formatCurrency(formulaCommission)}</div>
                    </div>
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-xs uppercase text-muted-foreground">Em conta</div>
                      <div className="mt-1 text-lg font-semibold">{formatCurrency(payrollDraft.net_total)}</div>
                    </div>
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-xs uppercase text-muted-foreground">Folha total</div>
                      <div className="mt-1 text-lg font-semibold">{formatCurrency(previewPayrollNet)}</div>
                    </div>
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-xs uppercase text-muted-foreground">LUCRO GERADO</div>
                      <div className={`mt-1 text-lg font-semibold ${previewProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatCurrency(previewProfit)}</div>
                    </div>
                  </div>
                </div>

                <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-4">
                  <section className="rounded-md border border-border p-4">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">1. Comissão</h3>
                          <HelpTip text="Os 25% do bruto formam a base do técnico. A comissão é o que sobra depois de abater salário base, VR e VA." />
                        </div>
                        {selectedRow ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {selectedRow.serviceCount} OS | {formatServiceFortnightCountSummary(selectedRow.serviceFortnightSummary)} | {formatServiceFortnightValueSummary(selectedRow.serviceFortnightSummary)}
                          </p>
                        ) : null}
                      </div>
                      <Button type="button" variant="secondary" size="sm" onClick={applyCommissionFormula} className="shrink-0">
                        <RefreshCw className="h-4 w-4" />
                        Atualizar
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      <MoneyInput
                        label="Base do cálculo"
                        value={calculateCalculationBase(payrollDraft.total_services_value, selectedRow?.commissionPercentage ?? DEFAULT_COMMISSION_PERCENTAGE)}
                        onChange={updateCalculationBase}
                        hint={`${selectedRow?.commissionPercentage ?? DEFAULT_COMMISSION_PERCENTAGE}% do total bruto (${formatCurrency(payrollDraft.total_services_value)})`}
                      />
                      <MoneyInput
                        label="Comissão"
                        value={payrollDraft.commission_value}
                        onChange={(value) => updateDraftNumber('commission_value', value)}
                        hint="Base do cálculo - salário base - VR - VA"
                      />
                    </div>
                  </section>

                  <section className="rounded-md border border-border p-4">
                    <div className="mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">2. Fixo e benefícios</h3>
                        <HelpTip text="Salário base, VR e VA entram como abatimento da base dos 25%. VR e VA continuam aparecendo no total da folha porque são pagos no cartão." />
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <MoneyInput label="Salário base" value={payrollDraft.base_salary} onChange={(value) => updateDraftNumber('base_salary', value)} />
                      <MoneyInput label="Vale-refeição" value={payrollDraft.vr_deduction} onChange={(value) => updateDraftNumber('vr_deduction', value)} />
                      <MoneyInput label="Vale-alimentação" value={payrollDraft.va_deduction} onChange={(value) => updateDraftNumber('va_deduction', value)} />
                    </div>
                  </section>

                  <section className="rounded-md border border-border p-4">
                    <div className="mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">3. Acréscimos</h3>
                        <HelpTip text="Horas extras e prêmio extraordinário aumentam o valor pago em conta. Banco de horas é apenas informativo neste bloco." />
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <MoneyInput label="Horas extras" value={payrollDraft.extra_hours_value} onChange={(value) => updateDraftNumber('extra_hours_value', value)} />
                      <MoneyInput label="Prêmio extraordinário" value={payrollDraft.extraordinary_award_value} onChange={(value) => updateDraftNumber('extraordinary_award_value', value)} />
                      <MoneyInput label="Banco de horas" value={payrollDraft.hour_bank_balance} onChange={(value) => updateDraftNumber('hour_bank_balance', value)} />
                    </div>
                  </section>

                  <section className="rounded-md border border-border p-4">
                    <div className="mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">4. Descontos e pagamento</h3>
                        <HelpTip text="Descontos de folha e adiantamentos reduzem o valor em conta. Se necessário, você pode ajustar o valor final manualmente antes de salvar." />
                      </div>
                    </div>
                    <div className="grid gap-3">
                      <MoneyInput label="Descontos de folha" value={payrollDraft.discounts_total} onChange={(value) => updateDraftNumber('discounts_total', value)} />
                      <MoneyInput label="Adiantamento" value={payrollDraft.advances_total} onChange={(value) => updateDraftNumber('advances_total', value)} />
                      <MoneyInput label="Valor em conta a pagar" value={payrollDraft.net_total} onChange={(value) => updateDraftNumber('net_total', value)} />
                    </div>
                  </section>
                </div>

                <div className="rounded-md border border-border bg-muted/25 p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">Resumo em conta</h3>
                    <HelpTip text="A fórmula faz: 25% do bruto - salário base - VR - VA. Depois soma extras e prêmio, e por fim desconta descontos e adiantamentos para chegar no valor em conta." />
                  </div>
                  <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                    <div>
                      <span className="block text-xs uppercase text-muted-foreground">Comissão</span>
                      <strong>{formatCurrency(formulaCommission)}</strong>
                    </div>
                    <div>
                      <span className="block text-xs uppercase text-muted-foreground">Pela fórmula</span>
                      <strong>{formatCurrency(formulaCashNet)}</strong>
                    </div>
                    <div>
                      <span className="block text-xs uppercase text-muted-foreground">Para salvar</span>
                      <strong>{formatCurrency(payrollDraft.net_total)}</strong>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 border-t border-border p-3 sm:p-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => selectedRow && loadPreview(selectedRow)}
              disabled={!selectedRow || isPreviewLoading || isSavingDraft}
              className="w-full sm:w-auto"
            >
              <RefreshCw className="h-4 w-4" />
              {isPreviewLoading ? 'Atualizando' : 'Atualizar'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => handleDialogOpenChange(false)} disabled={isSavingDraft} className="w-full sm:w-auto">
              Fechar
            </Button>
            <Button type="button" onClick={savePayrollDraft} disabled={!payrollDraft || isSavingDraft || isPreviewLoading} className="w-full sm:w-auto">
              {hasSavedPayroll ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {isSavingDraft ? 'Salvando' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
