'use client';

import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, CheckCircle2, CircleHelp, Download, FileSpreadsheet, Plus, Search, UploadCloud, Users, Wrench } from 'lucide-react';
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
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatCurrency, formatDate, formatTime, monthKeyFromDate, normalizeText, parseMoney, yearFromCompetence } from '@/lib/formatters';
import type { Service, ServiceFortnight, Technician } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';

const serviceImportTemplateUrl = '/planilhas/list_os.xlsx';
const serviceFortnightOptions: ServiceFortnight[] = ['Q1', 'Q2'];
const importStageOrder = ['prepare', 'upload', 'process', 'finalize'] as const;

type ImportStageKey = (typeof importStageOrder)[number];

const importStageLabels: Record<ImportStageKey, string> = {
  prepare: 'Preparando lote',
  upload: 'Enviando OS',
  process: 'Processando importação',
  finalize: 'Atualizando a tela',
};

const importStageProgress: Record<ImportStageKey, number> = {
  prepare: 15,
  upload: 40,
  process: 75,
  finalize: 95,
};

const serviceImportRequiredColumns = [
  'Número da Ordem de Serviço',
  'Valor Total',
  'Especialidade',
  'Socorrista',
  'QRA',
  'Data de atendimento (data e hora)',
];

const serviceImportAliases = {
  order_code: ['numero da ordem de servico', 'codigo', 'cod serv', 'cod', 'os'],
  value: ['valor total', 'valor serv', 'premio', 'valor'],
  service_type: ['especialidade', 'tipo serv', 'tipo', 'servico'],
  technician_name: ['socorrista', 'tecnico', 'colaborador', 'funcionario'],
  qra: ['qra', 'qra tec'],
  date_performed: ['data de atendimento', 'data serv', 'data'],
  vehicle_code: ['sigla da viatura', 'viatura'],
};

type ServiceImportStatus = 'valid' | 'invalid' | 'imported';

interface ParsedServiceImportRow {
  rowNumber: number;
  status: ServiceImportStatus;
  errors: string[];
  values: {
    order_code: string;
    technician_id: string;
    technician_name: string;
    qra: string;
    service_type: string;
    value: number;
    date_performed: string;
    time_performed: string;
    competence_month: string;
    description: string;
  };
}

const initialFormData = {
  order_code: '',
  technician_id: '',
  service_type: '',
  value: 0,
  date_performed: new Date().toISOString().split('T')[0],
  time_performed: new Date().toTimeString().slice(0, 5),
  competence_month: new Date().toISOString().slice(0, 7),
  description: '',
};

type ServiceFormData = typeof initialFormData;

function createInitialFormData(): ServiceFormData {
  return { ...initialFormData };
}

function getServiceCompetenceMonth(service: Pick<Service, 'competence_month' | 'date_performed'>) {
  const savedCompetence = String(service.competence_month ?? '').trim();
  if (/^\d{4}-\d{2}$/.test(savedCompetence)) return savedCompetence;

  const dateMonth = monthKeyFromDate(service.date_performed);
  if (dateMonth) return dateMonth;

  return savedCompetence || yearFromCompetence(service.date_performed);
}

function formatCompetenceLabel(value: string) {
  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return value || 'Sem competência';

  return `${match[2]}/${match[1]}`;
}

function getServicePeriodKey(service: Pick<Service, 'competence_month' | 'date_performed' | 'fortnight_period'>) {
  const competenceMonth = getServiceCompetenceMonth(service);
  return service.fortnight_period ? `${competenceMonth}-${service.fortnight_period}` : competenceMonth;
}

function HelpTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:text-foreground"
          aria-label="Ajuda"
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-64 leading-5">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function createImportProgress(stage: ImportStageKey, detail: string) {
  return {
    stage,
    value: importStageProgress[stage],
    detail,
  };
}

function normalizeImportHeader(value: string) {
  return normalizeText(value).replace(/[_\s]+/g, ' ');
}

function normalizeImportQra(value: unknown) {
  return String(value ?? '').replace(/\D/g, '');
}

