import { monthKeyFromDate, normalizeCompetenceMonth, resolveCompetenceMonth } from './formatters';
import type { Payroll, WorkHours } from './types';

export const STANDARD_HOURS_PER_MONTH = 220;

function hourValue(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return 0;

  return Math.round((numericValue + Number.EPSILON) * 100) / 100;
}

export function resolveClosedHourBankBalance(
  payroll: Payroll[],
  workHours: WorkHours[],
  technicianId: string | null | undefined,
  competenceMonth: string | null | undefined,
  fallbackBalance: number | string | null | undefined = 0,
) {
  const targetCompetence = normalizeCompetenceMonth(competenceMonth);

  if (!technicianId || !targetCompetence) {
    return hourValue(fallbackBalance);
  }

  const monthlyHours = new Map<string, number>();

  workHours.forEach((item) => {
    if (item.technician_id !== technicianId) return;

    const month = monthKeyFromDate(item.date);
    if (!month) return;

    monthlyHours.set(month, hourValue((monthlyHours.get(month) ?? 0) + hourValue(item.hours_worked)));
  });

  const payrollByMonth = new Map<string, Payroll>();

  payroll.forEach((item) => {
    if (item.technician_id !== technicianId) return;

    const month = resolveCompetenceMonth(item.competence_month);
    if (!month) return;

    payrollByMonth.set(month, item);
  });

  const months = Array.from(new Set([...monthlyHours.keys(), ...payrollByMonth.keys(), targetCompetence])).sort((left, right) =>
    left.localeCompare(right, 'pt-BR'),
  );

  let runningBalance = 0;

  for (const month of months) {
    const workedHours = hourValue(monthlyHours.get(month));
    const calculatedBalance = hourValue(runningBalance + Math.max(0, workedHours - STANDARD_HOURS_PER_MONTH));
    const payrollItem = payrollByMonth.get(month);

    if (payrollItem) {
      const savedBalance = hourValue(payrollItem.hour_bank_balance);

      runningBalance = workedHours > 0 && savedBalance === 0 && calculatedBalance !== 0
        ? calculatedBalance
        : savedBalance;
    } else {
      runningBalance = calculatedBalance;
    }

    if (month === targetCompetence) {
      return runningBalance;
    }
  }

  return hourValue(fallbackBalance);
}