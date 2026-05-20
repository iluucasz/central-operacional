'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, UploadCloud } from 'lucide-react';
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { normalizeText, parseMoney } from '@/lib/formatters';
import { useAppSession } from '@/hooks/use-app-session';

type ImportKind = 'services' | 'hours' | 'payroll' | 'schedule';

interface ParsedRow {
  rowNumber: number;
  status: 'valid' | 'invalid' | 'duplicate';
  errors: string[];
  values: Record<string, string | number>;
}

const importProfiles: Record<ImportKind, { title: string; description: string; required: string[] }> = {
  services: {
    title: 'Ordens de serviço',
    description: 'QUINZENAS ou planilha bruta da seguradora.',
    required: ['codigo', 'tecnico', 'tipo', 'valor', 'competencia'],
  },
  hours: {
    title: 'Horas trabalhadas',
    description: 'HORAS GERAIS PARA GOOGLE.',
    required: ['data', 'funcionario', 'hora_inicio', 'hora_final', 'horas_trabalhadas'],
  },
  payroll: {
    title: 'Modelo de pagamento',
    description: 'MODELO TESTE com salário, descontos e comissão.',
    required: ['tecnico', 'competencia', 'receber'],
  },
  schedule: {
    title: 'Escala',
    description: 'Agenda planejada, folgas e disponibilidade.',
    required: ['data', 'tecnico', 'status'],
  },
};

const aliases: Record<string, string[]> = {
  codigo: ['cod serv', 'cod', 'codigo', 'numero da ordem de servico', 'numero os', 'os'],
  valor: ['valor', 'valor total', 'valor serv', 'premio', 'prêmio'],
  tipo: ['tipo serv', 'tipo', 'especialidade', 'tipo de servico', 'servico'],
  tecnico: ['tecnico', 'socorrista', 'funcionario', 'colaborador'],
  qra: ['qra', 'qra tec'],
  data: ['data', 'data serv', 'data de atendimento'],
  competencia: ['competencia', 'competência', 'periodo', 'mes'],
  funcionario: ['funcionario', 'funcionário', 'tecnico', 'colaborador'],
  hora_inicio: ['hora inicio', 'hora início', 'inicio', 'entrada'],
  hora_final: ['hora final', 'fim', 'saida', 'saída'],
  horas_trabalhadas: ['horas trabalhadas', 'horas', 'total horas'],
  receber: ['receber', 'total', 'liquido', 'líquido', 'valor final'],
  status: ['status', 'escala', 'situacao', 'situação'],
};

const requiredFieldLabels: Record<string, string> = {
  codigo: 'código',
  tecnico: 'técnico',
  competencia: 'competência',
  hora_inicio: 'hora de início',
  hora_final: 'hora final',
  horas_trabalhadas: 'horas trabalhadas',
  funcionario: 'funcionário',
  receber: 'valor a receber',
  status: 'status',
  tipo: 'tipo',
  valor: 'valor',
  data: 'data',
};

function normalizeHeader(value: string) {
  return normalizeText(value).replace(/[_\s]+/g, ' ');
}

function pickValue(row: Record<string, unknown>, key: string) {
  const headerMap = new Map(Object.keys(row).map((header) => [normalizeHeader(header), row[header]]));
  const possibleHeaders = aliases[key] ?? [key];

  for (const header of possibleHeaders) {
    const value = headerMap.get(normalizeHeader(header));
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }

  return '';
}

function parseRows(rows: Record<string, unknown>[], kind: ImportKind): ParsedRow[] {
  const seen = new Set<string>();
  const required = importProfiles[kind].required;

  return rows.map((row, index) => {
    const values = Object.fromEntries(
      Object.keys(aliases).map((key) => {
        const value = pickValue(row, key);
        return [key, key === 'valor' || key === 'receber' ? parseMoney(value) : String(value ?? '').trim()];
      }),
    );
    const errors = required.filter((key) => !values[key]);
    const duplicateKey = String(values.codigo || `${values.data}-${values.tecnico}-${index}`).toLowerCase();
    const duplicate = Boolean(values.codigo) && seen.has(duplicateKey);

    if (values.codigo) {
      seen.add(duplicateKey);
    }

    return {
      rowNumber: index + 2,
      status: errors.length ? 'invalid' : duplicate ? 'duplicate' : 'valid',
      errors,
      values,
    };
  });
}