function stringifyImportCell(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function pickImportValue(row: Record<string, unknown>, key: keyof typeof serviceImportAliases) {
  const headerMap = new Map(Object.keys(row).map((header) => [normalizeImportHeader(header), row[header]]));

  for (const alias of serviceImportAliases[key]) {
    const value = headerMap.get(normalizeImportHeader(alias));
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return '';
}

function formatDateParts(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return '';
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatTimeParts(hours: number, minutes: number) {
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return '';
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseImportDateTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      date: formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate()),
      time: formatTimeParts(value.getHours(), value.getMinutes()),
    };
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return {
        date: formatDateParts(parsed.y, parsed.m, parsed.d),
        time: formatTimeParts(parsed.H, parsed.M),
      };
    }
  }

  const raw = stringifyImportCell(value);
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const timeMatch = raw.match(/T(\d{1,2}):(\d{2})|(\d{1,2}):(\d{2})/);

    return {
      date: formatDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])),
      time: timeMatch ? formatTimeParts(Number(timeMatch[1] ?? timeMatch[3]), Number(timeMatch[2] ?? timeMatch[4])) : '',
    };
  }

  const dateMatch = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!dateMatch) return { date: '', time: '' };

  const first = Number(dateMatch[1]);
  const second = Number(dateMatch[2]);
  const year = Number(dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]);
  const month = first > 12 ? second : first;
  const day = first > 12 ? first : second;
  const timeMatch = raw.match(/(?:\s|T)(\d{1,2}):(\d{2})/);

  return {
    date: formatDateParts(year, month, day),
    time: timeMatch ? formatTimeParts(Number(timeMatch[1]), Number(timeMatch[2])) : '',
  };
}

function parseServiceImportRows(rows: Record<string, unknown>[], technicians: Technician[]): ParsedServiceImportRow[] {
  const techniciansByQra = new Map(
    technicians
      .map((technician) => [normalizeImportQra(technician.qra), technician] as const)
      .filter(([qra]) => Boolean(qra)),
  );
  const techniciansByName = new Map(technicians.map((technician) => [normalizeText(technician.name), technician] as const));

  return rows.map((row, index) => {
    const orderCode = stringifyImportCell(pickImportValue(row, 'order_code'));
    const serviceType = stringifyImportCell(pickImportValue(row, 'service_type'));
    const technicianName = stringifyImportCell(pickImportValue(row, 'technician_name'));
    const qra = stringifyImportCell(pickImportValue(row, 'qra'));
    const value = parseMoney(pickImportValue(row, 'value'));
    const attendedAt = parseImportDateTime(pickImportValue(row, 'date_performed'));
    const datePerformed = attendedAt.date;
    const timePerformed = attendedAt.time;
    const vehicleCode = stringifyImportCell(pickImportValue(row, 'vehicle_code'));
    const technician =
      techniciansByQra.get(normalizeImportQra(qra)) ||
      (technicianName ? techniciansByName.get(normalizeText(technicianName)) : undefined);
    const errors: string[] = [];

    if (!orderCode) errors.push('Codigo da OS ausente');
    if (!serviceType) errors.push('Especialidade ausente');
    if (!value || value <= 0) errors.push('Valor invalido');
    if (!datePerformed) errors.push('Data de atendimento invalida');
    if (!timePerformed) errors.push('Hora de atendimento invalida');
    if (!technician) errors.push(qra ? `QRA ${qra} nao cadastrado` : 'Tecnico nao localizado');

    return {
      rowNumber: index + 2,
      status: errors.length ? 'invalid' : 'valid',
      errors,
      values: {
        order_code: orderCode,
        technician_id: technician?.id ?? '',
        technician_name: technician?.name ?? technicianName,
        qra,
        service_type: serviceType,
        value,
        date_performed: datePerformed,
        time_performed: timePerformed,
        competence_month: datePerformed ? datePerformed.slice(0, 7) : '',
        description: vehicleCode ? `Viatura: ${vehicleCode}` : '',
      },
    };
  });
}

