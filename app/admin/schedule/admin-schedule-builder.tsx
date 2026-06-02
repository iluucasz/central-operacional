'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, Plus, Search, Trash2, Users, WandSparkles } from 'lucide-react';
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
import { formatDate, formatHours, formatTimeRange, normalizeText } from '@/lib/formatters';
import {
  createDateKey,
  enumerateDateKeys,
  getScheduleGenerationPreview,
  getScheduleRange,
  normalizeDateKey,
  normalizeTechnicianIds,
  type ScheduleDayRuleKey,
  type ScheduleGenerationInput,
  type SchedulePeriodMode,
  type ScheduleRecurringRuleInput,
  type ScheduleRotationGroupInput,
  type WeekendCoverageMode,
  type WeekendCoverageRule,
  type WeekendRotationCadence,
} from '@/lib/schedule-planner';
import type { Schedule, Technician } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

interface DayOffDraft {
  id: string;
  date: string;
  notes: string;
}

interface OverrideDraft {
  id: string;
  technician_id: string;
  date: string;
  status: Schedule['status'];
  start_time: string;
  end_time: string;
  notes: string;
}

interface RotationGroupDraft extends ScheduleRotationGroupInput {
  id: string;
}

interface CoverageGroupDraft {
  id: string;
  name: string;
  technician_ids: string[];
}

interface RecurringRuleDraft extends ScheduleRecurringRuleInput {
  id: string;
}

interface ScheduleBuilderForm {
  period_mode: SchedulePeriodMode;
  year: number;
  month: number;
  date: string;
  technician_scope: 'all' | 'selected';
  technician_ids: string[];
  weekday_start_time: string;
  weekday_end_time: string;
  weekend_start_time: string;
  weekend_end_time: string;
  day_rules: Record<ScheduleDayRuleKey, WeekendCoverageRule>;
  groups: CoverageGroupDraft[];
  day_rule_group_ids: Record<ScheduleDayRuleKey, string>;
  rotation_groups: RotationGroupDraft[];
  recurring_rules: RecurringRuleDraft[];
  general_days_off: DayOffDraft[];
  overrides: OverrideDraft[];
}

type AttendanceStatus = 'not_marked' | 'worked' | 'day_off' | 'missed' | 'justified';
type AttendanceMode = 'day' | 'month';

interface AttendanceDraft {
  key: string;
  date: string;
  technician_id: string;
  technician_name: string;
  attendance_status: AttendanceStatus;
  planned_start_time: string;
  planned_end_time: string;
  planned_hours: number;
  actual_start_time: string;
  actual_end_time: string;
  schedule_status?: Schedule['status'];
}

interface SchedulePageData {
  schedule: Schedule[];
  technicians: Technician[];
  error: string;
}

interface TechnicianChecklistProps {
  technicians: Technician[];
  value: string[];
  onToggle: (technicianId: string) => void;
  emptyLabel: string;
}

interface DayKeyChecklistProps {
  value: ScheduleDayRuleKey[];
  onToggle: (dayKey: ScheduleDayRuleKey) => void;
}

interface DayRuleEditorProps {
  label: string;
  dayLabel: string;
  rule: WeekendCoverageRule;
  technicians: Technician[];
  selectionLabel?: string;
  fallbackStartTime: string;
  fallbackEndTime: string;
  onModeChange: (mode: WeekendCoverageMode) => void;
  onCadenceChange: (cadence: WeekendRotationCadence) => void;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  onSetTechnicians: (technicianIds: string[]) => void;
  onConfigureTechnicians: () => void;
  inputClassName: string;
}

type ScheduleBuilderDialog = 'scope' | 'groups' | 'recurring' | 'rotation' | 'general-days-off' | 'overrides' | null;

interface BuilderActionCardProps {
  eyebrow: string;
  title: string;
  value: string;
  buttonLabel?: string;
  onClick: () => void;
}

interface RotationPreviewRow {
  date: string;
  dayLabel: string;
  workerNames: string[];
}

const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const weekdayLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const DEFAULT_START_TIME = '08:00';
const DEFAULT_END_TIME = '17:00';
const DAILY_BREAK_HOURS = 1;
const dayRuleDefinitions: Array<{ key: ScheduleDayRuleKey; label: string; dayLabel: string }> = [
  { key: 'monday', label: 'Segunda', dayLabel: 'segunda-feira' },
  { key: 'tuesday', label: 'Terça', dayLabel: 'terça-feira' },
  { key: 'wednesday', label: 'Quarta', dayLabel: 'quarta-feira' },
  { key: 'thursday', label: 'Quinta', dayLabel: 'quinta-feira' },
  { key: 'friday', label: 'Sexta', dayLabel: 'sexta-feira' },
  { key: 'saturday', label: 'Sábado', dayLabel: 'sábado' },
  { key: 'sunday', label: 'Domingo', dayLabel: 'domingo' },
];

function createCoverageRule(mode: WeekendCoverageMode): WeekendCoverageRule {
  return {
    mode,
    technician_ids: [],
    rotation_cadence: 'weekly',
    start_time: '',
    end_time: '',
  };
}

function getDayDefinition(dayKey: ScheduleDayRuleKey) {
  return dayRuleDefinitions.find((definition) => definition.key === dayKey);
}

function formatDayKeyList(dayKeys: ScheduleDayRuleKey[]) {
  const labels = dayRuleDefinitions.filter((definition) => dayKeys.includes(definition.key)).map((definition) => definition.label);
  return labels.length ? labels.join(', ') : 'Nenhum dia selecionado';
}

function getDayKeyFromDateKey(dateKey: string): ScheduleDayRuleKey {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  if (day === 1) return 'monday';
  if (day === 2) return 'tuesday';
  if (day === 3) return 'wednesday';
  if (day === 4) return 'thursday';
  if (day === 5) return 'friday';
  if (day === 6) return 'saturday';
  return 'sunday';
}

function getDayLabelFromKey(dayKey: ScheduleDayRuleKey) {
  return dayRuleDefinitions.find((definition) => definition.key === dayKey)?.label ?? dayKey;
}

function createId() {
  return crypto.randomUUID();
}

function createDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function createMonthInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getYearFromDateKey(dateKey: string, fallbackYear: number) {
  const year = Number(dateKey.slice(0, 4));
  return Number.isInteger(year) ? year : fallbackYear;
}

function parseTimeToMinutes(value: string | null | undefined) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  return hours * 60 + minutes;
}

function normalizeTimeInput(value: string | null | undefined, fallback = '') {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;

  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function getHoursBetween(startTime: string | null | undefined, endTime: string | null | undefined) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);

  if (start === null || end === null || end <= start) {
    return 0;
  }

  const grossHours = (end - start) / 60;
  const netHours = grossHours > DAILY_BREAK_HOURS ? grossHours - DAILY_BREAK_HOURS : grossHours;

  return Number(netHours.toFixed(2));
}

function addHoursToTime(startTime: string, hours: number) {
  const start = parseTimeToMinutes(startTime) ?? parseTimeToMinutes(DEFAULT_START_TIME) ?? 0;
  const totalMinutes = Math.max(0, Math.round(start + hours * 60));
  const dayMinutes = totalMinutes % (24 * 60);

  return `${String(Math.floor(dayMinutes / 60)).padStart(2, '0')}:${String(dayMinutes % 60).padStart(2, '0')}`;
}