export default function ImportPage() {
  const { user, loading } = useAppSession();
  const [kind, setKind] = useState<ImportKind>('services');
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [error, setError] = useState('');
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  const summary = useMemo(() => {
    return {
      valid: rows.filter((row) => row.status === 'valid').length,
      invalid: rows.filter((row) => row.status === 'invalid').length,
      duplicate: rows.filter((row) => row.status === 'duplicate').length,
    };
  }, [rows]);

  const selectedProfile = importProfiles[kind];

  function handleSelectKind(profileKey: ImportKind) {
    setKind(profileKey);
    setRows([]);
    setFileName('');
    setSheetName('');
    setError('');
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError('');
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, raw: false });
      let bestSheet = workbook.SheetNames[0];
      let bestRows: Record<string, unknown>[] = [];

      for (const name of workbook.SheetNames) {
        const worksheet = workbook.Sheets[name];
        const candidate = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '', raw: false });
        if (candidate.length > bestRows.length) {
          bestRows = candidate;
          bestSheet = name;
        }
      }

      setSheetName(bestSheet);
      setRows(parseRows(bestRows, kind));
      setIsUploadDialogOpen(false);
    } catch (readError) {
      console.error('[import] read error:', readError);
      setRows([]);
      setError('Não foi possível ler a planilha. Confira se o arquivo é XLSX, XLS ou CSV.');
    } finally {
      event.target.value = '';
    }
  }

  if (loading || !user) {
    return <LoadingState />;
  }

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Pipeline de dados"
        title="Importação com validação"
        description="Carregue planilhas, confira o mapeamento, veja linhas rejeitadas e evite duplicidade antes de gravar no banco."
      >
        <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
          <DialogTrigger asChild>
            <Button type="button">
              <UploadCloud className="h-4 w-4" />
              Carregar arquivo
            </Button>
          </DialogTrigger>
          <DialogContent className="h-[88vh] max-h-[88vh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden p-0 sm:h-180 sm:max-h-[88vh] sm:w-[calc(100vw-3rem)] sm:max-w-5xl">
            <div className="flex h-full min-h-0 flex-col">
              <DialogHeader className="border-b border-border/70 px-5 py-5 text-left sm:px-7">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <DialogTitle className="text-xl">Carregar arquivo</DialogTitle>
                    <DialogDescription className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                      Nesta etapa o sistema faz preview e validação local. A gravação final deve chamar a API de lote.
                    </DialogDescription>
                  </div>
                  <div className="hidden rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-muted-foreground lg:inline-flex">
                    {selectedProfile.title}
                  </div>
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid gap-5 px-5 py-5 sm:px-7 sm:py-6 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] lg:items-start">
                  <section className="rounded-2xl border border-border/70 bg-background p-5 shadow-sm sm:p-6">
                    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Tipo de importação</p>
                        <h3 className="mt-1 text-base font-semibold text-foreground">Escolha o contrato de dados antes do envio</h3>
                      </div>
                      <StatusBadge tone="success">{selectedProfile.title}</StatusBadge>
                    </div>

                    <div className="grid gap-3">
                      {(Object.keys(importProfiles) as ImportKind[]).map((profileKey) => {
                        const profile = importProfiles[profileKey];
                        const selected = kind === profileKey;

                        return (
                          <button
                            key={profileKey}
                            type="button"
                            onClick={() => handleSelectKind(profileKey)}
                            className={`rounded-xl border p-4 text-left transition-colors ${
                              selected ? 'border-primary bg-primary/10 shadow-sm' : 'border-border bg-background hover:border-primary/50'
                            }`}
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-semibold text-foreground">{profile.title}</p>
                                <p className="mt-1 text-sm text-muted-foreground">{profile.description}</p>
                              </div>
                              {selected ? <StatusBadge tone="success">Selecionado</StatusBadge> : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <div className="space-y-4 lg:space-y-5">
                    <section className="rounded-2xl border border-border/70 bg-background p-5 shadow-sm sm:p-6">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Arquivo</p>
                      <h3 className="mt-2 text-lg font-semibold text-foreground">{selectedProfile.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{selectedProfile.description}</p>

                      <label className="mt-5 flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/40 p-6 text-center transition-colors hover:border-primary sm:min-h-56 sm:p-8">
                        <UploadCloud className="mb-3 h-9 w-9 text-primary" />
                        <span className="font-semibold">Selecionar planilha</span>
                        <span className="mt-1 text-sm text-muted-foreground">CSV, XLS ou XLSX</span>
                        <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" onChange={handleFile} />
                      </label>

                      {error ? (
                        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
                      ) : null}

                      <div className="mt-4 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                        {fileName ? `Arquivo atual: ${fileName}` : 'Nenhum arquivo selecionado ainda.'}
                      </div>
                    </section>

                    <section className="rounded-2xl border border-border/70 bg-background p-5 shadow-sm sm:p-6">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Validação</p>
                      <h3 className="mt-2 text-base font-semibold text-foreground">Campos obrigatórios</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        O preview será montado com base no perfil selecionado antes da gravação final por lote.
                      </p>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {selectedProfile.required.map((field) => (
                          <span key={field} className="rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-foreground">
                            {requiredFieldLabels[field] ?? field}
                          </span>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard title="Linhas válidas" value={summary.valid} hint="Prontas para persistência" icon={CheckCircle2} tone="success" />
        <MetricCard title="Rejeitadas" value={summary.invalid} hint="Campos obrigatórios ausentes" icon={AlertTriangle} tone={summary.invalid ? 'danger' : 'default'} />
        <MetricCard title="Duplicadas" value={summary.duplicate} hint="Mesmo código de OS no lote" icon={FileSpreadsheet} tone={summary.duplicate ? 'warning' : 'default'} />
        <MetricCard title="Planilha" value={sheetName || '-'} hint={fileName || 'Nenhum arquivo selecionado'} icon={UploadCloud} />
      </div>

      <div className="mt-5">
        <DataPanel title="Preview do lote" description="Amostra das primeiras linhas interpretadas pelo mapeador.">
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Linha</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 pr-4 font-medium">Código/Data</th>
                    <th className="py-3 pr-4 font-medium">Técnico</th>
                    <th className="py-3 pr-4 font-medium">Tipo</th>
                    <th className="py-3 pr-4 font-medium">Valor</th>
                    <th className="py-3 font-medium">Erros</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((row) => (
                    <tr key={row.rowNumber} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4">{row.rowNumber}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge tone={row.status === 'valid' ? 'success' : row.status === 'duplicate' ? 'warning' : 'danger'}>
                          {row.status === 'valid' ? 'Válida' : row.status === 'duplicate' ? 'Duplicada' : 'Rejeitada'}
                        </StatusBadge>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs">{row.values.codigo || row.values.data || '-'}</td>
                      <td className="py-3 pr-4">{row.values.tecnico || row.values.funcionario || '-'}</td>
                      <td className="py-3 pr-4">{row.values.tipo || row.values.status || '-'}</td>
                      <td className="py-3 pr-4">{row.values.valor || row.values.receber || '-'}</td>
                      <td className="py-3 text-muted-foreground">{row.errors.length ? row.errors.join(', ') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-secondary/40 p-8 text-center text-sm text-muted-foreground">
              Nenhuma planilha carregada ainda.
            </div>
          )}
        </DataPanel>
      </div>
    </AppShell>
  );
}