export default function AdminServicesPage() {
  const { user, loading } = useAppSession();
  const [services, setServices] = useState<Service[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [query, setQuery] = useState('');
  const [technicianFilter, setTechnicianFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [competenceFilter, setCompetenceFilter] = useState('all');
  const [fortnightFilter, setFortnightFilter] = useState<'all' | ServiceFortnight>('all');
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [formData, setFormData] = useState<ServiceFormData>(createInitialFormData);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importRows, setImportRows] = useState<ParsedServiceImportRow[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importSheetName, setImportSheetName] = useState('');
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importFortnight, setImportFortnight] = useState<ServiceFortnight | ''>('');
  const [importCompetenceMonth, setImportCompetenceMonth] = useState('');
  const [importProgress, setImportProgress] = useState<{ stage: ImportStageKey; value: number; detail: string } | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      try {
        const [servicesResult, techniciansResult] = await Promise.allSettled([fetch('/api/services'), fetch('/api/technicians')]);
        const errors: string[] = [];

        if (servicesResult.status === 'fulfilled' && servicesResult.value.ok) {
          const data = await servicesResult.value.json();
          if (mounted) {
            setServices(Array.isArray(data.services) ? data.services : []);
          }
        } else {
          errors.push('ordens de servico');
          if (mounted) {
            setServices([]);
          }
        }

        if (techniciansResult.status === 'fulfilled' && techniciansResult.value.ok) {
          const data = await techniciansResult.value.json();
          if (mounted) {
            setTechnicians(Array.isArray(data.technicians) ? data.technicians : []);
          }
        } else {
          errors.push('colaboradores');
          if (mounted) {
            setTechnicians([]);
          }
        }

        if (mounted) {
          setDataError(errors.length ? `Nao foi possivel carregar dados reais de ${errors.join(' e ')}.` : '');
          setIsDataLoading(false);
        }
      } catch (error) {
        console.error('[admin/services] load data error:', error);
        if (mounted) {
          setDataError('Nao foi possivel carregar os dados reais.');
          setTechnicians([]);
          setServices([]);
          setIsDataLoading(false);
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [user]);

  const visibleServices = services;
  const visibleTechnicians = technicians;
  const inputClassName = 'min-h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm outline-none transition focus:ring-2 focus:ring-ring';

  const sortedTechnicians = useMemo(() => {
    return [...visibleTechnicians].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  }, [visibleTechnicians]);

  const servicesWithDetails = useMemo(() => {
    const technicianNameMap = new Map(sortedTechnicians.map((technician) => [technician.id, technician.name]));

    return visibleServices.map((service) => ({
      ...service,
      technician_name: service.technician_name || technicianNameMap.get(service.technician_id) || service.technician_id,
      time_performed: service.time_performed || '',
      competence_month: getServiceCompetenceMonth(service),
    }));
  }, [sortedTechnicians, visibleServices]);

  const availableTypes = useMemo(() => {
    return Array.from(new Set(servicesWithDetails.map((service) => service.service_type).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right, 'pt-BR'),
    );
  }, [servicesWithDetails]);

  const availableCompetences = useMemo(() => {
    return Array.from(new Set(servicesWithDetails.map((service) => getServiceCompetenceMonth(service)))).sort((left, right) =>
      right.localeCompare(left, 'pt-BR'),
    );
  }, [servicesWithDetails]);

  const availableFortnights = useMemo(() => {
    return serviceFortnightOptions.filter((period) => servicesWithDetails.some((service) => service.fortnight_period === period));
  }, [servicesWithDetails]);

  const filteredServices = useMemo(() => {
    return servicesWithDetails.filter((service) => {
      const competence = getServiceCompetenceMonth(service);
      if (technicianFilter !== 'all' && service.technician_id !== technicianFilter) return false;
      if (typeFilter !== 'all' && service.service_type !== typeFilter) return false;
      if (competenceFilter !== 'all' && competence !== competenceFilter) return false;
      if (fortnightFilter !== 'all' && service.fortnight_period !== fortnightFilter) return false;

      const haystack = normalizeText(
        `${service.order_code} ${service.service_type} ${competence} ${service.fortnight_period || ''} ${service.time_performed || ''} ${service.technician_name} ${service.description || ''}`,
      );
      return !query || haystack.includes(normalizeText(query));
    });
  }, [competenceFilter, fortnightFilter, query, servicesWithDetails, technicianFilter, typeFilter]);

  const importSummary = useMemo(() => {
    return {
      valid: importRows.filter((row) => row.status === 'valid').length,
      invalid: importRows.filter((row) => row.status === 'invalid').length,
      total: importRows.length,
    };
  }, [importRows]);

  const validImportRows = useMemo(() => importRows.filter((row) => row.status === 'valid'), [importRows]);

  function resetForm() {
    setFormData(createInitialFormData());
    setFormError('');
  }

  function handleFormDialogChange(open: boolean) {
    setIsFormDialogOpen(open);

    if (!open) {
      resetForm();
    }
  }

  function resetImport() {
    setImportRows([]);
    setImportFileName('');
    setImportSheetName('');
    setImportError('');
    setImportResult('');
    setImportFortnight('');
    setImportCompetenceMonth('');
    setImportProgress(null);
  }

  function handleImportDialogChange(open: boolean) {
    if (isImporting && !open) {
      return;
    }

    setIsImportDialogOpen(open);

    if (!open) {
      resetImport();
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError('');
    setImportResult('');
    setImportFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      let bestSheetName = workbook.SheetNames[0] ?? '';
      let bestRows: Record<string, unknown>[] = [];

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const parsedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '', raw: true });

        if (parsedRows.length > bestRows.length) {
          bestRows = parsedRows;
          bestSheetName = sheetName;
        }
      }

      if (!bestRows.length) {
        setImportRows([]);
        setImportSheetName(bestSheetName);
        setImportError('A planilha nao possui linhas para importar.');
        return;
      }

      setImportSheetName(bestSheetName);
      setImportRows(parseServiceImportRows(bestRows, sortedTechnicians));
    } catch (error) {
      console.error('[admin/services] import read error:', error);
      setImportRows([]);
      setImportSheetName('');
      setImportError('Nao foi possivel ler a planilha. Use XLSX, XLS ou CSV no modelo de OS.');
    } finally {
      event.target.value = '';
    }
  }

  async function handleImportSubmit() {
    if (!validImportRows.length) return;
    if (!importFortnight) {
      setImportError('Selecione Q1 ou Q2 antes de importar o lote.');
      return;
    }
    if (!importCompetenceMonth) {
      setImportError('Defina a competência do lote antes de importar.');
      return;
    }

    setIsImporting(true);
    setImportError('');
    setImportResult('');
    setImportProgress(createImportProgress('prepare', `Conferindo ${validImportRows.length} OS antes do envio.`));

    try {
      setImportProgress(createImportProgress('upload', `Enviando ${validImportRows.length} OS para processamento. Aguarde.`));
      const response = await fetch('/api/services/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          services: validImportRows.map((row) => row.values),
          fortnight_period: importFortnight,
          competence_month: importCompetenceMonth,
        }),
      });
      setImportProgress(createImportProgress('process', 'Recebendo o retorno da importação e validando o resultado.'));
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setImportError(data?.error || 'Nao foi possivel importar as OS.');
        setIsImporting(false);
        return;
      }

      const createdServices = Array.isArray(data?.services) ? (data.services as Service[]) : [];
      const rejectedCodes = new Set((Array.isArray(data?.rejected) ? data.rejected : []).map((item: { order_code?: string }) => item.order_code));
      const createdCodes = new Set(createdServices.map((service) => service.order_code));

      setImportProgress(createImportProgress('finalize', 'Atualizando a lista e concluindo o lote importado.'));

      setServices((current) => [...createdServices, ...current]);
      setImportRows((current) =>
        current.map((row) => {
          if (createdCodes.has(row.values.order_code)) {
            return { ...row, status: 'imported', errors: ['OS importada nesta carga'] };
          }

          if (rejectedCodes.has(row.values.order_code)) {
            return { ...row, status: 'invalid', errors: ['Linha rejeitada pela API'] };
          }

          return row;
        }),
      );
      setImportResult(
        `Importadas ${createdServices.length} OS. ${Array.isArray(data?.rejected) ? data.rejected.length : 0} rejeitadas.`,
      );
    } catch (error) {
      console.error('[admin/services] import submit error:', error);
      setImportError('Nao foi possivel importar as OS.');
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');
    setIsSubmitting(true);

    const response = await fetch('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setFormError(data?.error || 'Nao foi possivel salvar a OS.');
      setIsSubmitting(false);
      return;
    }

    const created = (await response.json()) as Service;
    const selectedTechnician = sortedTechnicians.find((technician) => technician.id === formData.technician_id);

    setServices((current) => [
      {
        ...created,
        technician_name: created.technician_name || selectedTechnician?.name || formData.technician_id,
      },
      ...current,
    ]);
    handleFormDialogChange(false);
    setIsSubmitting(false);
  }

  if (loading || !user || isDataLoading) {
    return <LoadingState />;
  }

  const totalValue = filteredServices.reduce((total, service) => total + Number(service.value), 0);
  const uniquePeriods = new Set(filteredServices.map((service) => getServicePeriodKey(service))).size;
  const collaboratorCount = new Set(filteredServices.map((service) => service.technician_id)).size;
  const collaboratorSummaries = Array.from(
    filteredServices.reduce((summaryMap, service) => {
      const current = summaryMap.get(service.technician_id);

      if (current) {
        current.orders += 1;
        current.totalValue += Number(service.value);
        return summaryMap;
      }

      summaryMap.set(service.technician_id, {
        technicianId: service.technician_id,
        technicianName: service.technician_name || service.technician_id,
        orders: 1,
        totalValue: Number(service.value),
      });

      return summaryMap;
    }, new Map<string, { technicianId: string; technicianName: string; orders: number; totalValue: number }>()).values(),
  ).sort((left, right) => {
    if (right.totalValue !== left.totalValue) {
      return right.totalValue - left.totalValue;
    }

    if (right.orders !== left.orders) {
      return right.orders - left.orders;
    }

    return left.technicianName.localeCompare(right.technicianName, 'pt-BR');
  });

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Produção"
        title="Ordens de serviço"
        description="Acompanhe todas as OS dos colaboradores, filtre por colaborador, tipo, competência e quinzena e faça ajustes pontuais no cadastro."
      >
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setIsImportDialogOpen(true)}>
            <UploadCloud className="h-4 w-4" />
            Importar
          </Button>
          <Button type="button" onClick={() => setIsFormDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Cadastrar OS
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard title="Ordens" value={filteredServices.length} hint="No filtro atual" icon={Wrench} />
        <MetricCard title="Colaboradores" value={collaboratorCount} hint="Escopo atual da visão" icon={Users} />
        <MetricCard title="Valor bruto" value={formatCurrency(totalValue)} hint="Soma das OS" icon={Wrench} tone="success" />
        <MetricCard title="Períodos" value={uniquePeriods} hint="Competência + quinzena" icon={Wrench} tone="warning" />
      </div>

      <div className="mt-5">
        <DataPanel
          title="Resumo por colaborador"
          description="Totais do filtro atual separados por colaborador, com quantidade de OS e valor bruto acumulado."
        >
          {collaboratorSummaries.length ? (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
              {collaboratorSummaries.map((summary) => (
                <section key={summary.technicianId} className="rounded-md border border-border bg-background p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold uppercase text-foreground">{summary.technicianName}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{summary.orders} OS no filtro atual</p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700">
                      <Users className="h-5 w-5" />
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md bg-secondary/60 p-3">
                      <p className="text-[11px] font-medium uppercase text-muted-foreground">Ordens</p>
                      <p className="mt-1 text-lg font-semibold text-foreground">{summary.orders}</p>
                    </div>
                    <div className="rounded-md bg-emerald-50 p-3">
                      <p className="text-[11px] font-medium uppercase text-emerald-700/80">Valor bruto</p>
                      <p className="mt-1 text-lg font-semibold text-emerald-700">{formatCurrency(summary.totalValue)}</p>
                    </div>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-8 text-center text-sm text-muted-foreground">
              Nenhum colaborador encontrado com os filtros atuais.
            </div>
          )}
        </DataPanel>
      </div>

      {dataError ? <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      <Dialog open={isImportDialogOpen} onOpenChange={handleImportDialogChange}>
        <DialogContent
          className="h-[88vh] max-h-[88vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden p-0 sm:w-[calc(100vw-3rem)] sm:max-w-6xl"
          showCloseButton={!isImporting}
          onEscapeKeyDown={(event) => {
            if (isImporting) {
              event.preventDefault();
            }
          }}
          onPointerDownOutside={(event) => {
            if (isImporting) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            if (isImporting) {
              event.preventDefault();
            }
          }}
        >
          <div className="flex h-full min-h-0 flex-col">
            {isImporting && importProgress ? (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/85 backdrop-blur-sm">
                <div className="w-[min(92vw,32rem)] rounded-2xl border border-border bg-background p-6 shadow-2xl">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Spinner className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-foreground">Importando OS</h3>
                      <p className="text-sm text-muted-foreground">Aguarde até o processamento terminar. Não feche esta janela.</p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-foreground">{importStageLabels[importProgress.stage]}</span>
                      <span className="text-muted-foreground">{importProgress.value}%</span>
                    </div>
                    <Progress value={importProgress.value} />
                    <p className="text-sm text-muted-foreground">{importProgress.detail}</p>
                  </div>

                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {importStageOrder.map((stage, index) => {
                      const currentIndex = importStageOrder.indexOf(importProgress.stage);
                      const isDone = index < currentIndex;
                      const isCurrent = stage === importProgress.stage;

                      return (
                        <div
                          key={stage}
                          className={`rounded-xl border px-3 py-2 text-sm ${
                            isCurrent
                              ? 'border-primary bg-primary/5 text-foreground'
                              : isDone
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-border bg-secondary/30 text-muted-foreground'
                          }`}
                        >
                          {isDone ? 'Concluído' : isCurrent ? 'Em andamento' : 'Aguardando'}: {importStageLabels[stage]}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Importar OS</DialogTitle>
              <DialogDescription className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Use o modelo de OS para carregar várias ordens de serviço e vinculá-las automaticamente pelo QRA do colaborador.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-7">
              {importError ? <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{importError}</div> : null}
              {importResult ? (
                <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{importResult}</div>
              ) : null}

              <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
                <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                  <div className="mb-5 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Modelo</p>
                    <h3 className="text-base font-semibold text-foreground">Planilha list_os.xlsx</h3>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" asChild>
                      <a href={serviceImportTemplateUrl} download>
                        <Download className="h-4 w-4" />
                        Baixar modelo
                      </a>
                    </Button>

                    <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90">
                      <UploadCloud className="h-4 w-4" />
                      Selecionar arquivo
                      <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={handleImportFile} />
                    </label>
                  </div>

                  <div className="mt-5 rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
                    {importFileName ? `Arquivo: ${importFileName}` : 'Nenhum arquivo selecionado.'}
                    {importSheetName ? <span className="ml-2 text-foreground">Aba: {importSheetName}</span> : null}
                  </div>

                  <div className="mt-5 rounded-xl border border-border bg-background p-4">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Quinzena</p>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-foreground">Defina o fechamento do lote</h4>
                        <HelpTip text="A Q1 fecha no dia 13 e a Q2 fecha no dia 28. A quinzena e a competência definidas aqui serão aplicadas a todas as OS importadas neste arquivo." />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
                      <div>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Período</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {serviceFortnightOptions.map((period) => (
                            <Button
                              key={period}
                              type="button"
                              variant={importFortnight === period ? 'default' : 'outline'}
                              onClick={() => setImportFortnight(period)}
                              className="justify-start"
                            >
                              {period}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <label className="text-sm">
                        <span className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Competência
                          <HelpTip text="Use o mês real do lote. A data e a hora da planilha servem apenas como referência." />
                        </span>
                        <input
                          type="month"
                          value={importCompetenceMonth}
                          onChange={(event) => setImportCompetenceMonth(event.target.value)}
                          className={inputClassName}
                        />
                      </label>
                    </div>

                    <p className="mt-3 text-xs text-muted-foreground">
                      {importFortnight || importCompetenceMonth
                        ? `Lote configurado${importFortnight ? ` como ${importFortnight}` : ''}${importCompetenceMonth ? ` em ${importCompetenceMonth}` : ''}.`
                        : 'Selecione a quinzena e a competência antes de confirmar a importação.'}
                    </p>
                  </div>
                </section>

                <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                  <div className="mb-5 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Campos esperados</p>
                    <h3 className="text-base font-semibold text-foreground">Cabecalhos do arquivo</h3>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {serviceImportRequiredColumns.map((column) => (
                      <span key={column} className="rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-foreground">
                        {column}
                      </span>
                    ))}
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <MetricCard title="Válidas" value={importSummary.valid} hint="Prontas para importar" icon={CheckCircle2} tone="success" />
                    <MetricCard title="Rejeitadas" value={importSummary.invalid} hint="Corrigir" icon={AlertTriangle} tone={importSummary.invalid ? 'danger' : 'default'} />
                    <MetricCard title="Lidas" value={importSummary.total} hint="Total no arquivo" icon={FileSpreadsheet} />
                  </div>
                </section>
              </div>

              <div className="mt-5 rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Prévia da importação</h3>
                    <p className="text-sm text-muted-foreground">
                      {importRows.length
                        ? `${importRows.length} registro(s) carregados para conferência.`
                        : 'Carregue uma planilha para validar as linhas.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {importFortnight ? <StatusBadge tone="info">{importFortnight}</StatusBadge> : null}
                    {importCompetenceMonth ? <StatusBadge tone="info">{importCompetenceMonth}</StatusBadge> : null}
                    {validImportRows.length ? <StatusBadge tone="success">{validImportRows.length} pronta(s)</StatusBadge> : null}
                  </div>
                </div>

                {importRows.length ? (
                  <div className="max-h-96 overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                          <th className="py-3 pr-4 font-medium">Item</th>
                          <th className="py-3 pr-4 font-medium">Status</th>
                          <th className="py-3 pr-4 font-medium">Código</th>
                          <th className="py-3 pr-4 font-medium">Colaborador</th>
                          <th className="py-3 pr-4 font-medium">QRA</th>
                          <th className="py-3 pr-4 font-medium">Tipo</th>
                          <th className="py-3 pr-4 font-medium">Valor</th>
                          <th className="py-3 pr-4 font-medium">Data</th>
                          <th className="py-3 pr-4 font-medium">Hora</th>
                          <th className="py-3 font-medium">Avisos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.map((row, index) => (
                          <tr key={`${row.rowNumber}-${row.values.order_code}`} className="border-b border-border last:border-0">
                            <td className="py-3 pr-4 font-medium text-foreground">{index + 1}</td>
                            <td className="py-3 pr-4">
                              <StatusBadge
                                tone={row.status === 'valid' || row.status === 'imported' ? 'success' : 'danger'}
                              >
                                {row.status === 'valid' ? 'Válida' : row.status === 'imported' ? 'Importada' : 'Rejeitada'}
                              </StatusBadge>
                            </td>
                            <td className="py-3 pr-4 font-mono text-xs">{row.values.order_code || '-'}</td>
                            <td className="py-3 pr-4">{row.values.technician_name || '-'}</td>
                            <td className="py-3 pr-4">{row.values.qra || '-'}</td>
                            <td className="py-3 pr-4">{row.values.service_type || '-'}</td>
                            <td className="py-3 pr-4">{formatCurrency(row.values.value)}</td>
                            <td className="py-3 pr-4 text-muted-foreground">{row.values.date_performed ? formatDate(row.values.date_performed) : '-'}</td>
                            <td className="py-3 pr-4 text-muted-foreground">{row.values.time_performed ? formatTime(row.values.time_performed) : '-'}</td>
                            <td className="py-3 text-muted-foreground">{row.errors.length ? row.errors.join('; ') : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-8 text-center text-sm text-muted-foreground">
                    Nenhuma planilha carregada ainda.
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="border-t border-border/70 bg-background/95 px-6 py-4 sm:px-7">
              <Button type="button" variant="outline" onClick={() => handleImportDialogChange(false)} disabled={isImporting}>
                {isImporting ? 'Aguarde...' : 'Fechar'}
              </Button>
              <Button type="button" onClick={handleImportSubmit} disabled={!validImportRows.length || !importFortnight || !importCompetenceMonth || isImporting} className="min-w-40">
                {isImporting ? 'Importando...' : `Importar ${validImportRows.length} OS`}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isFormDialogOpen} onOpenChange={handleFormDialogChange}>
        <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-4xl">
          <div className="flex max-h-[88vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Cadastrar OS</DialogTitle>
              <DialogDescription className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Use importação para cargas grandes e este formulário para ajustes pontuais.
              </DialogDescription>
            </DialogHeader>

            <form id="service-form" onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-7">
              {formError ? <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{formError}</div> : null}

              <div className="grid gap-5 lg:grid-cols-[1fr_0.95fr]">
                <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                  <div className="mb-5 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Identificação</p>
                    <h3 className="text-base font-semibold text-foreground">Dados principais da OS</h3>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm md:col-span-2">
                      <span className="mb-1.5 block font-medium">Código da OS</span>
                      <input
                        value={formData.order_code}
                        onChange={(event) => setFormData((current) => ({ ...current, order_code: event.target.value }))}
                        className={inputClassName}
                        required
                      />
                    </label>

                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Técnico</span>
                      <select
                        value={formData.technician_id}
                        onChange={(event) => setFormData((current) => ({ ...current, technician_id: event.target.value }))}
                        className={inputClassName}
                        required
                      >
                        <option value="">Selecione</option>
                        {sortedTechnicians.map((technician) => (
                          <option key={technician.id} value={technician.id}>
                            {technician.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Tipo</span>
                      <input
                        value={formData.service_type}
                        onChange={(event) => setFormData((current) => ({ ...current, service_type: event.target.value }))}
                        className={inputClassName}
                        required
                      />
                    </label>

                    <label className="text-sm md:col-span-2">
                      <span className="mb-1.5 block font-medium">Valor</span>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.value}
                        onChange={(event) => setFormData((current) => ({ ...current, value: Number(event.target.value) }))}
                        className={inputClassName}
                        required
                      />
                    </label>
                  </div>
                </section>

                <section className="rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-6">
                  <div className="mb-5 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Execução</p>
                    <h3 className="text-base font-semibold text-foreground">Data, competência e observações</h3>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Data</span>
                      <input
                        type="date"
                        value={formData.date_performed}
                        onChange={(event) => setFormData((current) => ({ ...current, date_performed: event.target.value }))}
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

                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Hora</span>
                      <input
                        type="time"
                        value={formData.time_performed}
                        onChange={(event) => setFormData((current) => ({ ...current, time_performed: event.target.value }))}
                        className={inputClassName}
                        required
                      />
                    </label>

                    <label className="text-sm md:col-span-2">
                      <span className="mb-1.5 block font-medium">Descrição</span>
                      <textarea
                        value={formData.description}
                        onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                        className="min-h-28 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
                      />
                    </label>
                  </div>
                </section>
              </div>
            </form>

            <DialogFooter className="border-t border-border/70 bg-background/95 px-6 py-4 sm:px-7">
              <Button type="button" variant="outline" onClick={() => handleFormDialogChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" form="service-form" disabled={isSubmitting} className="min-w-36">
                {isSubmitting ? 'Salvando...' : 'Salvar OS'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mt-5">
        <DataPanel
          title="Filtros administrativos"
          description="Visão consolidada de todos os colaboradores com recortes por colaborador, tipo, competência, quinzena e busca textual."
        >
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_repeat(4,minmax(0,0.75fr))_auto] xl:items-end">
            <div className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-3.5">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar OS, colaborador, tipo"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Colaborador</span>
              <select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)} className={inputClassName}>
                <option value="all">Todos</option>
                {sortedTechnicians.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Tipo</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={inputClassName}>
                <option value="all">Todos</option>
                {availableTypes.map((serviceType) => (
                  <option key={serviceType} value={serviceType}>
                    {serviceType}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Competência (mês/ano)</span>
              <select value={competenceFilter} onChange={(event) => setCompetenceFilter(event.target.value)} className={inputClassName}>
                <option value="all">Todas</option>
                {availableCompetences.map((competence) => (
                  <option key={competence} value={competence}>
                    {formatCompetenceLabel(competence)}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Quinzena</span>
              <select value={fortnightFilter} onChange={(event) => setFortnightFilter(event.target.value as 'all' | ServiceFortnight)} className={inputClassName}>
                <option value="all">Todas</option>
                {availableFortnights.map((fortnight) => (
                  <option key={fortnight} value={fortnight}>
                    {fortnight}
                  </option>
                ))}
              </select>
            </label>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery('');
                setTechnicianFilter('all');
                setTypeFilter('all');
                setCompetenceFilter('all');
                setFortnightFilter('all');
              }}
            >
              Limpar filtros
            </Button>
          </div>
        </DataPanel>
      </div>

      <div className="mt-5">
        <DataPanel
          title="Histórico de OS"
          description={`${filteredServices.length} registro(s) encontrados em todos os colaboradores.`}
        >
          {filteredServices.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Código</th>
                    <th className="py-3 pr-4 font-medium">Colaborador</th>
                    <th className="py-3 pr-4 font-medium">Tipo</th>
                    <th className="py-3 pr-4 font-medium">Valor</th>
                    <th className="py-3 pr-4 font-medium">Competência</th>
                    <th className="py-3 pr-4 font-medium">Quinzena</th>
                    <th className="py-3 pr-4 font-medium">Data</th>
                    <th className="py-3 font-medium">Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredServices.map((service) => (
                    <tr key={service.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4 font-mono text-xs">{service.order_code}</td>
                      <td className="py-3 pr-4 font-bold text-foreground">{service.technician_name || service.technician_id}</td>
                      <td className="py-3 pr-4">{service.service_type}</td>
                      <td className="py-3 pr-4">{formatCurrency(service.value)}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge tone="info">{formatCompetenceLabel(getServiceCompetenceMonth(service))}</StatusBadge>
                      </td>
                      <td className="py-3 pr-4">{service.fortnight_period ? <StatusBadge tone="neutral">{service.fortnight_period}</StatusBadge> : '-'}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{formatDate(service.date_performed)}</td>
                      <td className="py-3 text-muted-foreground">{service.time_performed ? formatTime(service.time_performed) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-8 text-center text-sm text-muted-foreground">
              Nenhuma OS encontrada com os filtros atuais.
            </div>
          )}
        </DataPanel>
      </div>
    </AppShell>
  );
}
