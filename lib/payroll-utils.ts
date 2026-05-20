import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const DEFAULT_COMMISSION_PERCENTAGE = 25;
const DEFAULT_BASE_SALARY = 2664;
const DEFAULT_VA_ALLOWANCE = 249;
const DEFAULT_VR_ALLOWANCE = 699.6;
let payrollSchemaReady: Promise<void> | null = null;

export interface PayrollCalculationInput {
  technicianId: string;
  competenceMonth: string; // Format: YYYY-MM
}

export interface PayrollCalculationResult {
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
}

export function ensurePayrollSchema() {
  if (!payrollSchemaReady) {
    payrollSchemaReady = (async () => {
      await sql`
        ALTER TABLE payroll
        ADD COLUMN IF NOT EXISTS extraordinary_award_value NUMERIC(12, 2) NOT NULL DEFAULT 0
      `;
    })().catch((error) => {
      payrollSchemaReady = null;
      throw error;
    });
  }

  return payrollSchemaReady;
}

/**
 * Calculate total value of services for the month
 */
export async function calculateTotalServices(
  technicianId: string,
  competenceMonth: string
): Promise<number> {
  const result = await sql`
    SELECT COALESCE(SUM(value), 0) as total
    FROM services
    WHERE technician_id = ${technicianId}
    AND competence_month = ${competenceMonth}
  `;

  return Number(result[0]?.total || 0);
}

export async function calculateServiceCount(
  technicianId: string,
  competenceMonth: string
): Promise<number> {
  const result = await sql`
    SELECT COUNT(*) as total
    FROM services
    WHERE technician_id = ${technicianId}
    AND competence_month = ${competenceMonth}
  `;

  return Number(result[0]?.total || 0);
}

export function calculateExtraordinaryAward(serviceCount: number): number {
  if (serviceCount >= 160) return 600;
  if (serviceCount >= 80) return 250;
  return 0;
}

/**
 * Calculate commission based on services and commission percentage
 */
export async function calculateCommission(
  technicianId: string,
  competenceMonth: string,
  totalServices: number
): Promise<number> {
  const technician = await sql`
    SELECT commission_percentage, base_salary, va_allowance, vr_allowance
    FROM technicians
    WHERE id = ${technicianId}
  `;

  if (!technician || technician.length === 0) {
    return 0;
  }

  const savedCommissionPercentage = Number(technician[0]?.commission_percentage || 0);
  const commissionPercentage = savedCommissionPercentage > 0 ? savedCommissionPercentage : DEFAULT_COMMISSION_PERCENTAGE;
  const baseSalary = Number(technician[0]?.base_salary || 0);
  const vaAllowance = Number(technician[0]?.va_allowance || 0);
  const vrAllowance = Number(technician[0]?.vr_allowance || 0);
  const targetCompensation = (totalServices * commissionPercentage) / 100;
  const fixedCompensation =
    (baseSalary > 0 ? baseSalary : DEFAULT_BASE_SALARY) +
    (vaAllowance > 0 ? vaAllowance : DEFAULT_VA_ALLOWANCE) +
    (vrAllowance > 0 ? vrAllowance : DEFAULT_VR_ALLOWANCE);

  return Math.max(0, targetCompensation - fixedCompensation);
}

/**
 * Calculate total work hours for the month
 */
export async function calculateTotalHours(
  technicianId: string,
  competenceMonth: string
): Promise<number> {
  const result = await sql`
    SELECT COALESCE(SUM(hours_worked), 0) as total
    FROM work_hours
    WHERE technician_id = ${technicianId}
    AND TO_CHAR(date, 'YYYY-MM') = ${competenceMonth}
  `;

  return Number(result[0]?.total || 0);
}

/**
 * Calculate extra hours and hour bank balance
 * Standard is 8 hours/day * 22 working days = 176 hours/month
 */
export async function calculateHourBank(
  technicianId: string,
  competenceMonth: string,
  totalHours: number
): Promise<{ extra_hours: number; bank_balance: number }> {
  const STANDARD_HOURS_PER_MONTH = 176;

  const extraHours = Math.max(0, totalHours - STANDARD_HOURS_PER_MONTH);

  // Get current bank balance
  const previousMonth = new Date(competenceMonth + '-01');
  previousMonth.setMonth(previousMonth.getMonth() - 1);
  const previousMonthStr = previousMonth.toISOString().slice(0, 7);

  const previousPayroll = await sql`
    SELECT hour_bank_balance
    FROM payroll
    WHERE technician_id = ${technicianId}
    AND competence_month = ${previousMonthStr}
  `;

  const previousBalance = Number(previousPayroll[0]?.hour_bank_balance || 0);
  const newBalance = previousBalance + extraHours;

  return {
    extra_hours: extraHours,
    bank_balance: newBalance,
  };
}

