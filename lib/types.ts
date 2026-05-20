export type UserRole = 'admin' | 'technician'
export type TechnicianStatus = 'active' | 'inactive'
export type DiscountType = 'discount' | 'advance' | 'other'
export type ScheduleStatus = 'scheduled' | 'completed' | 'cancelled'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  technician_id?: string
}

export interface Technician {
  id: string
  user_id?: string
  qra?: string
  name: string
  email?: string
  commission_percentage: number
  base_salary: number
  va_allowance: number
  vr_allowance: number
  status: TechnicianStatus
  created_at: string
  updated_at: string
}

export interface Service {
  id: string
  order_code: string
  technician_id: string
  service_type: string
  value: number
  date_performed: string
  competence_month: string
  description?: string
  created_at: string
  technician_name?: string
}

export interface WorkHours {
  id: string
  technician_id: string
  date: string
  start_time: string
  end_time: string
  hours_worked: number
  week_number?: number
  month?: number
  year?: number
  created_at: string
}

export interface Schedule {
  id: string
  technician_id: string
  date: string
  start_time?: string
  end_time?: string
  status: ScheduleStatus
  notes?: string
  created_at: string
  technician_name?: string
}

export interface Discount {
  id: string
  technician_id: string
  type: DiscountType
  amount: number
  reason?: string
  competence_month: string
  created_at: string
  technician_name?: string
}

export interface Payroll {
  id: string
  technician_id: string
  competence_month: string
  total_services_value: number
  commission_value: number
  base_salary: number
  va_deduction: number
  vr_deduction: number
  discounts_total: number
  advances_total: number
  extra_hours_value: number
  extraordinary_award_value?: number
  hour_bank_balance: number
  net_total: number
  created_at: string
  updated_at: string
  technician_name?: string
}

export interface LibraryDocument {
  id: string
  title: string
  category: string
  audience: string
  updatedAt: string
  type: 'PDF'
  url?: string
  uploadedBy?: string
}

export interface DashboardStats {
  totalTechnicians: number
  activeTechnicians: number
  totalServices: number
  totalServicesValue: number
  pendingSchedules: number
}

export interface TechnicianDashboardData {
  technician: Technician
  currentMonthServices: Service[]
  currentMonthPayroll: Payroll | null
  hoursWorked: WorkHours[]
  upcomingSchedule: Schedule[]
  hourBankBalance: number
}