function getIsoWeekNumber(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function isAttendanceSelected(draft: AttendanceDraft) {
  return draft.attendance_status !== 'not_marked';
}

function getAttendanceWorkedHours(draft: AttendanceDraft) {
  if (draft.attendance_status === 'not_marked') return 0;
  if (draft.attendance_status === 'missed') return 0;
  if (draft.attendance_status === 'day_off') return draft.planned_hours;
  if (draft.attendance_status === 'justified') return draft.planned_hours;

  return getHoursBetween(draft.actual_start_time, draft.actual_end_time);
}

function getAttendanceBalance(draft: AttendanceDraft) {
  if (!isAttendanceSelected(draft)) return 0;
  if (draft.attendance_status === 'day_off' || draft.attendance_status === 'justified') return 0;

  return getAttendanceWorkedHours(draft) - draft.planned_hours;
}

function getAttendanceResultLabel(draft: AttendanceDraft, hoursWorked: number) {
  if (draft.attendance_status === 'day_off') return 'Folgou';
  if (draft.attendance_status === 'justified') return 'Justificado';
  if (draft.attendance_status === 'missed') return 'Faltou';

  return `Realizado: ${formatHours(hoursWorked)}`;
}

function getAttendanceStatusFromSchedule(entry?: Schedule): AttendanceStatus {
  if (!entry) {
    return 'not_marked';
  }

  if (entry.status === 'cancelled') {
    return 'day_off';
  }

  return 'worked';
}

function createInitialBuilderForm(): ScheduleBuilderForm {
  const now = new Date();

  return {
    period_mode: 'month',
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    date: createDateInputValue(now),
    technician_scope: 'all',
    technician_ids: [],
    weekday_start_time: DEFAULT_START_TIME,
    weekday_end_time: DEFAULT_END_TIME,
    weekend_start_time: DEFAULT_START_TIME,
    weekend_end_time: DEFAULT_END_TIME,
    day_rules: {
      monday: createCoverageRule('all'),
      tuesday: createCoverageRule('all'),
      wednesday: createCoverageRule('all'),
      thursday: createCoverageRule('all'),
      friday: createCoverageRule('all'),
      saturday: {
        ...createCoverageRule('all'),
        rotation_cadence: 'alternating',
      },
      sunday: createCoverageRule('off'),
    },
    groups: [],
    day_rule_group_ids: {
      monday: '',
      tuesday: '',
      wednesday: '',
      thursday: '',
      friday: '',
      saturday: '',
      sunday: '',
    },
    rotation_groups: [],
    recurring_rules: [],
    general_days_off: [],
    overrides: [],
  };
}

function getStatusLabel(status: Schedule['status']) {
  if (status === 'cancelled') return 'Folga';
  if (status === 'completed') return 'Concluído';
  return 'Escalado';
}

function getStatusTone(status: Schedule['status']) {
  if (status === 'cancelled') return 'warning' as const;
  if (status === 'completed') return 'success' as const;
  return 'info' as const;
}

function getSchedulePriority(status: Schedule['status']) {
  if (status === 'scheduled') return 3;
  if (status === 'completed') return 2;
  return 1;
}

function getScheduleTimestamp(entry: Schedule) {
  const timestamp = Date.parse(entry.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getBestScheduleEntry(entries: Schedule[]) {
  return entries.reduce<Schedule | undefined>((best, entry) => {
    if (!best) {
      return entry;
    }

    const entryTimestamp = getScheduleTimestamp(entry);
    const bestTimestamp = getScheduleTimestamp(best);

    if (entryTimestamp > bestTimestamp || (entryTimestamp === bestTimestamp && getSchedulePriority(entry.status) > getSchedulePriority(best.status))) {
      return entry;
    }

    return best;
  }, undefined);
}

function getMonthWeeks(year: number, monthIndex: number) {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstDayOffset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const cells: Array<number | null> = [
    ...Array.from({ length: firstDayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}

function getNextDateKeys(dayCount: number) {
  const start = new Date();
  const result: string[] = [];

  for (let index = 0; index < dayCount; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    result.push(date.toISOString().slice(0, 10));
  }

  return result;
}

function toggleStringValue(values: string[], nextValue: string) {
  return values.includes(nextValue) ? values.filter((value) => value !== nextValue) : [...values, nextValue];
}

function toggleDayKeyValue(values: ScheduleDayRuleKey[], nextValue: ScheduleDayRuleKey): ScheduleDayRuleKey[] {
  return values.includes(nextValue) ? values.filter((value): value is ScheduleDayRuleKey => value !== nextValue) : [...values, nextValue];
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function getRotationTeams(selectedTechnicianIds: string[], availableTechnicianIds: string[]) {
  const firstTeam = normalizeTechnicianIds(selectedTechnicianIds).filter((technicianId) => availableTechnicianIds.includes(technicianId));
  const nextTeam = availableTechnicianIds.filter((technicianId) => !firstTeam.includes(technicianId));

  return {
    firstTeam,
    nextTeam,
  };
}

function getDayRuleLabel(rule: WeekendCoverageRule) {
  if (rule.mode === 'off') return 'Todos Folgam';
  if (rule.mode === 'all') return rule.rotation_cadence === 'alternating' ? 'Todos em dias alternados' : 'Todos trabalham';
  if (rule.mode === 'rotation') {
    return rule.rotation_cadence === 'alternating' ? 'Técnico específico alternado' : 'Técnico específico';
  }

  return rule.rotation_cadence === 'alternating' ? 'Equipe em dias alternados' : 'Equipe selecionada';
}

function buildSuccessMessage(summary: {
  startDate: string;
  endDate: string;
  technicians: number;
  inserted: number;
  preservedCompleted: number;
}) {
  return `Escala salva de ${formatDate(summary.startDate)} até ${formatDate(summary.endDate)} para ${formatCount(summary.technicians, 'técnico', 'técnicos')}. O sistema gravou ${formatCount(summary.inserted, 'linha', 'linhas')} e preservou ${formatCount(summary.preservedCompleted, 'linha concluída', 'linhas concluídas')}.`;
}

async function fetchSchedulePageData(): Promise<SchedulePageData> {
  const [scheduleRes, techniciansRes] = await Promise.allSettled([fetch('/api/schedule'), fetch('/api/technicians')]);
  const errors: string[] = [];
  let schedule: Schedule[] = [];
  let technicians: Technician[] = [];

  if (scheduleRes.status === 'fulfilled' && scheduleRes.value.ok) {
    const data = await scheduleRes.value.json();
    schedule = Array.isArray(data.schedules) ? data.schedules : [];
  } else {
    errors.push('escala');
  }

  if (techniciansRes.status === 'fulfilled' && techniciansRes.value.ok) {
    const data = await techniciansRes.value.json();
    technicians = Array.isArray(data.technicians) ? data.technicians : [];
  } else {
    errors.push('técnicos');
  }

  return {
    schedule,
    technicians,
    error: errors.length ? `Não foi possível carregar dados reais de ${errors.join(', ')}.` : '',
  };
}

function TechnicianChecklist({ technicians, value, onToggle, emptyLabel }: TechnicianChecklistProps) {
  if (!technicians.length) {
    return <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="grid max-h-56 gap-2 overflow-y-auto rounded-lg border border-border bg-background p-2 sm:grid-cols-2 xl:grid-cols-3">
      {technicians.map((technician) => {
        const isSelected = value.includes(technician.id);

        return (
        <label key={technician.id} className={`flex min-h-10 items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition ${isSelected ? 'border-emerald-200 bg-emerald-50/70' : 'border-transparent hover:border-border hover:bg-secondary/50'}`}>
          <input type="checkbox" checked={isSelected} onChange={() => onToggle(technician.id)} className="h-4 w-4 shrink-0 rounded border-border" />
          <span className="truncate font-medium text-foreground" title={technician.name}>{technician.name}</span>
        </label>
        );
      })}
    </div>
  );
}

function DayKeyChecklist({ value, onToggle }: DayKeyChecklistProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {dayRuleDefinitions.map((day) => (
        <label key={day.key} className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm">
          <input type="checkbox" checked={value.includes(day.key)} onChange={() => onToggle(day.key)} className="h-4 w-4 rounded border-border" />
          <span className="font-medium text-foreground">{day.label}</span>
        </label>
      ))}
    </div>
  );
}

function BuilderActionCard({ eyebrow, title, value, buttonLabel = 'Editar', onClick }: BuilderActionCardProps) {
  return (
    <section className="rounded-lg border border-border/70 bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p>
          <h4 className="mt-1 text-sm font-semibold text-foreground">{title}</h4>
          <p className="mt-1 truncate text-sm text-muted-foreground">{value}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClick}>
          {buttonLabel}
        </Button>
      </div>
    </section>
  );
}

function DayRuleEditor({ label, dayLabel, rule, technicians, selectionLabel, fallbackStartTime, fallbackEndTime, onModeChange, onCadenceChange, onStartTimeChange, onEndTimeChange, onSetTechnicians, onConfigureTechnicians, inputClassName }: DayRuleEditorProps) {
  const requiresSelection = rule.mode === 'selected' || rule.mode === 'rotation';
  const isSingleTechnicianCoverage = rule.mode === 'rotation';
  const usesCadence = rule.mode !== 'off';
  const technicianSelectionLabel = selectionLabel || (rule.technician_ids.length
    ? formatCount(rule.technician_ids.length, 'técnico escolhido', 'técnicos escolhidos')
    : isSingleTechnicianCoverage
      ? 'todo o escopo'
      : 'escolher grupo');
  const startTimeValue = rule.mode === 'off' ? '' : rule.start_time || fallbackStartTime;
  const endTimeValue = rule.mode === 'off' ? '' : rule.end_time || fallbackEndTime;

  return (
    <tr className="border-t border-border/70 align-middle">
      <td className="min-w-32 px-3 py-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <StatusBadge tone="neutral">{getDayRuleLabel(rule)}</StatusBadge>
        </div>
      </td>

      <td className="min-w-44 px-3 py-3">
        <label className="block text-sm">
          <span className="sr-only">Cobertura de {dayLabel}</span>
          <select value={rule.mode} onChange={(event) => onModeChange(event.target.value as WeekendCoverageMode)} className={inputClassName}>
            <option value="off">Todos Folgam</option>
            <option value="all">Todos trabalham</option>
            <option value="selected">Equipe selecionada</option>
            <option value="rotation">Técnico específico</option>
          </select>
        </label>
      </td>

      <td className="min-w-48 px-3 py-3">
        {usesCadence ? (
          <label className="block text-sm">
            <span className="sr-only">Frequência de {dayLabel}</span>
            <select value={rule.rotation_cadence ?? 'weekly'} onChange={(event) => onCadenceChange(event.target.value as WeekendRotationCadence)} className={inputClassName}>
              <option value="weekly">Toda ocorrência deste dia</option>
              <option value="alternating">Uma ocorrência sim, outra não</option>
            </select>
          </label>
        ) : (
          <span className="text-sm text-muted-foreground">Sem frequência</span>
        )}
      </td>

      <td className="min-w-44 px-3 py-3">
        {isSingleTechnicianCoverage ? (
          <label className="block text-sm">
            <span className="sr-only">Técnico de {dayLabel}</span>
            <select
              value={rule.technician_ids[0] || 'all'}
              onChange={(event) => onSetTechnicians(event.target.value === 'all' ? [] : [event.target.value])}
              className={inputClassName}
            >
              <option value="all">Todos</option>
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>{technician.name}</option>
              ))}
            </select>
          </label>
        ) : rule.mode === 'selected' ? (
          <Button type="button" variant="outline" onClick={onConfigureTechnicians} className="w-full justify-between">
            <Users className="h-4 w-4" />
            <span className="truncate">{technicianSelectionLabel}</span>
          </Button>
        ) : rule.mode === 'all' ? (
          <span className="text-sm font-medium text-foreground">Todos</span>
        ) : (
          <span className="text-sm text-muted-foreground">Todos</span>
        )}
      </td>

      <td className="min-w-32 px-3 py-3">
        <input type="time" value={startTimeValue} disabled={rule.mode === 'off'} onChange={(event) => onStartTimeChange(event.target.value)} className={inputClassName} aria-label={`Entrada de ${dayLabel}`} />
      </td>

      <td className="min-w-32 px-3 py-3">
        <input type="time" value={endTimeValue} disabled={rule.mode === 'off'} onChange={(event) => onEndTimeChange(event.target.value)} className={inputClassName} aria-label={`Saída de ${dayLabel}`} />
      </td>
    </tr>
  );
}
export function AdminScheduleBuilderPage() {
  const { user, loading } = useAppSession();
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [query, setQuery] = useState('');
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [isCalendarDialogOpen, setIsCalendarDialogOpen] = useState(false);
  const [isAttendanceDialogOpen, setIsAttendanceDialogOpen] = useState(false);
  const [attendanceMode, setAttendanceMode] = useState<AttendanceMode>('day');
  const [attendanceDate, setAttendanceDate] = useState(() => createDateInputValue(new Date()));
  const [attendanceMonth, setAttendanceMonth] = useState(() => createMonthInputValue(new Date()));
  const [attendanceDrafts, setAttendanceDrafts] = useState<AttendanceDraft[]>([]);
  const [monthlyAttendanceDrafts, setMonthlyAttendanceDrafts] = useState<AttendanceDraft[]>([]);
  const [attendanceError, setAttendanceError] = useState('');
  const [attendanceMessage, setAttendanceMessage] = useState('');
  const [isAttendanceSubmitting, setIsAttendanceSubmitting] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarWeek, setCalendarWeek] = useState('all');
  const [builderDialog, setBuilderDialog] = useState<ScheduleBuilderDialog>(null);
  const [activeDayRuleKey, setActiveDayRuleKey] = useState<ScheduleDayRuleKey | null>(null);
  const [formData, setFormData] = useState<ScheduleBuilderForm>(createInitialBuilderForm);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      const result = await fetchSchedulePageData();

      if (!mounted) {
        return;
      }

      setSchedule(result.schedule);
      setTechnicians(result.technicians);
      setDataError(result.error);
      setIsDataLoading(false);
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [user]);

  const visibleSchedule = useMemo(
    () => [...schedule].sort((left, right) => normalizeDateKey(left.date).localeCompare(normalizeDateKey(right.date))),
    [schedule],
  );
  const activeTechnicians = useMemo(
    () => technicians.filter((technician) => technician.status === 'active'),
    [technicians],
  );
  const sortedTechnicians = useMemo(
    () => [...activeTechnicians].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
    [activeTechnicians],
  );
  const inputClassName = 'min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring';
  const scheduleByDate = useMemo(() => {
    const grouped = new Map<string, Schedule[]>();

    visibleSchedule.forEach((item) => {
      const key = normalizeDateKey(item.date);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });

    return grouped;
  }, [visibleSchedule]);
  const selectedTechnicianIds = useMemo(
    () => (formData.technician_scope === 'all' ? sortedTechnicians.map((technician) => technician.id) : formData.technician_ids),
    [formData.technician_ids, formData.technician_scope, sortedTechnicians],
  );
  const ruleTechnicians = useMemo(() => {
    if (formData.technician_scope === 'selected' && formData.technician_ids.length) {
      return sortedTechnicians.filter((technician) => formData.technician_ids.includes(technician.id));
    }

    return sortedTechnicians;
  }, [formData.technician_ids, formData.technician_scope, sortedTechnicians]);

  useEffect(() => {
    const availableTechnicianIds = new Set(ruleTechnicians.map((technician) => technician.id));

    setFormData((current) => {
      let changed = false;
      const nextDayRules = { ...current.day_rules };

      dayRuleDefinitions.forEach(({ key }) => {
        const groupId = current.day_rule_group_ids[key];
        if (!groupId) {
          return;
        }

        const group = current.groups.find((item) => item.id === groupId);
        const nextTechnicianIds = group
          ? group.technician_ids.filter((technicianId) => availableTechnicianIds.has(technicianId))
          : [];
        const currentTechnicianIds = normalizeTechnicianIds(current.day_rules[key].technician_ids);

        if (currentTechnicianIds.join('|') !== normalizeTechnicianIds(nextTechnicianIds).join('|')) {
          nextDayRules[key] = {
            ...nextDayRules[key],
            technician_ids: nextTechnicianIds,
          };
          changed = true;
        }
      });

      return changed ? { ...current, day_rules: nextDayRules } : current;
    });
  }, [ruleTechnicians]);

  const generationPreview = useMemo(
    () => getScheduleGenerationPreview(formData.period_mode, formData.year, formData.period_mode === 'month' ? formData.month : undefined, selectedTechnicianIds, formData.date),
    [formData.date, formData.month, formData.period_mode, formData.year, selectedTechnicianIds],
  );

  function getEffectiveDayRules() {
    const nextRules: Record<ScheduleDayRuleKey, WeekendCoverageRule> = {
      monday: { ...formData.day_rules.monday, technician_ids: [...formData.day_rules.monday.technician_ids] },
      tuesday: { ...formData.day_rules.tuesday, technician_ids: [...formData.day_rules.tuesday.technician_ids] },
      wednesday: { ...formData.day_rules.wednesday, technician_ids: [...formData.day_rules.wednesday.technician_ids] },
      thursday: { ...formData.day_rules.thursday, technician_ids: [...formData.day_rules.thursday.technician_ids] },
      friday: { ...formData.day_rules.friday, technician_ids: [...formData.day_rules.friday.technician_ids] },
      saturday: { ...formData.day_rules.saturday, technician_ids: [...formData.day_rules.saturday.technician_ids] },
      sunday: { ...formData.day_rules.sunday, technician_ids: [...formData.day_rules.sunday.technician_ids] },
    };
    const rotationParticipantsByDay = new Map<ScheduleDayRuleKey, string[]>();

    formData.rotation_groups.forEach((group) => {
      const groupTechnicians = normalizeTechnicianIds(group.technician_ids).filter((technicianId) => selectedTechnicianIds.includes(technicianId));

      group.day_keys.forEach((dayKey) => {
        rotationParticipantsByDay.set(dayKey, normalizeTechnicianIds([...(rotationParticipantsByDay.get(dayKey) ?? []), ...groupTechnicians]));
      });
    });

    rotationParticipantsByDay.forEach((technicianIds, dayKey) => {
      if (!technicianIds.length) {
        return;
      }

      nextRules[dayKey] = {
        ...nextRules[dayKey],
        mode: 'selected',
        technician_ids: technicianIds,
        rotation_cadence: 'weekly',
      };
    });

    return nextRules;
  }

  function buildSchedulePayload(): ScheduleGenerationInput {
    const dayRules = getEffectiveDayRules();

    return {
      period_mode: formData.period_mode,
      year: formData.period_mode === 'day' || formData.period_mode === 'week' ? getYearFromDateKey(formData.date, formData.year) : formData.year,
      month: formData.period_mode === 'month' ? formData.month : undefined,
      date: formData.period_mode === 'day' || formData.period_mode === 'week' ? formData.date : undefined,
      technician_scope: formData.technician_scope,
      technician_ids: formData.technician_scope === 'selected' ? formData.technician_ids : [],
      weekday_start_time: formData.weekday_start_time,
      weekday_end_time: formData.weekday_end_time,
      weekend_start_time: formData.weekend_start_time,
      weekend_end_time: formData.weekend_end_time,
      saturday_rule: dayRules.saturday,
      sunday_rule: dayRules.sunday,
      day_rules: dayRules,
      rotation_groups: formData.rotation_groups.map(({ label, day_keys, technician_ids }) => ({
        label,
        day_keys,
        technician_ids,
        rotation_cadence: 'weekly',
      })),
      recurring_rules: formData.recurring_rules.map(({ technician_id, day_keys, status, start_time, end_time, notes }) => ({
        technician_id,
        day_keys,
        status,
        start_time,
        end_time,
        notes,
      })),
      general_days_off: formData.general_days_off.map(({ date, notes }) => ({ date, notes })),
      overrides: formData.overrides.map(({ technician_id, date, status, start_time, end_time, notes }) => ({
        technician_id,
        date,
        status,
        start_time,
        end_time,
        notes,
      })),
    };
  }

  function getRotationPreviewRows(group: RotationGroupDraft): RotationPreviewRow[] {
    const availableTechnicianIds = ruleTechnicians.map((technician) => technician.id).filter((technicianId) => selectedTechnicianIds.includes(technicianId));
    const { firstTeam, nextTeam } = getRotationTeams(group.technician_ids, availableTechnicianIds);
    const namesById = new Map(ruleTechnicians.map((technician) => [technician.id, technician.name]));
    const occurrenceByDay = new Map<ScheduleDayRuleKey, number>();
    const previewDates = enumerateDateKeys(generationPreview.startDate, generationPreview.endDate)
      .filter((dateKey) => group.day_keys.includes(getDayKeyFromDateKey(dateKey)))
      .slice(0, 8);

    if (!firstTeam.length || !nextTeam.length) {
      return [];
    }

    return previewDates.map((date) => {
      const dayKey = getDayKeyFromDateKey(date);
      const occurrenceIndex = occurrenceByDay.get(dayKey) ?? 0;
      occurrenceByDay.set(dayKey, occurrenceIndex + 1);

      const workerIds = occurrenceIndex % 2 === 0 ? firstTeam : nextTeam;
      return {
        date,
        dayLabel: getDayLabelFromKey(dayKey),
        workerNames: workerIds.map((workerId) => namesById.get(workerId) || workerId),
      };
    });
  }

  useEffect(() => {
    if (!isAttendanceDialogOpen) {
      return;
    }

    const dayEntries = scheduleByDate.get(attendanceDate) ?? [];

    setAttendanceDrafts(sortedTechnicians.map((technician) => {
      const entry = getBestScheduleEntry(dayEntries.filter((item) => item.technician_id === technician.id));
      const plannedStartTime = normalizeTimeInput(entry?.start_time, DEFAULT_START_TIME);
      const plannedEndTime = normalizeTimeInput(entry?.end_time, DEFAULT_END_TIME);
      const plannedHours = entry?.status === 'cancelled' ? 0 : getHoursBetween(plannedStartTime, plannedEndTime);
      const included = Boolean(entry && entry.status !== 'cancelled');

      return {
        key: technician.id,
        date: attendanceDate,
        technician_id: technician.id,
        technician_name: technician.name,
        attendance_status: getAttendanceStatusFromSchedule(entry),
        planned_start_time: plannedStartTime,
        planned_end_time: plannedEndTime,
        planned_hours: plannedHours,
        actual_start_time: plannedStartTime,
        actual_end_time: plannedEndTime,
        schedule_status: entry?.status,
      };
    }));
  }, [attendanceDate, isAttendanceDialogOpen, scheduleByDate, sortedTechnicians]);

  useEffect(() => {
    if (!isAttendanceDialogOpen) {
      return;
    }

    const [year, month] = attendanceMonth.split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month)) {
      setMonthlyAttendanceDrafts([]);
      return;
    }

    const { startDate, endDate } = getScheduleRange('month', year, month);
    const technicianNames = new Map(sortedTechnicians.map((technician) => [technician.id, technician.name]));
    const grouped = new Map<string, Schedule[]>();

    visibleSchedule.forEach((item) => {
      const dateKey = normalizeDateKey(item.date);
      if (dateKey < startDate || dateKey > endDate) {
        return;
      }

      const key = `${dateKey}::${item.technician_id}`;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });

    const nextDrafts = Array.from(grouped.entries()).reduce<AttendanceDraft[]>((entries, [key, dayEntries]) => {
      const entry = getBestScheduleEntry(dayEntries);
      if (!entry) {
        return entries;
      }

      const startTime = normalizeTimeInput(entry.start_time, DEFAULT_START_TIME);
      const endTime = normalizeTimeInput(entry.end_time, DEFAULT_END_TIME);
      const plannedHours = entry.status === 'cancelled' ? 0 : getHoursBetween(startTime, endTime);

      if (entry.status !== 'cancelled' && plannedHours <= 0) {
        return entries;
      }

      const date = normalizeDateKey(entry.date);
      const technicianName = entry.technician_name || technicianNames.get(entry.technician_id) || entry.technician_id;

      entries.push({
        key,
        date,
        technician_id: entry.technician_id,
        technician_name: technicianName,
        attendance_status: getAttendanceStatusFromSchedule(entry),
        planned_start_time: startTime,
        planned_end_time: endTime,
        planned_hours: plannedHours,
        actual_start_time: startTime,
        actual_end_time: endTime,
        schedule_status: entry.status,
      });

      return entries;
    }, []).sort((left, right) => left.date.localeCompare(right.date) || left.technician_name.localeCompare(right.technician_name, 'pt-BR'));

    setMonthlyAttendanceDrafts(nextDrafts);
  }, [attendanceMonth, isAttendanceDialogOpen, sortedTechnicians, visibleSchedule]);

  const filteredSchedule = useMemo(() => {
    return visibleSchedule.filter((item) => {
      const haystack = normalizeText(`${item.technician_name || item.technician_id} ${item.notes || ''} ${item.status} ${normalizeDateKey(item.date)}`);
      return !query || haystack.includes(normalizeText(query));
    });
  }, [query, visibleSchedule]);
  const calendarWeeks = useMemo(() => getMonthWeeks(calendarYear, calendarMonth), [calendarMonth, calendarYear]);
  const displayedCalendarWeeks = calendarWeek === 'all' ? calendarWeeks : [calendarWeeks[Number(calendarWeek)] ?? calendarWeeks[0]].filter(Boolean);
  const calendarYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from(new Set([currentYear, currentYear + 1, ...visibleSchedule.map((item) => Number(normalizeDateKey(item.date).slice(0, 4)))]))
      .filter((year) => Number.isFinite(year))
      .sort((left, right) => left - right);
  }, [visibleSchedule]);
  const weekDates = useMemo(() => getNextDateKeys(7), []);

  useEffect(() => {
    if (calendarWeek !== 'all' && Number(calendarWeek) >= calendarWeeks.length) {
      setCalendarWeek('all');
    }
  }, [calendarWeek, calendarWeeks.length]);

  function resetForm() {
    setFormData(createInitialBuilderForm());
    setFormError('');
  }

  function handleFormDialogChange(open: boolean) {
    setIsFormDialogOpen(open);

    if (!open) {
      setBuilderDialog(null);
      setActiveDayRuleKey(null);
      resetForm();
    }
  }

  function handleAttendanceDialogChange(open: boolean) {
    setIsAttendanceDialogOpen(open);
    setAttendanceError('');
    setAttendanceMessage('');

    if (open) {
      const now = new Date();
      setAttendanceMode('day');
      setAttendanceDate(createDateInputValue(now));
      setAttendanceMonth(createMonthInputValue(now));
    }
  }

  function handleAttendanceModeChange(mode: AttendanceMode) {
    setAttendanceMode(mode);
    setAttendanceError('');
    setAttendanceMessage('');
  }

  function updateAttendanceDraft(draftKey: string, changes: Partial<AttendanceDraft>) {
    setAttendanceDrafts((current) => current.map((draft) => (
      draft.key === draftKey ? { ...draft, ...changes } : draft
    )));
  }

  function updateMonthlyAttendanceDraft(draftKey: string, changes: Partial<AttendanceDraft>) {
    setMonthlyAttendanceDrafts((current) => current.map((draft) => (
      draft.key === draftKey ? { ...draft, ...changes } : draft
    )));
  }

  function markAttendanceAutomatically() {
    if (attendanceMode === 'month') {
      setMonthlyAttendanceDrafts((current) => current.map((draft) => ({
        ...draft,
        attendance_status: draft.schedule_status === 'cancelled'
          ? 'day_off'
          : draft.schedule_status
            ? 'worked'
            : 'not_marked',
        actual_start_time: draft.planned_start_time || DEFAULT_START_TIME,
        actual_end_time: draft.planned_end_time || DEFAULT_END_TIME,
      })));
      setAttendanceError('');
      setAttendanceMessage(monthlyAttendanceDrafts.length
        ? `${formatCount(monthlyAttendanceDrafts.length, 'apontamento marcado', 'apontamentos marcados')} para o mês.`
        : 'Não há escala ativa salva para apontar neste mês.');
      return;
    }

    setAttendanceDrafts((current) => current.map((draft) => ({
      ...draft,
      attendance_status: draft.schedule_status === 'cancelled'
        ? 'day_off'
        : draft.schedule_status
          ? 'worked'
          : 'not_marked',
      actual_start_time: draft.planned_start_time || DEFAULT_START_TIME,
      actual_end_time: draft.planned_end_time || DEFAULT_END_TIME,
    })));
  }

  async function handleAttendanceSubmit(event: React.FormEvent) {
    event.preventDefault();
    setAttendanceError('');
    setAttendanceMessage('');

    const sourceDrafts = attendanceMode === 'day' ? attendanceDrafts : monthlyAttendanceDrafts;
    const selectedDrafts = sourceDrafts.filter(isAttendanceSelected);

    if (!selectedDrafts.length) {
      setAttendanceError(attendanceMode === 'month' ? 'Selecione ao menos um apontamento do mês.' : 'Selecione ao menos um técnico para lançar o apontamento.');
      return;
    }

    const invalidDraft = selectedDrafts.find((draft) => (
      draft.attendance_status === 'worked' && getHoursBetween(draft.actual_start_time, draft.actual_end_time) <= 0
    ));

    if (invalidDraft) {
      setAttendanceError(`Revise as horas de ${invalidDraft.technician_name} em ${formatDate(invalidDraft.date)}.`);
      return;
    }

    setIsAttendanceSubmitting(true);

    const entries = selectedDrafts.map((draft) => {
      const hoursWorked = getAttendanceWorkedHours(draft);
      const startTime = normalizeTimeInput(draft.attendance_status === 'worked' ? draft.actual_start_time : draft.planned_start_time, DEFAULT_START_TIME);
      const endTime = normalizeTimeInput(draft.attendance_status === 'worked' ? draft.actual_end_time : draft.planned_end_time, DEFAULT_END_TIME);
      const dateParts = draft.date.split('-').map(Number);

      return {
        technician_id: draft.technician_id,
        date: draft.date,
        start_time: startTime,
        end_time: endTime,
        hours_worked: hoursWorked,
        week_number: getIsoWeekNumber(draft.date),
        month: dateParts[1],
        year: dateParts[0],
      };
    });

    const payload = { entries };

    try {
      const response = await fetch('/api/work-hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'Não foi possível salvar o apontamento.');
      }

      const refreshed = await fetchSchedulePageData();
      setSchedule(refreshed.schedule);
      setTechnicians(refreshed.technicians);
      setDataError(refreshed.error);
      setSaveMessage(attendanceMode === 'month'
        ? `Banco de horas atualizado para ${attendanceMonth} com ${formatCount(entries.length, 'apontamento', 'apontamentos')}.`
        : `Banco de horas atualizado em ${formatDate(attendanceDate)} para ${formatCount(selectedDrafts.length, 'técnico', 'técnicos')}.`);
      setIsAttendanceDialogOpen(false);
      setAttendanceDrafts([]);
      setMonthlyAttendanceDrafts([]);
      setAttendanceError('');
      setAttendanceMessage('');
    } catch (error) {
      setAttendanceError(error instanceof Error ? error.message : 'Não foi possível salvar o apontamento.');
    } finally {
      setIsAttendanceSubmitting(false);
    }
  }

  function toggleTechnicianSelection(technicianId: string) {
    setFormData((current) => ({
      ...current,
      technician_ids: toggleStringValue(current.technician_ids, technicianId),
    }));
  }

  function syncDayRulesWithGroup(current: ScheduleBuilderForm, groupId: string, technicianIds: string[]) {
    const availableTechnicianIds = new Set(ruleTechnicians.map((technician) => technician.id));
    const scopedTechnicianIds = technicianIds.filter((technicianId) => availableTechnicianIds.has(technicianId));
    const nextDayRules = { ...current.day_rules };

    dayRuleDefinitions.forEach(({ key }) => {
      if (current.day_rule_group_ids[key] === groupId) {
        nextDayRules[key] = {
          ...nextDayRules[key],
          technician_ids: [...scopedTechnicianIds],
        };
      }
    });

    return nextDayRules;
  }

  function addGroup() {
    setFormData((current) => ({
      ...current,
      groups: [...current.groups, { id: createId(), name: '', technician_ids: [] }],
    }));
  }

  function updateGroupName(groupId: string, value: string) {
    setFormData((current) => ({
      ...current,
      groups: current.groups.map((group) => (group.id === groupId ? { ...group, name: value } : group)),
    }));
  }

  function toggleGroupTechnician(groupId: string, technicianId: string) {
    setFormData((current) => {
      let nextTechnicianIds: string[] = [];
      const nextGroups = current.groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        nextTechnicianIds = toggleStringValue(group.technician_ids, technicianId);
        return {
          ...group,
          technician_ids: nextTechnicianIds,
        };
      });

      return {
        ...current,
        groups: nextGroups,
        day_rules: syncDayRulesWithGroup(current, groupId, nextTechnicianIds),
      };
    });
  }

  function removeGroup(groupId: string) {
    setFormData((current) => {
      const nextDayRules = { ...current.day_rules };
      const nextDayRuleGroupIds = { ...current.day_rule_group_ids };

      dayRuleDefinitions.forEach(({ key }) => {
        if (current.day_rule_group_ids[key] === groupId) {
          nextDayRuleGroupIds[key] = '';
          nextDayRules[key] = {
            ...nextDayRules[key],
            technician_ids: [],
          };
        }
      });

      return {
        ...current,
        groups: current.groups.filter((group) => group.id !== groupId),
        day_rule_group_ids: nextDayRuleGroupIds,
        day_rules: nextDayRules,
      };
    });
  }

  function applyGroupToDayRule(ruleKey: ScheduleDayRuleKey, groupId: string) {
    setFormData((current) => {
      const selectedGroup = current.groups.find((group) => group.id === groupId);
      if (!selectedGroup) {
        return current;
      }

      const availableTechnicianIds = new Set(ruleTechnicians.map((technician) => technician.id));
      const scopedTechnicianIds = selectedGroup.technician_ids.filter((technicianId) => availableTechnicianIds.has(technicianId));

      return {
        ...current,
        day_rule_group_ids: {
          ...current.day_rule_group_ids,
          [ruleKey]: groupId,
        },
        day_rules: {
          ...current.day_rules,
          [ruleKey]: {
            ...current.day_rules[ruleKey],
            technician_ids: scopedTechnicianIds,
          },
        },
      };
    });
  }

  function toggleDayRuleTechnician(ruleKey: ScheduleDayRuleKey, technicianId: string) {
    setFormData((current) => ({
      ...current,
      day_rule_group_ids: {
        ...current.day_rule_group_ids,
        [ruleKey]: '',
      },
      day_rules: {
        ...current.day_rules,
        [ruleKey]: {
          ...current.day_rules[ruleKey],
          technician_ids: toggleStringValue(current.day_rules[ruleKey].technician_ids, technicianId),
        },
      },
    }));
  }

  function updateDayRuleMode(ruleKey: ScheduleDayRuleKey, mode: WeekendCoverageMode) {
    setFormData((current) => ({
      ...current,
      day_rule_group_ids: {
        ...current.day_rule_group_ids,
        [ruleKey]: mode === 'selected' ? current.day_rule_group_ids[ruleKey] : '',
      },
      day_rules: {
        ...current.day_rules,
        [ruleKey]: {
          ...current.day_rules[ruleKey],
          mode,
          technician_ids: mode === 'all' || mode === 'off'
            ? []
            : mode === 'rotation'
              ? current.day_rules[ruleKey].technician_ids.slice(0, 1)
              : current.day_rule_group_ids[ruleKey]
                ? current.day_rules[ruleKey].technician_ids
                : [],
        },
      },
    }));
  }

  function setDayRuleTechnicians(ruleKey: ScheduleDayRuleKey, technicianIds: string[]) {
    setFormData((current) => ({
      ...current,
      day_rule_group_ids: {
        ...current.day_rule_group_ids,
        [ruleKey]: '',
      },
      day_rules: {
        ...current.day_rules,
        [ruleKey]: {
          ...current.day_rules[ruleKey],
          technician_ids: technicianIds,
        },
      },
    }));
  }

  function updateDayRuleCadence(ruleKey: ScheduleDayRuleKey, rotationCadence: WeekendRotationCadence) {
    setFormData((current) => ({
      ...current,
      day_rules: {
        ...current.day_rules,
        [ruleKey]: {
          ...current.day_rules[ruleKey],
          rotation_cadence: rotationCadence,
        },
      },
    }));
  }

  function updateDayRuleTime(ruleKey: ScheduleDayRuleKey, field: 'start_time' | 'end_time', value: string) {
    setFormData((current) => ({
      ...current,
      day_rules: {
        ...current.day_rules,
        [ruleKey]: {
          ...current.day_rules[ruleKey],
          [field]: value,
          ...(value && field === 'start_time' && !current.day_rules[ruleKey].end_time
            ? { end_time: ruleKey === 'saturday' || ruleKey === 'sunday' ? current.weekend_end_time : current.weekday_end_time }
            : {}),
          ...(value && field === 'end_time' && !current.day_rules[ruleKey].start_time
            ? { start_time: ruleKey === 'saturday' || ruleKey === 'sunday' ? current.weekend_start_time : current.weekday_start_time }
            : {}),
        },
      },
    }));
  }

  function addRotationGroup() {
    setFormData((current) => ({
      ...current,
      rotation_groups: [
        ...current.rotation_groups,
        {
          id: createId(),
          label: '',
          day_keys: [],
          technician_ids: [],
          rotation_cadence: 'weekly',
        },
      ],
    }));
  }

  function toggleRotationGroupDay(groupId: string, dayKey: ScheduleDayRuleKey) {
    setFormData((current) => ({
      ...current,
      rotation_groups: current.rotation_groups.map((group) => (
        group.id === groupId
          ? { ...group, day_keys: toggleDayKeyValue(group.day_keys, dayKey) }
          : group
      )),
    }));
  }

  function toggleRotationGroupTechnician(groupId: string, technicianId: string) {
    setFormData((current) => ({
      ...current,
      rotation_groups: current.rotation_groups.map((group) => (
        group.id === groupId
          ? { ...group, technician_ids: toggleStringValue(group.technician_ids, technicianId) }
          : group
      )),
    }));
  }

  function removeRotationGroup(groupId: string) {
    setFormData((current) => ({
      ...current,
      rotation_groups: current.rotation_groups.filter((group) => group.id !== groupId),
    }));
  }

  function addRecurringRule() {
    setFormData((current) => ({
      ...current,
      recurring_rules: [
        ...current.recurring_rules,
        {
          id: createId(),
          technician_id: selectedTechnicianIds[0] || '',
          day_keys: ['monday'],
          status: 'cancelled',
          start_time: current.weekday_start_time,
          end_time: current.weekday_end_time,
          notes: '',
        },
      ],
    }));
  }

  function updateRecurringRule(ruleId: string, field: 'technician_id' | 'status' | 'start_time' | 'end_time' | 'notes', value: string) {
    setFormData((current) => ({
      ...current,
      recurring_rules: current.recurring_rules.map((rule) => (rule.id === ruleId ? { ...rule, [field]: value } : rule)),
    }));
  }

  function toggleRecurringRuleDay(ruleId: string, dayKey: ScheduleDayRuleKey) {
    setFormData((current) => ({
      ...current,
      recurring_rules: current.recurring_rules.map((rule) => (
        rule.id === ruleId
          ? { ...rule, day_keys: toggleDayKeyValue(rule.day_keys, dayKey) }
          : rule
      )),
    }));
  }

  function removeRecurringRule(ruleId: string) {
    setFormData((current) => ({
      ...current,
      recurring_rules: current.recurring_rules.filter((rule) => rule.id !== ruleId),
    }));
  }

  function addGeneralDayOff() {
    setFormData((current) => ({
      ...current,
      general_days_off: [...current.general_days_off, { id: createId(), date: generationPreview.startDate, notes: '' }],
    }));
  }

  function updateGeneralDayOff(dayOffId: string, field: 'date' | 'notes', value: string) {
    setFormData((current) => ({
      ...current,
      general_days_off: current.general_days_off.map((item) => (item.id === dayOffId ? { ...item, [field]: value } : item)),
    }));
  }

  function removeGeneralDayOff(dayOffId: string) {
    setFormData((current) => ({
      ...current,
      general_days_off: current.general_days_off.filter((item) => item.id !== dayOffId),
    }));
  }

  function addOverride() {
    setFormData((current) => ({
      ...current,
      overrides: [
        ...current.overrides,
        {
          id: createId(),
          technician_id: selectedTechnicianIds[0] || '',
          date: generationPreview.startDate,
          status: 'cancelled',
          start_time: current.weekday_start_time,
          end_time: current.weekday_end_time,
          notes: '',
        },
      ],
    }));
  }

  function updateOverride(overrideId: string, field: keyof OverrideDraft, value: string) {
    setFormData((current) => ({
      ...current,
      overrides: current.overrides.map((item) => (item.id === overrideId ? { ...item, [field]: value } : item)),
    }));
  }

  function removeOverride(overrideId: string) {
    setFormData((current) => ({
      ...current,
      overrides: current.overrides.filter((item) => item.id !== overrideId),
    }));
  }

  function validateForm() {
    if (!selectedTechnicianIds.length) {
      return 'Selecione ao menos um técnico para montar a escala.';
    }

    if ((formData.period_mode === 'day' || formData.period_mode === 'week') && !/^\d{4}-\d{2}-\d{2}$/.test(formData.date)) {
      return 'Selecione a data de referência do período.';
    }

    if (formData.weekday_start_time >= formData.weekday_end_time) {
      return 'O horário padrão dos dias úteis está inválido.';
    }

    if (formData.weekend_start_time >= formData.weekend_end_time) {
      return 'O horário padrão do fim de semana está inválido.';
    }

    for (const group of formData.groups) {
      if (!group.name.trim()) {
        return 'Cada grupo precisa de um nome.';
      }

      if (!group.technician_ids.length) {
        return `O grupo ${group.name.trim() || 'sem nome'} precisa de ao menos um técnico.`;
      }
    }

    for (const { key, dayLabel } of dayRuleDefinitions) {
      const rule = formData.day_rules[key];

      if ((rule.start_time && !rule.end_time) || (!rule.start_time && rule.end_time)) {
        return `Preencha entrada e saída de ${dayLabel} ou deixe os dois campos em branco.`;
      }

      if (rule.start_time && rule.end_time && rule.start_time >= rule.end_time) {
        return `O horário configurado para ${dayLabel} está inválido.`;
      }

      if (rule.mode === 'selected' && !formData.day_rule_group_ids[key]) {
        return `Selecione um grupo para ${dayLabel}.`;
      }

      if (rule.mode === 'selected' && !rule.technician_ids.length) {
        return `O grupo escolhido para ${dayLabel} não tem técnicos dentro do escopo atual.`;
      }
    }

    for (const group of formData.rotation_groups) {
      if (!group.day_keys.length) {
        return 'Cada regra de revezamento precisa de ao menos um dia selecionado.';
      }

      const availableRotationTechnicianIds = ruleTechnicians.map((technician) => technician.id);
      const { firstTeam, nextTeam } = getRotationTeams(group.technician_ids, availableRotationTechnicianIds);

      if (!firstTeam.length) {
        return 'Marque ao menos um técnico para trabalhar na primeira ocorrência do revezamento.';
      }

      if (!nextTeam.length) {
        return 'Deixe ao menos um técnico desmarcado para trabalhar na próxima ocorrência do revezamento.';
      }
    }

    for (const recurringRule of formData.recurring_rules) {
      if (!recurringRule.technician_id) {
        return 'Cada regra recorrente precisa de um técnico selecionado.';
      }

      if (!recurringRule.day_keys.length) {
        return 'Cada regra recorrente precisa de ao menos um dia selecionado.';
      }

      if (recurringRule.status !== 'cancelled') {
        if (!recurringRule.start_time || !recurringRule.end_time) {
          return 'Turnos recorrentes precisam de horário de entrada e saída.';
        }

        if (recurringRule.start_time >= recurringRule.end_time) {
          return 'Os horários das regras recorrentes precisam ter entrada antes da saída.';
        }
      }
    }

    for (const override of formData.overrides) {
      if (!override.technician_id) {
        return 'Toda exceção individual precisa ter um técnico selecionado.';
      }

      if ((override.status === 'scheduled' || override.status === 'completed') && override.start_time >= override.end_time) {
        return 'Os horários das exceções individuais precisam ter entrada antes da saída.';
      }
    }

    return '';
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');
    setSaveMessage('');

    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setIsSubmitting(true);

    const payload = buildSchedulePayload();

    try {
      const response = await fetch('/api/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'Não foi possível salvar a escala.');
      }

      const refreshed = await fetchSchedulePageData();
      setSchedule(refreshed.schedule);
      setTechnicians(refreshed.technicians);
      setDataError(refreshed.error);
      setSaveMessage(data?.summary ? buildSuccessMessage(data.summary) : 'Escala salva com sucesso.');
      handleFormDialogChange(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível salvar a escala.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function getCalendarDayScheduled(day: number) {
    const dateKey = createDateKey(calendarYear, calendarMonth, day);
    const dayEntries = scheduleByDate.get(dateKey) ?? [];

    return sortedTechnicians.reduce(
      (scheduled, technician) => {
        const entry = getBestScheduleEntry(dayEntries.filter((item) => item.technician_id === technician.id));

        if (!entry || entry.status === 'cancelled') {
          return scheduled;
        }

        scheduled.push({ name: technician.name, entry });
        return scheduled;
      },
      [] as Array<{ name: string; entry: Schedule }>,
    );
  }

  if (loading || isDataLoading || !user) {
    return <LoadingState />;
  }

  const todayKey = normalizeDateKey(new Date().toISOString());
  const todayEntries = scheduleByDate.get(todayKey) ?? [];
  const workingToday = sortedTechnicians.filter((technician) => {
    const entry = getBestScheduleEntry(todayEntries.filter((item) => item.technician_id === technician.id));
    return entry && entry.status !== 'cancelled';
  }).length;
  const dayOffToday = sortedTechnicians.filter((technician) => {
    const entry = getBestScheduleEntry(todayEntries.filter((item) => item.technician_id === technician.id));
    return entry?.status === 'cancelled';
  }).length;
  const coveredTechnicians = new Set(visibleSchedule.map((item) => item.technician_id)).size;
  const range = getScheduleRange(formData.period_mode, formData.year, formData.month, formData.date);
  const scopeSummary = formData.technician_scope === 'all'
    ? 'Todos os técnicos ativos'
    : formatCount(selectedTechnicianIds.length, 'técnico selecionado', 'técnicos selecionados');
  const optionalAdjustmentsCount = formData.recurring_rules.length + formData.rotation_groups.length + formData.general_days_off.length + formData.overrides.length;
  const activeDayDefinition = activeDayRuleKey ? getDayDefinition(activeDayRuleKey) : undefined;
  const activeDayRule = activeDayRuleKey ? formData.day_rules[activeDayRuleKey] : undefined;
  const activeDayGroupId = activeDayRuleKey ? formData.day_rule_group_ids[activeDayRuleKey] : '';
  const activeDayGroup = activeDayGroupId ? formData.groups.find((group) => group.id === activeDayGroupId) : undefined;
  const selectedAttendanceDrafts = attendanceDrafts.filter(isAttendanceSelected);
  const attendancePlannedTotal = selectedAttendanceDrafts.reduce((total, draft) => total + draft.planned_hours, 0);
  const attendanceWorkedTotal = selectedAttendanceDrafts.reduce((total, draft) => total + getAttendanceWorkedHours(draft), 0);
  const attendanceBalance = selectedAttendanceDrafts.reduce((total, draft) => total + getAttendanceBalance(draft), 0);
  const selectedMonthlyAttendanceDrafts = monthlyAttendanceDrafts.filter(isAttendanceSelected);
  const monthlyAttendancePlannedTotal = selectedMonthlyAttendanceDrafts.reduce((total, draft) => total + draft.planned_hours, 0);
  const monthlyAttendanceWorkedTotal = selectedMonthlyAttendanceDrafts.reduce((total, draft) => total + getAttendanceWorkedHours(draft), 0);
  const monthlyAttendanceBalance = selectedMonthlyAttendanceDrafts.reduce((total, draft) => total + getAttendanceBalance(draft), 0);
  const monthlyAttendanceDays = new Set(selectedMonthlyAttendanceDrafts.map((draft) => draft.date)).size;

  function renderBuilderDialogContent() {
    if (builderDialog === 'scope') {
      return (
        <div className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Escopo da escala</DialogTitle>
            <DialogDescription>Escolha quem entra nesta geração.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-4">
              <label className="text-sm md:max-w-sm">
                <span className="mb-1.5 block font-medium">Aplicar em</span>
                <select value={formData.technician_scope} onChange={(event) => setFormData((current) => ({ ...current, technician_scope: event.target.value as 'all' | 'selected' }))} className={inputClassName}>
                  <option value="all">Todos os técnicos ativos</option>
                  <option value="selected">Apenas técnicos selecionados</option>
                </select>
              </label>

              {formData.technician_scope === 'selected' ? (
                <TechnicianChecklist technicians={sortedTechnicians} value={formData.technician_ids} onToggle={toggleTechnicianSelection} emptyLabel="Não há técnicos ativos reais para selecionar." />
              ) : (
                <p className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">Todos os técnicos ativos serão incluídos.</p>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button type="button" onClick={() => setBuilderDialog(null)}>Concluir</Button>
          </DialogFooter>
        </div>
      );
    }

    if (builderDialog === 'groups') {
      return (
        <div className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Grupos</DialogTitle>
            <DialogDescription>Crie grupos para usar na cobertura com equipe selecionada.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex justify-end">
              <Button type="button" variant="outline" onClick={addGroup}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-3">
              {formData.groups.length ? (
                formData.groups.map((group, index) => (
                  <div key={group.id} className="rounded-lg border border-border/70 bg-background p-4">
                    <div className="mb-3 flex items-end justify-between gap-3">
                      <label className="min-w-0 flex-1 text-sm">
                        <span className="mb-1.5 block font-medium">Nome do grupo</span>
                        <input value={group.name} onChange={(event) => updateGroupName(group.id, event.target.value)} placeholder={`Ex.: Grupo ${index + 1}`} className={inputClassName} />
                      </label>

                      <Button type="button" variant="outline" onClick={() => removeGroup(group.id)}>
                        <Trash2 className="h-4 w-4" />
                        Remover
                      </Button>
                    </div>

                    <div>
                      <p className="mb-1.5 text-sm font-medium text-foreground">Quem participa</p>
                      <TechnicianChecklist technicians={ruleTechnicians} value={group.technician_ids} onToggle={(technicianId) => toggleGroupTechnician(group.id, technicianId)} emptyLabel="Selecione primeiro o escopo da escala para montar o grupo." />
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhum grupo criado.</p>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button type="button" onClick={() => setBuilderDialog(null)}>Concluir</Button>
          </DialogFooter>
        </div>
      );
    }

    if (builderDialog === 'recurring') {
      return (
        <div className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Recorrências</DialogTitle>
            <DialogDescription>Regras fixas por técnico e dia da semana.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex justify-end">
              <Button type="button" variant="outline" onClick={addRecurringRule}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-3">
              {formData.recurring_rules.length ? (
                formData.recurring_rules.map((rule) => (
                  <div key={rule.id} className="rounded-lg border border-border/70 bg-background p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{sortedTechnicians.find((technician) => technician.id === rule.technician_id)?.name || 'Regra recorrente'}</p>
                        <p className="text-xs text-muted-foreground">{formatDayKeyList(rule.day_keys)}</p>
                      </div>
                      <StatusBadge tone={getStatusTone(rule.status)}>{getStatusLabel(rule.status)}</StatusBadge>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <label className="text-sm xl:col-span-2">
                        <span className="mb-1.5 block font-medium">Técnico</span>
                        <select value={rule.technician_id} onChange={(event) => updateRecurringRule(rule.id, 'technician_id', event.target.value)} className={inputClassName}>
                          <option value="">Selecione</option>
                          {sortedTechnicians.map((technician) => (
                            <option key={technician.id} value={technician.id}>{technician.name}</option>
                          ))}
                        </select>
                      </label>

                      <div className="flex items-end xl:justify-end">
                        <Button type="button" variant="outline" onClick={() => removeRecurringRule(rule.id)}>
                          <Trash2 className="h-4 w-4" />
                          Remover
                        </Button>
                      </div>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Tipo</span>
                        <select value={rule.status} onChange={(event) => updateRecurringRule(rule.id, 'status', event.target.value)} className={inputClassName}>
                          <option value="cancelled">Folga recorrente</option>
                          <option value="scheduled">Turno recorrente</option>
                          <option value="completed">Turno recorrente concluído</option>
                        </select>
                      </label>

                      {rule.status !== 'cancelled' ? (
                        <>
                          <label className="text-sm">
                            <span className="mb-1.5 block font-medium">Entrada</span>
                            <input type="time" value={rule.start_time || ''} onChange={(event) => updateRecurringRule(rule.id, 'start_time', event.target.value)} className={inputClassName} />
                          </label>

                          <label className="text-sm">
                            <span className="mb-1.5 block font-medium">Saída</span>
                            <input type="time" value={rule.end_time || ''} onChange={(event) => updateRecurringRule(rule.id, 'end_time', event.target.value)} className={inputClassName} />
                          </label>
                        </>
                      ) : null}

                      <label className="text-sm md:col-span-2 xl:col-span-3">
                        <span className="mb-1.5 block font-medium">Observação</span>
                        <input value={rule.notes || ''} onChange={(event) => updateRecurringRule(rule.id, 'notes', event.target.value)} placeholder="Ex.: folga fixa, plantão de fechamento" className={inputClassName} />
                      </label>

                      <div className="md:col-span-2 xl:col-span-3">
                        <p className="mb-1.5 text-sm font-medium text-foreground">Dias da semana</p>
                        <DayKeyChecklist value={rule.day_keys} onToggle={(dayKey) => toggleRecurringRuleDay(rule.id, dayKey)} />
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhuma regra fixa adicionada.</p>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button type="button" onClick={() => setBuilderDialog(null)}>Concluir</Button>
          </DialogFooter>
        </div>
      );
    }

    if (builderDialog === 'rotation') {
      return (
        <div className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Revezamentos</DialogTitle>
            <DialogDescription>Selecione os dias e os técnicos do revezamento.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex justify-end">
              <Button type="button" variant="outline" onClick={addRotationGroup}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-3">
              {formData.rotation_groups.length ? (
                formData.rotation_groups.map((group, index) => {
                  const previewRows = getRotationPreviewRows(group);
                  const availableTechnicians = ruleTechnicians.filter((technician) => selectedTechnicianIds.includes(technician.id));
                  const { firstTeam, nextTeam } = getRotationTeams(group.technician_ids, availableTechnicians.map((technician) => technician.id));
                  const firstTeamTechnicians = firstTeam
                    .map((technicianId) => availableTechnicians.find((technician) => technician.id === technicianId))
                    .filter((technician): technician is Technician => Boolean(technician));
                  const nextTeamTechnicians = nextTeam
                    .map((technicianId) => availableTechnicians.find((technician) => technician.id === technicianId))
                    .filter((technician): technician is Technician => Boolean(technician));

                  return (
                    <div key={group.id} className="rounded-lg border border-border/70 bg-background p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">Revezamento {index + 1}</p>
                        <Button type="button" variant="outline" onClick={() => removeRotationGroup(group.id)}>
                          <Trash2 className="h-4 w-4" />
                          Remover
                        </Button>
                      </div>

                      <div className="grid gap-4">
                        <div>
                          <p className="mb-1.5 text-sm font-medium text-foreground">Dias</p>
                          <DayKeyChecklist value={group.day_keys} onToggle={(dayKey) => toggleRotationGroupDay(group.id, dayKey)} />
                        </div>

                        <div>
                          <p className="mb-1.5 text-sm font-medium text-foreground">Técnicos do revezamento</p>
                          <p className="mb-2 text-xs text-muted-foreground">Marque quem trabalha na primeira ocorrência. Na próxima, entram os que ficaram desmarcados.</p>
                          {firstTeamTechnicians.length ? (
                            <div className="mb-3 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-medium text-muted-foreground">Primeira ocorrência:</span>
                                {firstTeamTechnicians.map((technician) => (
                                  <StatusBadge key={technician.id} tone="success">{technician.name}</StatusBadge>
                                ))}
                              </div>
                              {nextTeamTechnicians.length ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-medium text-muted-foreground">Próxima ocorrência:</span>
                                  {nextTeamTechnicians.map((technician) => (
                                    <StatusBadge key={technician.id} tone="neutral">{technician.name}</StatusBadge>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <TechnicianChecklist technicians={ruleTechnicians} value={group.technician_ids} onToggle={(technicianId) => toggleRotationGroupTechnician(group.id, technicianId)} emptyLabel="Selecione primeiro o escopo da escala para configurar o revezamento." />
                        </div>

                        <div className="rounded-lg border border-border/70 bg-card/60">
                          <div className="border-b border-border/70 px-3 py-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Próximas ocorrências</p>
                          </div>

                          {previewRows.length ? (
                            <div className="space-y-2 p-3">
                              {previewRows.map((row) => (
                                <div key={`${group.id}-${row.date}`} className="rounded-md border border-border/70 bg-background px-3 py-2">
                                  <p className="text-sm font-medium text-foreground">{formatDate(row.date)} • {row.dayLabel}</p>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {row.workerNames.map((workerName) => (
                                      <StatusBadge key={`${row.date}-${workerName}`} tone="success">{workerName}</StatusBadge>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {previewRows.length ? null : (
                            <p className="px-3 py-4 text-sm text-muted-foreground">
                              Marque ao menos 1 técnico, deixe ao menos 1 desmarcado e escolha 1 dia para ver o revezamento.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                  Nenhum revezamento criado.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button type="button" onClick={() => setBuilderDialog(null)}>Concluir</Button>
          </DialogFooter>
        </div>
      );
    }

    if (builderDialog === 'general-days-off') {
      return (
        <div className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Folga geral</DialogTitle>
            <DialogDescription>Datas sem expediente para todo o escopo.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex justify-end">
              <Button type="button" variant="outline" onClick={addGeneralDayOff}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-3">
              {formData.general_days_off.length ? (
                formData.general_days_off.map((item) => (
                  <div key={item.id} className="grid gap-3 rounded-lg border border-border/70 bg-background p-4 md:grid-cols-[0.9fr_1.3fr_auto]">
                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Data</span>
                      <input type="date" value={item.date} min={generationPreview.startDate} max={generationPreview.endDate} onChange={(event) => updateGeneralDayOff(item.id, 'date', event.target.value)} className={inputClassName} />
                    </label>

                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Observação</span>
                      <input value={item.notes} onChange={(event) => updateGeneralDayOff(item.id, 'notes', event.target.value)} placeholder="Ex.: feriado, recesso" className={inputClassName} />
                    </label>

                    <div className="flex items-end">
                      <Button type="button" variant="outline" onClick={() => removeGeneralDayOff(item.id)}>
                        <Trash2 className="h-4 w-4" />
                        Remover
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhuma folga geral adicional.</p>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button type="button" onClick={() => setBuilderDialog(null)}>Concluir</Button>
          </DialogFooter>
        </div>
      );
    }

    if (builderDialog === 'overrides') {
      return (
        <div className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Ajustes individuais</DialogTitle>
            <DialogDescription>Folgas ou turnos pontuais por técnico.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex justify-end">
              <Button type="button" variant="outline" onClick={addOverride}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-3">
              {formData.overrides.length ? (
                formData.overrides.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border/70 bg-background p-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <label className="text-sm xl:col-span-3">
                        <span className="mb-1.5 block font-medium">Técnico</span>
                        <select value={item.technician_id} onChange={(event) => updateOverride(item.id, 'technician_id', event.target.value)} className={inputClassName}>
                          <option value="">Selecione</option>
                          {sortedTechnicians.map((technician) => (
                            <option key={technician.id} value={technician.id}>{technician.name}</option>
                          ))}
                        </select>
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Data</span>
                        <input type="date" value={item.date} min={generationPreview.startDate} max={generationPreview.endDate} onChange={(event) => updateOverride(item.id, 'date', event.target.value)} className={inputClassName} />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Tipo</span>
                        <select value={item.status} onChange={(event) => updateOverride(item.id, 'status', event.target.value)} className={inputClassName}>
                          <option value="cancelled">Folga individual</option>
                          <option value="scheduled">Turno individual</option>
                          <option value="completed">Turno concluído</option>
                        </select>
                      </label>

                      <div className="flex items-end xl:justify-end">
                        <Button type="button" variant="outline" onClick={() => removeOverride(item.id)}>
                          <Trash2 className="h-4 w-4" />
                          Remover
                        </Button>
                      </div>

                      {item.status !== 'cancelled' ? (
                        <>
                          <label className="text-sm">
                            <span className="mb-1.5 block font-medium">Entrada</span>
                            <input type="time" value={item.start_time} onChange={(event) => updateOverride(item.id, 'start_time', event.target.value)} className={inputClassName} />
                          </label>

                          <label className="text-sm">
                            <span className="mb-1.5 block font-medium">Saída</span>
                            <input type="time" value={item.end_time} onChange={(event) => updateOverride(item.id, 'end_time', event.target.value)} className={inputClassName} />
                          </label>
                        </>
                      ) : null}

                      <label className="text-sm md:col-span-2 xl:col-span-3">
                        <span className="mb-1.5 block font-medium">Observação</span>
                        <input value={item.notes} onChange={(event) => updateOverride(item.id, 'notes', event.target.value)} placeholder="Ex.: plantão especial, folga compensatória" className={inputClassName} />
                      </label>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhum ajuste individual.</p>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button type="button" onClick={() => setBuilderDialog(null)}>Concluir</Button>
          </DialogFooter>
        </div>
      );
    }

    return null;
  }

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Planejamento"
        title="Montagem da escala"
        description="Monte a escala diária, semanal, mensal ou anual com regras por dia, horários específicos, revezamentos, recorrências fixas, folgas gerais e ajustes individuais por técnico."
      >
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => handleAttendanceDialogChange(true)}>
            <Clock3 className="h-4 w-4" />
            Apontar horas
          </Button>
          <Button type="button" onClick={() => setIsFormDialogOpen(true)}>
            <WandSparkles className="h-4 w-4" />
            Montar escala
          </Button>
        </div>
      </PageHeader>

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}
      {saveMessage ? <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{saveMessage}</div> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard title="Trabalham hoje" value={workingToday} hint="Com escala real salva para hoje" icon={CalendarDays} />
        <MetricCard title="Folgas hoje" value={dayOffToday} hint="Cancelamentos reais para hoje" icon={CalendarDays} tone="warning" />
        <MetricCard title="Linhas salvas" value={visibleSchedule.length} hint="Registros reais no banco" icon={Clock3} tone="success" />
        <MetricCard title="Técnicos cobertos" value={coveredTechnicians} hint="Com algum período persistido" icon={Users} />
      </div>

      <Dialog open={isFormDialogOpen} onOpenChange={handleFormDialogChange}>
        <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-6xl">
          <div className="flex max-h-[92vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Montar escala</DialogTitle>
              <DialogDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Defina período, equipe e regra semanal. Ao salvar, a escala aberta do período é substituída e os dias já concluídos são preservados.
              </DialogDescription>
            </DialogHeader>

            <form id="schedule-builder-form" onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-7">
              {formError ? <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{formError}</div> : null}

              <div className="grid gap-4 xl:grid-cols-[1fr_0.85fr]">
                <section className="rounded-lg border border-border/70 bg-card/70 p-4 shadow-sm">
                  <div className="mb-4 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Período</p>
                    <h3 className="text-base font-semibold text-foreground">Competência da escala</h3>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Modo</span>
                      <select value={formData.period_mode} onChange={(event) => setFormData((current) => ({ ...current, period_mode: event.target.value as SchedulePeriodMode }))} className={inputClassName}>
                        <option value="day">Diário</option>
                        <option value="week">Semanal</option>
                        <option value="month">Mensal</option>
                        <option value="year">Anual</option>
                      </select>
                    </label>

                    {formData.period_mode === 'day' || formData.period_mode === 'week' ? (
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">{formData.period_mode === 'day' ? 'Data' : 'Semana de referência'}</span>
                        <input type="date" value={formData.date} onChange={(event) => setFormData((current) => ({ ...current, date: event.target.value }))} className={inputClassName} />
                      </label>
                    ) : null}

                    {formData.period_mode === 'month' ? (
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Mês</span>
                        <select value={formData.month} onChange={(event) => setFormData((current) => ({ ...current, month: Number(event.target.value) }))} className={inputClassName}>
                          {monthNames.map((month, index) => (
                            <option key={month} value={index + 1}>{month}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {formData.period_mode === 'month' || formData.period_mode === 'year' ? (
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Ano</span>
                        <select value={formData.year} onChange={(event) => setFormData((current) => ({ ...current, year: Number(event.target.value) }))} className={inputClassName}>
                          {Array.from({ length: 6 }, (_, index) => new Date().getFullYear() - 1 + index).map((year) => (
                            <option key={year} value={year}>{year}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>

                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
                    {formatDate(range.startDate)} até {formatDate(range.endDate)}
                  </div>
                </section>

                <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Resumo</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-sm text-emerald-950">
                    <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{scopeSummary}</span>
                    <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(generationPreview.totalRows, 'linha prevista', 'linhas previstas')}</span>
                    <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{optionalAdjustmentsCount} ajustes</span>
                  </div>
                </section>
              </div>

              <section className="mt-4 rounded-lg border border-border/70 bg-card/70 p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Configurações</p>
                    <h3 className="text-base font-semibold text-foreground">Escopo e ajustes</h3>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <BuilderActionCard eyebrow="Escopo" title="Quem entra" value={scopeSummary} onClick={() => setBuilderDialog('scope')} />
                  <BuilderActionCard eyebrow="Grupo" title="Coberturas" value={formatCount(formData.groups.length, 'grupo', 'grupos')} onClick={() => setBuilderDialog('groups')} />
                  <BuilderActionCard eyebrow="Recorrências" title="Regras fixas" value={formatCount(formData.recurring_rules.length, 'regra', 'regras')} onClick={() => setBuilderDialog('recurring')} />
                  <BuilderActionCard eyebrow="Revezamento" title="Regras" value={formatCount(formData.rotation_groups.length, 'regra', 'regras')} onClick={() => setBuilderDialog('rotation')} />
                  <BuilderActionCard eyebrow="Folga geral" title="Datas sem expediente" value={formatCount(formData.general_days_off.length, 'data', 'datas')} onClick={() => setBuilderDialog('general-days-off')} />
                  <BuilderActionCard eyebrow="Individual" title="Exceções por técnico" value={formatCount(formData.overrides.length, 'ajuste', 'ajustes')} onClick={() => setBuilderDialog('overrides')} />
                </div>
              </section>

              <div className="hidden">
                <div className="space-y-4">
                  <section className="rounded-lg border border-border/70 bg-card/70 p-4 shadow-sm">
                    <div className="mb-4 space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Período</p>
                      <h3 className="text-base font-semibold text-foreground">Competência da escala</h3>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Modo</span>
                        <select value={formData.period_mode} onChange={(event) => setFormData((current) => ({ ...current, period_mode: event.target.value as SchedulePeriodMode }))} className={inputClassName}>
                          <option value="day">Diário</option>
                          <option value="week">Semanal</option>
                          <option value="month">Mensal</option>
                          <option value="year">Anual</option>
                        </select>
                      </label>

                      {formData.period_mode === 'month' ? (
                        <label className="text-sm">
                          <span className="mb-1.5 block font-medium">Mês</span>
                          <select value={formData.month} onChange={(event) => setFormData((current) => ({ ...current, month: Number(event.target.value) }))} className={inputClassName}>
                            {monthNames.map((month, index) => (
                              <option key={month} value={index + 1}>
                                {month}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Ano</span>
                        <select value={formData.year} onChange={(event) => setFormData((current) => ({ ...current, year: Number(event.target.value) }))} className={inputClassName}>
                          {Array.from({ length: 6 }, (_, index) => new Date().getFullYear() - 1 + index).map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
                      {formatDate(range.startDate)} até {formatDate(range.endDate)}
                    </div>
                  </section>

                  <section className="rounded-lg border border-border/70 bg-card/70 p-4 shadow-sm">
                    <div className="mb-4 space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Escopo</p>
                      <h3 className="text-base font-semibold text-foreground">Quem entra na escala</h3>
                    </div>

                    <div className="grid gap-4">
                      <label className="text-sm md:max-w-sm">
                        <span className="mb-1.5 block font-medium">Aplicar em</span>
                        <select value={formData.technician_scope} onChange={(event) => setFormData((current) => ({ ...current, technician_scope: event.target.value as 'all' | 'selected' }))} className={inputClassName}>
                          <option value="all">Todos os técnicos ativos</option>
                          <option value="selected">Apenas técnicos selecionados</option>
                        </select>
                      </label>

                      {formData.technician_scope === 'selected' ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Selecione os técnicos</p>
                          <TechnicianChecklist technicians={sortedTechnicians} value={formData.technician_ids} onToggle={toggleTechnicianSelection} emptyLabel="Não há técnicos ativos reais para selecionar." />
                        </div>
                      ) : (
                        <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
                          Todos os técnicos ativos serão incluídos.
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                <div className="space-y-4">
                  <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-950">
                      <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2 font-semibold">{formatDate(generationPreview.startDate)} até {formatDate(generationPreview.endDate)}</span>
                      <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(generationPreview.technicianCount, 'técnico', 'técnicos')}</span>
                      <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(generationPreview.totalRows, 'linha prevista', 'linhas previstas')}</span>
                      <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formData.recurring_rules.length + formData.rotation_groups.length + formData.general_days_off.length + formData.overrides.length} ajustes</span>
                    </div>
                    <p className="mt-3 text-xs text-emerald-900">Regras semanais vêm primeiro; exceções pontuais ajustam o resultado.</p>
                  </section>

                  <details className="rounded-lg border border-border/70 bg-card/70 shadow-sm">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                      <span>
                        <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Recorrências</span>
                        <span className="text-sm font-semibold text-foreground">Regras fixas por técnico</span>
                      </span>
                      <StatusBadge tone="neutral">{formData.recurring_rules.length}</StatusBadge>
                    </summary>

                    <div className="border-t border-border/70 p-4">
                      <div className="mb-3 flex justify-end">
                        <Button type="button" variant="outline" onClick={addRecurringRule}>
                          <Plus className="h-4 w-4" />
                          Adicionar
                        </Button>
                      </div>

                      <div className="space-y-3">
                      {formData.recurring_rules.length ? (
                        formData.recurring_rules.map((rule) => (
                          <div key={rule.id} className="rounded-2xl border border-border/70 bg-background p-4">
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-foreground">{sortedTechnicians.find((technician) => technician.id === rule.technician_id)?.name || 'Regra recorrente'}</p>
                                <p className="text-xs text-muted-foreground">{formatDayKeyList(rule.day_keys)}</p>
                              </div>
                              <StatusBadge tone={getStatusTone(rule.status)}>{getStatusLabel(rule.status)}</StatusBadge>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                              <label className="text-sm xl:col-span-2">
                                <span className="mb-1.5 block font-medium">Técnico</span>
                                <select value={rule.technician_id} onChange={(event) => updateRecurringRule(rule.id, 'technician_id', event.target.value)} className={inputClassName}>
                                  <option value="">Selecione</option>
                                  {sortedTechnicians.map((technician) => (
                                    <option key={technician.id} value={technician.id}>
                                      {technician.name}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <div className="flex items-end xl:justify-end">
                                <Button type="button" variant="outline" onClick={() => removeRecurringRule(rule.id)}>
                                  <Trash2 className="h-4 w-4" />
                                  Remover
                                </Button>
                              </div>

                              <label className="text-sm">
                                <span className="mb-1.5 block font-medium">Tipo</span>
                                <select value={rule.status} onChange={(event) => updateRecurringRule(rule.id, 'status', event.target.value)} className={inputClassName}>
                                  <option value="cancelled">Folga recorrente</option>
                                  <option value="scheduled">Turno recorrente</option>
                                  <option value="completed">Turno recorrente concluído</option>
                                </select>
                              </label>

                              {rule.status !== 'cancelled' ? (
                                <>
                                  <label className="text-sm">
                                    <span className="mb-1.5 block font-medium">Entrada</span>
                                    <input type="time" value={rule.start_time || ''} onChange={(event) => updateRecurringRule(rule.id, 'start_time', event.target.value)} className={inputClassName} />
                                  </label>

                                  <label className="text-sm">
                                    <span className="mb-1.5 block font-medium">Saída</span>
                                    <input type="time" value={rule.end_time || ''} onChange={(event) => updateRecurringRule(rule.id, 'end_time', event.target.value)} className={inputClassName} />
                                  </label>
                                </>
                              ) : (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:col-span-2">
                                  Use esta regra para tirar um técnico sempre dos mesmos dias da semana.
                                </div>
                              )}

                              <label className="text-sm md:col-span-2 xl:col-span-3">
                                <span className="mb-1.5 block font-medium">Observação</span>
                                <input value={rule.notes || ''} onChange={(event) => updateRecurringRule(rule.id, 'notes', event.target.value)} placeholder="Ex.: folga fixa, plantão de fechamento, turno reduzido" className={inputClassName} />
                              </label>

                              <div className="md:col-span-2 xl:col-span-3">
                                <p className="mb-1.5 text-sm font-medium text-foreground">Dias da semana</p>
                                <DayKeyChecklist value={rule.day_keys} onToggle={(dayKey) => toggleRecurringRuleDay(rule.id, dayKey)} />
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhuma regra fixa adicionada.</p>
                      )}
                      </div>
                    </div>
                  </details>

                  <details className="rounded-lg border border-border/70 bg-card/70 shadow-sm">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                      <span>
                        <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Revezamento</span>
                        <span className="text-sm font-semibold text-foreground">Regras de revezamento</span>
                      </span>
                      <StatusBadge tone="neutral">{formData.rotation_groups.length}</StatusBadge>
                    </summary>

                    <div className="border-t border-border/70 p-4">
                      <div className="mb-3 flex justify-end">
                        <Button type="button" variant="outline" onClick={addRotationGroup}>
                          <Plus className="h-4 w-4" />
                          Adicionar
                        </Button>
                      </div>

                      <div className="space-y-3">
                      {formData.rotation_groups.length ? (
                        formData.rotation_groups.map((group, index) => (
                          <div key={group.id} className="rounded-2xl border border-border/70 bg-background p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-foreground">Revezamento {index + 1}</p>
                              <Button type="button" variant="outline" onClick={() => removeRotationGroup(group.id)}>
                                <Trash2 className="h-4 w-4" />
                                Remover
                              </Button>
                            </div>

                            <div className="grid gap-3">
                              <div>
                                <p className="mb-1.5 text-sm font-medium text-foreground">Dias</p>
                                <DayKeyChecklist value={group.day_keys} onToggle={(dayKey) => toggleRotationGroupDay(group.id, dayKey)} />
                              </div>

                              <div>
                                <p className="mb-1.5 text-sm font-medium text-foreground">Técnicos</p>
                                <TechnicianChecklist technicians={ruleTechnicians} value={group.technician_ids} onToggle={(technicianId) => toggleRotationGroupTechnician(group.id, technicianId)} emptyLabel="Selecione primeiro o escopo da escala para configurar o revezamento." />
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhum revezamento criado.</p>
                      )}
                      </div>
                    </div>
                  </details>
                </div>
              </div>

              <div className="hidden">
                <details className="rounded-lg border border-border/70 bg-card/70 shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                    <span>
                      <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Folga geral</span>
                      <span className="text-sm font-semibold text-foreground">Datas sem expediente</span>
                    </span>
                    <StatusBadge tone="neutral">{formData.general_days_off.length}</StatusBadge>
                  </summary>

                  <div className="border-t border-border/70 p-4">
                    <div className="mb-3 flex justify-end">
                      <Button type="button" variant="outline" onClick={addGeneralDayOff}>
                        <Plus className="h-4 w-4" />
                        Adicionar
                      </Button>
                    </div>

                    <div className="space-y-3">
                    {formData.general_days_off.length ? (
                      formData.general_days_off.map((item) => (
                        <div key={item.id} className="grid gap-3 rounded-lg border border-border/70 bg-background p-4 md:grid-cols-[0.9fr_1.3fr_auto]">
                          <label className="text-sm">
                            <span className="mb-1.5 block font-medium">Data</span>
                            <input type="date" value={item.date} min={generationPreview.startDate} max={generationPreview.endDate} onChange={(event) => updateGeneralDayOff(item.id, 'date', event.target.value)} className={inputClassName} />
                          </label>

                          <label className="text-sm">
                            <span className="mb-1.5 block font-medium">Observação</span>
                            <input value={item.notes} onChange={(event) => updateGeneralDayOff(item.id, 'notes', event.target.value)} placeholder="Ex.: feriado, confraternização, recesso" className={inputClassName} />
                          </label>

                          <div className="flex items-end">
                            <Button type="button" variant="outline" onClick={() => removeGeneralDayOff(item.id)}>
                              <Trash2 className="h-4 w-4" />
                              Remover
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhuma folga geral adicional.</p>
                    )}
                    </div>
                  </div>
                </details>

                <details className="rounded-lg border border-border/70 bg-card/70 shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                    <span>
                      <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Ajuste individual</span>
                      <span className="text-sm font-semibold text-foreground">Folga ou turno por técnico</span>
                    </span>
                    <StatusBadge tone="neutral">{formData.overrides.length}</StatusBadge>
                  </summary>

                  <div className="border-t border-border/70 p-4">
                    <div className="mb-3 flex justify-end">
                      <Button type="button" variant="outline" onClick={addOverride}>
                        <Plus className="h-4 w-4" />
                        Adicionar
                      </Button>
                    </div>

                    <div className="space-y-3">
                    {formData.overrides.length ? (
                      formData.overrides.map((item) => (
                        <div key={item.id} className="rounded-lg border border-border/70 bg-background p-4">
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <label className="text-sm xl:col-span-3">
                              <span className="mb-1.5 block font-medium">Técnico</span>
                              <select value={item.technician_id} onChange={(event) => updateOverride(item.id, 'technician_id', event.target.value)} className={inputClassName}>
                                <option value="">Selecione</option>
                                {sortedTechnicians.map((technician) => (
                                  <option key={technician.id} value={technician.id}>
                                    {technician.name}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="text-sm">
                              <span className="mb-1.5 block font-medium">Data</span>
                              <input type="date" value={item.date} min={generationPreview.startDate} max={generationPreview.endDate} onChange={(event) => updateOverride(item.id, 'date', event.target.value)} className={inputClassName} />
                            </label>

                            <label className="text-sm">
                              <span className="mb-1.5 block font-medium">Tipo</span>
                              <select value={item.status} onChange={(event) => updateOverride(item.id, 'status', event.target.value)} className={inputClassName}>
                                <option value="cancelled">Folga individual</option>
                                <option value="scheduled">Turno individual</option>
                                <option value="completed">Turno concluído</option>
                              </select>
                            </label>

                            <div className="flex items-end xl:justify-end">
                              <Button type="button" variant="outline" onClick={() => removeOverride(item.id)}>
                                <Trash2 className="h-4 w-4" />
                                Remover
                              </Button>
                            </div>

                            {item.status !== 'cancelled' ? (
                              <>
                                <label className="text-sm">
                                  <span className="mb-1.5 block font-medium">Entrada</span>
                                  <input type="time" value={item.start_time} onChange={(event) => updateOverride(item.id, 'start_time', event.target.value)} className={inputClassName} />
                                </label>

                                <label className="text-sm">
                                  <span className="mb-1.5 block font-medium">Saída</span>
                                  <input type="time" value={item.end_time} onChange={(event) => updateOverride(item.id, 'end_time', event.target.value)} className={inputClassName} />
                                </label>
                              </>
                            ) : (
                              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:col-span-2">
                                Esta folga individual será gravada como cancelamento do dia.
                              </div>
                            )}

                            <label className="text-sm md:col-span-2 xl:col-span-3">
                              <span className="mb-1.5 block font-medium">Observação</span>
                              <input value={item.notes} onChange={(event) => updateOverride(item.id, 'notes', event.target.value)} placeholder="Ex.: plantão especial, folga compensatória" className={inputClassName} />
                            </label>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhum ajuste individual.</p>
                    )}
                    </div>
                  </div>
                </details>
              </div>

              <section className="mt-4 rounded-lg border border-border/70 bg-card/70 p-4 shadow-sm">
                <div className="mb-4 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Grade semanal</p>
                  <h3 className="text-base font-semibold text-foreground">Horário padrão e regras por dia</h3>
                </div>

                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-lg border border-border/70 bg-background p-3">
                    <p className="text-sm font-semibold text-foreground">Dias úteis</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Entrada</span>
                        <input type="time" value={formData.weekday_start_time} onChange={(event) => setFormData((current) => ({ ...current, weekday_start_time: event.target.value }))} className={inputClassName} />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Saída</span>
                        <input type="time" value={formData.weekday_end_time} onChange={(event) => setFormData((current) => ({ ...current, weekday_end_time: event.target.value }))} className={inputClassName} />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-background p-3">
                    <p className="text-sm font-semibold text-foreground">Fim de semana</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Entrada</span>
                        <input type="time" value={formData.weekend_start_time} onChange={(event) => setFormData((current) => ({ ...current, weekend_start_time: event.target.value }))} className={inputClassName} />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Saída</span>
                        <input type="time" value={formData.weekend_end_time} onChange={(event) => setFormData((current) => ({ ...current, weekend_end_time: event.target.value }))} className={inputClassName} />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto rounded-lg border border-border/70 bg-background">
                  <table className="w-full min-w-[980px] border-collapse text-sm">
                    <thead className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-3">Dia da semana</th>
                        <th className="px-3 py-3">Cobertura</th>
                        <th className="px-3 py-3">Frequência</th>
                        <th className="px-3 py-3">Técnicos</th>
                        <th className="px-3 py-3">Entrada</th>
                        <th className="px-3 py-3">Saída</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayRuleDefinitions.map(({ key, label, dayLabel }) => (
                        <DayRuleEditor
                          key={key}
                          label={label}
                          dayLabel={dayLabel}
                          rule={formData.day_rules[key]}
                          technicians={ruleTechnicians}
                          selectionLabel={formData.day_rule_group_ids[key] ? formData.groups.find((group) => group.id === formData.day_rule_group_ids[key])?.name || 'Grupo sem nome' : undefined}
                          fallbackStartTime={key === 'saturday' || key === 'sunday' ? formData.weekend_start_time : formData.weekday_start_time}
                          fallbackEndTime={key === 'saturday' || key === 'sunday' ? formData.weekend_end_time : formData.weekday_end_time}
                          onModeChange={(mode) => updateDayRuleMode(key, mode)}
                          onCadenceChange={(cadence) => updateDayRuleCadence(key, cadence)}
                          onStartTimeChange={(value) => updateDayRuleTime(key, 'start_time', value)}
                          onEndTimeChange={(value) => updateDayRuleTime(key, 'end_time', value)}
                          onSetTechnicians={(technicianIds) => setDayRuleTechnicians(key, technicianIds)}
                          onConfigureTechnicians={() => setActiveDayRuleKey(key)}
                          inputClassName={inputClassName}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </form>

            <DialogFooter className="border-t border-border/70 bg-background/95 px-6 py-4 sm:px-7">
              <Button type="button" variant="outline" onClick={() => handleFormDialogChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" form="schedule-builder-form" disabled={isSubmitting} className="min-w-44">
                {isSubmitting ? 'Salvando...' : `Salvar ${formatCount(generationPreview.totalRows, 'linha', 'linhas')}`}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAttendanceDialogOpen} onOpenChange={handleAttendanceDialogChange}>
        <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-[96vw]">
          <div className="flex max-h-[92vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Apontar horas</DialogTitle>
              <DialogDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Lance um dia específico ou feche o mês inteiro usando os horários previstos na escala.
              </DialogDescription>
            </DialogHeader>

            <form id="attendance-form" onSubmit={handleAttendanceSubmit} className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
              {attendanceError ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{attendanceError}</div> : null}
              {attendanceMessage ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{attendanceMessage}</div> : null}

              <div className="mb-4 grid gap-3 lg:grid-cols-[16rem_1fr]">
                <section className="rounded-lg border border-border/70 bg-card/70 p-4">
                  <label className="text-sm">
                    <span className="mb-1.5 block font-medium">Modo</span>
                    <select value={attendanceMode} onChange={(event) => handleAttendanceModeChange(event.target.value as AttendanceMode)} className={inputClassName}>
                      <option value="day">Diário</option>
                      <option value="month">Mensal</option>
                    </select>
                  </label>

                  <label className="mt-3 block text-sm">
                    <span className="mb-1.5 block font-medium">{attendanceMode === 'day' ? 'Data do apontamento' : 'Mês do apontamento'}</span>
                    {attendanceMode === 'day' ? (
                      <input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} className={inputClassName} />
                    ) : (
                      <input type="month" value={attendanceMonth} onChange={(event) => setAttendanceMonth(event.target.value)} className={inputClassName} />
                    )}
                  </label>
                  <Button type="button" variant="outline" onClick={markAttendanceAutomatically} className="mt-3 w-full">
                    <Clock3 className="h-4 w-4" />
                    Marcar automático
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {attendanceMode === 'day'
                      ? 'Automático marca todos com o horário previsto.'
                      : 'Automático marca todos os apontamentos do mês com o horário previsto.'}
                  </p>
                </section>

                <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">{attendanceMode === 'day' ? 'Resumo do dia' : 'Resumo do mês'}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-sm text-emerald-950">
                    {attendanceMode === 'day' ? (
                      <>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(selectedAttendanceDrafts.length, 'técnico', 'técnicos')}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Previsto: {formatHours(attendancePlannedTotal)}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Realizado: {formatHours(attendanceWorkedTotal)}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Saldo: {formatHours(attendanceBalance)}</span>
                      </>
                    ) : (
                      <>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(selectedMonthlyAttendanceDrafts.length, 'apontamento', 'apontamentos')}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(monthlyAttendanceDays, 'dia escalado', 'dias escalados')}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Previsto: {formatHours(monthlyAttendancePlannedTotal)}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Realizado: {formatHours(monthlyAttendanceWorkedTotal)}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Saldo: {formatHours(monthlyAttendanceBalance)}</span>
                      </>
                    )}
                  </div>
                </section>
              </div>

              {attendanceMode === 'day' ? (
              <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
                <table className="w-full min-w-[960px] text-sm">
                  <thead className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-3">Situação</th>
                      <th className="px-3 py-3">Técnico</th>
                      <th className="px-3 py-3">Escala</th>
                      <th className="px-3 py-3">Previsto</th>
                      <th className="px-3 py-3">Entrada</th>
                      <th className="px-3 py-3">Saída</th>
                      <th className="px-3 py-3">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceDrafts.map((draft) => {
                      const hoursWorked = getAttendanceWorkedHours(draft);
                      const balance = getAttendanceBalance(draft);
                      const balanceTone = balance > 0 ? 'success' : balance < 0 ? 'danger' : 'neutral';
                      const plannedLabel = draft.planned_hours > 0
                        ? `${formatTimeRange(draft.planned_start_time, draft.planned_end_time)} • ${formatHours(draft.planned_hours)}`
                        : 'Sem expediente previsto';

                      return (
                        <tr key={draft.key} className="border-t border-border/70">
                          <td className="px-3 py-3">
                            <select
                              value={draft.attendance_status}
                              onChange={(event) => {
                                const status = event.target.value as AttendanceStatus;
                                updateAttendanceDraft(draft.key, {
                                  attendance_status: status,
                                  actual_start_time: draft.actual_start_time || draft.planned_start_time || DEFAULT_START_TIME,
                                  actual_end_time: draft.actual_end_time || draft.planned_end_time || DEFAULT_END_TIME,
                                });
                              }}
                              className="min-h-10 w-36 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
                            >
                              <option value="not_marked">Não lançar</option>
                              <option value="worked">Trabalhou</option>
                              <option value="day_off">Folgou</option>
                              <option value="missed">Faltou</option>
                              <option value="justified">Justificou</option>
                            </select>
                          </td>
                          <td className="px-3 py-3 font-medium text-foreground">{draft.technician_name}</td>
                          <td className="px-3 py-3">
                            <StatusBadge tone={draft.schedule_status === 'cancelled' ? 'warning' : draft.schedule_status === 'completed' ? 'success' : draft.schedule_status === 'scheduled' ? 'info' : 'neutral'}>
                              {draft.schedule_status ? getStatusLabel(draft.schedule_status) : 'Sem escala'}
                            </StatusBadge>
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">{plannedLabel}</td>
                          <td className="px-3 py-3">
                            <input
                              type="time"
                              disabled={draft.attendance_status !== 'worked'}
                              value={draft.actual_start_time}
                              onChange={(event) => updateAttendanceDraft(draft.key, { actual_start_time: event.target.value })}
                              className="min-h-10 w-28 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring disabled:opacity-60"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <input
                              type="time"
                              disabled={draft.attendance_status !== 'worked'}
                              value={draft.actual_end_time}
                              onChange={(event) => updateAttendanceDraft(draft.key, { actual_end_time: event.target.value })}
                              className="min-h-10 w-28 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring disabled:opacity-60"
                            />
                          </td>
                          <td className="px-3 py-3">
                            {isAttendanceSelected(draft) ? (
                              <div className="space-y-1">
                                <StatusBadge tone={balanceTone}>{balance >= 0 ? `+${formatHours(balance)}` : `-${formatHours(Math.abs(balance))}`}</StatusBadge>
                                <p className="text-xs text-muted-foreground">{getAttendanceResultLabel(draft, hoursWorked)}</p>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
                  <table className="w-full min-w-[1120px] text-sm">
                    <thead className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-3">Data</th>
                        <th className="px-3 py-3">Situação</th>
                        <th className="px-3 py-3">Técnico</th>
                        <th className="px-3 py-3">Escala</th>
                        <th className="px-3 py-3">Previsto</th>
                        <th className="px-3 py-3">Entrada</th>
                        <th className="px-3 py-3">Saída</th>
                        <th className="px-3 py-3">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyAttendanceDrafts.length ? monthlyAttendanceDrafts.map((draft) => {
                        const hoursWorked = getAttendanceWorkedHours(draft);
                        const balance = getAttendanceBalance(draft);
                        const balanceTone = balance > 0 ? 'success' : balance < 0 ? 'danger' : 'neutral';
                        const plannedLabel = draft.planned_hours > 0
                          ? `${formatTimeRange(draft.planned_start_time, draft.planned_end_time)} • ${formatHours(draft.planned_hours)}`
                          : 'Sem expediente previsto';

                        return (
                          <tr key={draft.key} className="border-t border-border/70">
                            <td className="px-3 py-3 text-muted-foreground">{formatDate(draft.date)}</td>
                            <td className="px-3 py-3">
                              <select
                                value={draft.attendance_status}
                                onChange={(event) => {
                                  const status = event.target.value as AttendanceStatus;
                                  updateMonthlyAttendanceDraft(draft.key, {
                                    attendance_status: status,
                                    actual_start_time: draft.actual_start_time || draft.planned_start_time || DEFAULT_START_TIME,
                                    actual_end_time: draft.actual_end_time || draft.planned_end_time || DEFAULT_END_TIME,
                                  });
                                }}
                                className="min-h-10 w-36 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
                              >
                                <option value="not_marked">Não lançar</option>
                                <option value="worked">Trabalhou</option>
                                <option value="day_off">Folgou</option>
                                <option value="missed">Faltou</option>
                                <option value="justified">Justificou</option>
                              </select>
                            </td>
                            <td className="px-3 py-3 font-medium text-foreground">{draft.technician_name}</td>
                            <td className="px-3 py-3">
                              <StatusBadge tone={draft.schedule_status === 'cancelled' ? 'warning' : draft.schedule_status === 'completed' ? 'success' : draft.schedule_status === 'scheduled' ? 'info' : 'neutral'}>
                                {draft.schedule_status ? getStatusLabel(draft.schedule_status) : 'Sem escala'}
                              </StatusBadge>
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">{plannedLabel}</td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                disabled={draft.attendance_status !== 'worked'}
                                value={draft.actual_start_time}
                                onChange={(event) => updateMonthlyAttendanceDraft(draft.key, { actual_start_time: event.target.value })}
                                className="min-h-10 w-28 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring disabled:opacity-60"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                disabled={draft.attendance_status !== 'worked'}
                                value={draft.actual_end_time}
                                onChange={(event) => updateMonthlyAttendanceDraft(draft.key, { actual_end_time: event.target.value })}
                                className="min-h-10 w-28 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring disabled:opacity-60"
                              />
                            </td>
                            <td className="px-3 py-3">
                              {isAttendanceSelected(draft) ? (
                                <div className="space-y-1">
                                  <StatusBadge tone={balanceTone}>{balance >= 0 ? `+${formatHours(balance)}` : `-${formatHours(Math.abs(balance))}`}</StatusBadge>
                                  <p className="text-xs text-muted-foreground">{getAttendanceResultLabel(draft, hoursWorked)}</p>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Nenhuma escala ativa salva para este mês.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </form>

            <DialogFooter className="items-center border-t border-border/70 bg-background/95 px-6 py-4 sm:justify-between sm:px-7">
              <div className="min-h-5 flex-1 text-sm">
                {attendanceError ? <span className="text-rose-700">{attendanceError}</span> : null}
                {attendanceMessage ? <span className="text-emerald-700">{attendanceMessage}</span> : null}
                {isAttendanceSubmitting ? (
                  <span className="text-muted-foreground">
                    {attendanceMode === 'month' ? 'Salvando apontamentos do mês...' : 'Salvando apontamento...'}
                  </span>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => handleAttendanceDialogChange(false)}>
                  Cancelar
                </Button>
                <Button type="submit" form="attendance-form" disabled={isAttendanceSubmitting} className="min-w-44">
                  {isAttendanceSubmitting ? 'Salvando...' : attendanceMode === 'month' ? 'Salvar mês automático' : 'Salvar apontamento'}
                </Button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={builderDialog !== null} onOpenChange={(open) => {
        if (!open) setBuilderDialog(null);
      }}>
        <DialogContent className={`max-h-[90vh] overflow-hidden p-0 ${builderDialog === 'rotation' || builderDialog === 'groups' ? 'sm:max-w-6xl' : 'sm:max-w-4xl'}`}>
          {renderBuilderDialogContent()}
        </DialogContent>
      </Dialog>

      <Dialog open={activeDayRuleKey !== null} onOpenChange={(open) => {
        if (!open) setActiveDayRuleKey(null);
      }}>
        {activeDayDefinition && activeDayRule && activeDayRuleKey ? (
          <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-3xl">
            <div className="flex max-h-[88vh] min-h-0 flex-col">
              <DialogHeader className="border-b border-border/70 px-5 py-4">
                <DialogTitle>Cobertura de {activeDayDefinition.label}</DialogTitle>
                <DialogDescription>
                  {activeDayRule.mode === 'rotation' ? 'Escolha o técnico específico deste dia.' : 'Escolha um grupo para a equipe selecionada deste dia.'}
                </DialogDescription>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {activeDayRule.mode === 'selected' ? (
                  <div className="space-y-3">
                    <div className="flex justify-end">
                      <Button type="button" variant="outline" onClick={() => {
                        setActiveDayRuleKey(null);
                        setBuilderDialog('groups');
                      }}>
                        Gerenciar grupos
                      </Button>
                    </div>

                    {formData.groups.length ? (
                      formData.groups.map((group) => {
                        const participantNames = group.technician_ids
                          .map((technicianId) => ruleTechnicians.find((technician) => technician.id === technicianId)?.name)
                          .filter((name): name is string => Boolean(name));
                        const isSelected = activeDayGroupId === group.id;

                        return (
                          <button
                            key={group.id}
                            type="button"
                            onClick={() => applyGroupToDayRule(activeDayRuleKey, group.id)}
                            className={`w-full rounded-lg border px-4 py-3 text-left transition ${isSelected ? 'border-emerald-300 bg-emerald-50/70' : 'border-border bg-background hover:border-emerald-200 hover:bg-secondary/40'}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-foreground">{group.name || 'Grupo sem nome'}</p>
                                <p className="text-xs text-muted-foreground">{formatCount(participantNames.length, 'participante no escopo', 'participantes no escopo')}</p>
                              </div>
                              {isSelected ? <StatusBadge tone="success">Selecionado</StatusBadge> : null}
                            </div>
                            {participantNames.length ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {participantNames.map((name) => (
                                  <StatusBadge key={`${group.id}-${name}`} tone="neutral">{name}</StatusBadge>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-muted-foreground">Nenhum participante deste grupo está no escopo atual.</p>
                            )}
                          </button>
                        );
                      })
                    ) : (
                      <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhum grupo criado. Crie um grupo para usar em equipe selecionada.</p>
                    )}

                    {activeDayGroup ? <p className="text-xs text-muted-foreground">Grupo atual: {activeDayGroup.name}</p> : null}
                  </div>
                ) : (
                  <TechnicianChecklist
                    technicians={ruleTechnicians}
                    value={activeDayRule.technician_ids}
                    onToggle={(technicianId) => toggleDayRuleTechnician(activeDayRuleKey, technicianId)}
                    emptyLabel={`Selecione primeiro o escopo da escala para escolher quem cobre ${activeDayDefinition.dayLabel}.`}
                  />
                )}
                {activeDayRule.mode === 'rotation' ? (
                  <p className="mt-3 text-xs text-muted-foreground">Sem marcação, a cobertura usa todos os técnicos do escopo.</p>
                ) : null}
              </div>

              <DialogFooter className="border-t border-border/70 px-5 py-4">
                <Button type="button" onClick={() => setActiveDayRuleKey(null)}>Concluir</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={isCalendarDialogOpen} onOpenChange={setIsCalendarDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-375">
          <div className="flex max-h-[92vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Calendário da escala</DialogTitle>
              <DialogDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Visualize por dia quem realmente está escalado no banco.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
              <div className="mb-5 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Semana</span>
                  <select value={calendarWeek} onChange={(event) => setCalendarWeek(event.target.value)} className={inputClassName}>
                    <option value="all">Todas</option>
                    {calendarWeeks.map((_, index) => (
                      <option key={index} value={index}>
                        Semana {index + 1}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Mês</span>
                  <select value={calendarMonth} onChange={(event) => setCalendarMonth(Number(event.target.value))} className={inputClassName}>
                    {monthNames.map((month, index) => (
                      <option key={month} value={index}>
                        {month}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Ano</span>
                  <select value={calendarYear} onChange={(event) => setCalendarYear(Number(event.target.value))} className={inputClassName}>
                    {calendarYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-end">
                  <div className="w-full rounded-xl border border-border bg-secondary/50 px-4 py-2.5 text-sm">
                    <p className="font-semibold text-foreground">{formatCount(sortedTechnicians.length, 'técnico', 'técnicos')}</p>
                    <p className="text-xs text-muted-foreground">na leitura do calendário</p>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <div className="min-w-295">
                  <div className="grid grid-cols-7 border-b border-border bg-slate-100 text-center text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">
                    {weekdayLabels.map((day) => (
                      <div key={day} className="px-3 py-3">
                        {day}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7">
                    {displayedCalendarWeeks.flatMap((week, weekIndex) =>
                      week.map((day, dayIndex) => {
                        if (!day) {
                          return <div key={`empty-${weekIndex}-${dayIndex}`} className="min-h-64 border-b border-r border-border bg-muted/20 last:border-r-0" />;
                        }

                        const scheduledForDay = getCalendarDayScheduled(day);

                        return (
                          <div key={`${calendarYear}-${calendarMonth}-${day}`} className="min-h-64 border-b border-r border-border bg-card p-3 last:border-r-0">
                            <div className="mb-3 flex items-start justify-between gap-2">
                              <div>
                                <p className="text-lg font-black text-foreground">{day}</p>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{scheduledForDay.length} escalado(s)</p>
                              </div>
                              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">{scheduledForDay.length}</span>
                            </div>

                            <div className="max-h-52 overflow-y-auto pr-1">
                              {scheduledForDay.length ? (
                                <div className="space-y-1">
                                  {scheduledForDay.map(({ name, entry }) => (
                                    <div key={entry.id} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1">
                                      <p className="text-xs font-semibold text-emerald-950">{name}</p>
                                      <p className="text-[11px] text-emerald-700">{formatTimeRange(entry.start_time, entry.end_time)}</p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">Ninguém escalado.</p>
                              )}
                            </div>
                          </div>
                        );
                      }),
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mt-5">
        <DataPanel
          title="Visão geral da escala"
          description="Matriz real dos próximos 7 dias. Se um dia aparecer como sem escala, ele realmente não foi persistido para aquele técnico."
          action={
            <Button type="button" variant="outline" onClick={() => setIsCalendarDialogOpen(true)}>
              <CalendarDays className="h-4 w-4" />
              Ver calendário
            </Button>
          }
        >
          {sortedTechnicians.length ? (
            <div className="overflow-x-auto">
              <div className="min-w-225">
                <div className="grid grid-cols-[220px_repeat(7,1fr)] border-b border-border text-xs font-medium text-muted-foreground">
                  <div className="py-2 pr-3">Técnico</div>
                  {weekDates.map((date) => (
                    <div key={date} className="py-2 pr-3">
                      <p className="font-semibold text-foreground">{formatDate(date)}</p>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{getDayLabelFromKey(getDayKeyFromDateKey(date))}</p>
                    </div>
                  ))}
                </div>

                {sortedTechnicians.map((technician) => {
                  const entriesByDate = new Map<string, Schedule[]>();

                  visibleSchedule
                    .filter((item) => item.technician_id === technician.id)
                    .forEach((item) => {
                      const dateKey = normalizeDateKey(item.date);
                      entriesByDate.set(dateKey, [...(entriesByDate.get(dateKey) ?? []), item]);
                    });

                  return (
                    <div key={technician.id} className="grid grid-cols-[220px_repeat(7,1fr)] border-b border-border last:border-0">
                      <div className="py-3 pr-3 text-sm font-medium">{technician.name}</div>
                      {weekDates.map((date) => {
                        const entry = getBestScheduleEntry(entriesByDate.get(date) ?? []);

                        return (
                          <div key={date} className="py-2 pr-3">
                            <div className="min-h-20 rounded-md border border-border bg-background p-2 text-xs">
                              {entry ? (
                                <>
                                  <StatusBadge tone={getStatusTone(entry.status)}>{getStatusLabel(entry.status)}</StatusBadge>
                                  <p className="mt-2 font-medium">{entry.status === 'cancelled' ? entry.notes || 'Dia de folga' : formatTimeRange(entry.start_time, entry.end_time)}</p>
                                </>
                              ) : (
                                <>
                                  <StatusBadge tone="neutral">Sem escala</StatusBadge>
                                  <p className="mt-2 font-medium text-muted-foreground">Não persistido</p>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState icon={Users} title="Nenhum técnico ativo" description="Não há técnicos ativos reais para montar a escala." />
          )}
        </DataPanel>
      </div>

      <div className="mt-5">
        <DataPanel
          title="Registros da escala"
          description={`${formatCount(filteredSchedule.length, 'registro real na tabela schedule', 'registros reais na tabela schedule')}.`}
          action={
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por técnico, data, status ou observação" className="w-72 bg-transparent text-sm outline-none" />
            </div>
          }
        >
          {filteredSchedule.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Data</th>
                    <th className="py-3 pr-4 font-medium">Técnico</th>
                    <th className="py-3 pr-4 font-medium">Horário</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 font-medium">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSchedule.slice(0, 120).map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4">{formatDate(item.date)}</td>
                      <td className="py-3 pr-4">{item.technician_name || item.technician_id}</td>
                      <td className="py-3 pr-4">{item.status === 'cancelled' ? item.notes || 'Dia de folga' : formatTimeRange(item.start_time, item.end_time)}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge tone={getStatusTone(item.status)}>{getStatusLabel(item.status)}</StatusBadge>
                      </td>
                      <td className="py-3 text-muted-foreground">{item.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={CalendarDays} title="Sem escala persistida" description="Ainda não há uma grade salva para exibir. Monte a escala para um mês ou ano e os registros vão aparecer aqui." />
          )}
        </DataPanel>
      </div>
    </AppShell>
  );
}