/**
 * Calculate total discounts and advances
 */
export async function calculateDiscounts(
  technicianId: string,
  competenceMonth: string
): Promise<{ discounts_total: number; advances_total: number }> {
  const result = await sql`
    SELECT 
      COALESCE(SUM(CASE WHEN type = 'discount' THEN amount ELSE 0 END), 0) as discounts,
      COALESCE(SUM(CASE WHEN type = 'advance' THEN amount ELSE 0 END), 0) as advances
    FROM discounts
    WHERE technician_id = ${technicianId}
    AND competence_month = ${competenceMonth}
  `;

  return {
    discounts_total: Number(result[0]?.discounts || 0),
    advances_total: Number(result[0]?.advances || 0),
  };
}

/**
 * Get technician allowances
 */
export async function getTechnicianAllowances(
  technicianId: string
): Promise<{ va_allowance: number; vr_allowance: number; base_salary: number }> {
  const result = await sql`
    SELECT base_salary, va_allowance, vr_allowance
    FROM technicians
    WHERE id = ${technicianId}
  `;

  if (!result || result.length === 0) {
    return { va_allowance: 0, vr_allowance: 0, base_salary: 0 };
  }

  const baseSalary = Number(result[0]?.base_salary || 0);
  const vaAllowance = Number(result[0]?.va_allowance || 0);
  const vrAllowance = Number(result[0]?.vr_allowance || 0);

  return {
    base_salary: baseSalary > 0 ? baseSalary : DEFAULT_BASE_SALARY,
    va_allowance: vaAllowance > 0 ? vaAllowance : DEFAULT_VA_ALLOWANCE,
    vr_allowance: vrAllowance > 0 ? vrAllowance : DEFAULT_VR_ALLOWANCE,
  };
}

/**
 * Calculate extra hours value
 * Assuming 1.5x overtime multiplier on hourly rate
 */
export async function calculateExtraHoursValue(
  extraHours: number,
  baseSalary: number
): Promise<number> {
  // Assume 22 working days * 8 hours = 176 hours per month
  const HOURS_PER_MONTH = 176;
  const hourlyRate = baseSalary / HOURS_PER_MONTH;
  const OVERTIME_MULTIPLIER = 1.5;

  return extraHours * hourlyRate * OVERTIME_MULTIPLIER;
}

/**
 * Complete payroll calculation for a technician in a given month
 */
export async function calculatePayroll(
  input: PayrollCalculationInput
): Promise<PayrollCalculationResult> {
  const { technicianId, competenceMonth } = input;

  // Get base info
  const allowances = await getTechnicianAllowances(technicianId);

  // Calculate services and commission
  const totalServices = await calculateTotalServices(technicianId, competenceMonth);
  const serviceCount = await calculateServiceCount(technicianId, competenceMonth);
  const commission = await calculateCommission(technicianId, competenceMonth, totalServices);
  const extraordinaryAward = calculateExtraordinaryAward(serviceCount);

  // Calculate hours
  const totalHours = await calculateTotalHours(technicianId, competenceMonth);
  const { extra_hours, bank_balance } = await calculateHourBank(technicianId, competenceMonth, totalHours);
  const extraHoursValue = await calculateExtraHoursValue(extra_hours, allowances.base_salary);

  // Calculate discounts
  const { discounts_total, advances_total } = await calculateDiscounts(technicianId, competenceMonth);

  // Calculate net total
  const grossTotal =
    allowances.base_salary +
    allowances.va_allowance +
    allowances.vr_allowance +
    commission +
    extraHoursValue +
    extraordinaryAward;

  const netTotal =
    grossTotal -
    discounts_total -
    advances_total;

  return {
    technician_id: technicianId,
    competence_month: competenceMonth,
    total_services_value: totalServices,
    commission_value: commission,
    base_salary: allowances.base_salary,
    va_deduction: allowances.va_allowance,
    vr_deduction: allowances.vr_allowance,
    discounts_total,
    advances_total,
    extra_hours_value: extraHoursValue,
    extraordinary_award_value: extraordinaryAward,
    hour_bank_balance: bank_balance,
    net_total: netTotal,
  };
}
