'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, FlaskConical, KeyRound, Loader2, Users, XCircle } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useAppSession } from '@/hooks/use-app-session';

type PortoJobDetail = Record<string, unknown> & {
  qra?: string;
  action?: string;
  technician_name?: string;
  porto_name?: string;
};

type PortoJobResult = {
  status: string;
  technicians_processed?: number;
  would_write?: number;
  rows_written?: number;
  range?: { start: string; end: string };
  summary?: Record<string, number>;
  details?: PortoJobDetail[];
  error?: string;
};

function jobDetailActionLabel(action: string | undefined) {
  switch (action) {
    case 'imported':
    case 'would_import':
      return 'Importado';
    case 'skipped_no_match':
      return 'Sem técnico correspondente no sistema';
    case 'no_services':
      return 'Nenhum serviço encontrado no período';
    case 'already_imported':
      return 'Já importado antes (pulado)';
    case 'no_completion_time':
      return 'Sem horário de conclusão encontrado';
    case 'invalid_hours':
      return 'Horas calculadas inválidas';
    case 'escala_fetch_failed':
    case 'escala_fetch_failed_fallback_0800':
      return 'Falha ao buscar escala (usou 08:00 como aproximação)';
    case 'check_only':
      return 'Só checagem — mês já importado';
    case 'time_budget_exceeded_stopping_early':
      return 'Execução parou por limite de tempo (continua na próxima)';
    case 'service_detail_failed':
      return 'Falha ao abrir detalhe de um serviço (pulado)';
    default:
      return action || '-';
  }
}

function formatDetailExtra(detail: PortoJobDetail) {
  const { qra, action, technician_id, technician_name, porto_name, ...rest } = detail;
  const entries = Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '-';
  return entries.map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join('; ');
}

function actionSummaryLabel(action: string, count: number) {
  return `${jobDetailActionLabel(action)}: ${count}`;
}

type PortoConfig = {
  cpf: string;
  has_password: boolean;
  automation_enabled: boolean;
  dry_run_only: boolean;
  last_hours_import_at: string | null;
  last_hours_import_status: string | null;
  last_schedule_check_at: string | null;
  last_schedule_import_month: string | null;
  last_schedule_import_status: string | null;
  last_error: string | null;
  updated_at: string | null;
};

type PortoSocorristaRow = {
  qra: string;
  name: string;
  cpf?: string;
  status: string;
};

type MatchTechnician = {
  id: string;
  qra: string | null;
  porto_name_hint: string | null;
  name: string;
  email: string;
  commission_percentage: number;
  base_salary: number;
  va_allowance: number;
  vr_allowance: number;
  status: string;
};

type PortoSyncLog = {
  id: string;
  job_type: 'hours' | 'schedule';
  started_at: string;
  finished_at: string | null;
  status: string;
  technicians_processed: number;
  rows_written: number;
  error_message: string | null;
  details: PortoJobDetail[] | null;
  range_start: string | null;
  range_end: string | null;
};

function summarizeDetails(details: PortoJobDetail[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const detail of details) {
    const action = typeof detail.action === 'string' ? detail.action : 'unknown';
    counts[action] = (counts[action] ?? 0) + 1;
  }
  return counts;
}

const inputClassName = 'min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring';

function formatDateTime(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}

function statusLabel(status: string | null) {
  if (status === 'success') return 'Sucesso';
  if (status === 'partial') return 'Parcial';
  if (status === 'error') return 'Erro';
  if (status === 'skipped') return 'Ignorado (automação desligada)';
  if (status === 'running') return 'Em execução';
  if (status === 'dry_run') return 'Modo teste (simulado, nada gravado)';
  return '-';
}

function jobTypeLabel(jobType: string) {
  return jobType === 'hours' ? 'Apontamento de horas' : 'Escala';
}

export default function ConfigPortoPage() {
  const { user, loading } = useAppSession();
  const [config, setConfig] = useState<PortoConfig | null>(null);
  const [logs, setLogs] = useState<PortoSyncLog[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');

  const [cpf, setCpf] = useState('');
  const [password, setPassword] = useState('');
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [dryRunOnly, setDryRunOnly] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');

  const [isTestingLogin, setIsTestingLogin] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; screenshotUrl?: string | null } | null>(null);

  const [testStartDate, setTestStartDate] = useState('');
  const [testEndDate, setTestEndDate] = useState('');

  const [runningJob, setRunningJob] = useState<'hours' | 'schedule' | null>(null);
  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [jobModalJobType, setJobModalJobType] = useState<'hours' | 'schedule' | null>(null);
  const [jobResult, setJobResult] = useState<PortoJobResult | null>(null);

  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [isMatchLoading, setIsMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [matchSaveMessage, setMatchSaveMessage] = useState('');
  const [isSavingMatches, setIsSavingMatches] = useState(false);
  const [portoSocorristas, setPortoSocorristas] = useState<PortoSocorristaRow[]>([]);
  const [matchTechnicians, setMatchTechnicians] = useState<MatchTechnician[]>([]);
  const [matchSelections, setMatchSelections] = useState<Record<string, string>>({});

  async function loadConfig() {
    setIsDataLoading(true);
    setDataError('');
    try {
      const response = await fetch('/api/porto-config');
      if (!response.ok) throw new Error('Falha ao carregar configuração.');
      const data = await response.json();
      setConfig(data.config);
      setLogs(data.logs ?? []);
      setCpf(data.config?.cpf ?? '');
      setAutomationEnabled(Boolean(data.config?.automation_enabled));
      setDryRunOnly(data.config?.dry_run_only !== false);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : 'Falha ao carregar configuração.');
    } finally {
      setIsDataLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setSaveMessage('');
    setSaveError('');
    try {
      const response = await fetch('/api/porto-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf,
          password: password || undefined,
          automation_enabled: automationEnabled,
          dry_run_only: dryRunOnly,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Falha ao salvar configuração.');
      }
      setConfig(data.config);
      setPassword('');
      setSaveMessage('Configuração salva com sucesso.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Falha ao salvar configuração.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTestLogin() {
    setIsTestingLogin(true);
    setTestResult(null);
    try {
      const response = await fetch('/api/porto-config/test-login', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        setTestResult({ success: false, message: data.error || 'Falha ao testar login.', screenshotUrl: data.screenshotUrl });
        return;
      }
      setTestResult({ success: true, message: data.message || 'Login realizado com sucesso.' });
    } catch {
      setTestResult({ success: false, message: 'Falha ao testar login.' });
    } finally {
      setIsTestingLogin(false);
    }
  }

  async function handleRunTestJob(jobType: 'hours' | 'schedule') {
    setRunningJob(jobType);
    setJobModalJobType(jobType);
    setJobResult(null);
    setJobModalOpen(true);
    try {
      const params = new URLSearchParams();
      if (jobType === 'hours' && testStartDate) {
        params.set('start', testStartDate);
        params.set('end', testEndDate || testStartDate);
      }
      const query = params.toString();
      const response = await fetch(`/api/cron/porto-${jobType === 'hours' ? 'hours' : 'schedule'}${query ? `?${query}` : ''}`);
      const rawText = await response.text();
      let data: PortoJobResult;
      try {
        data = JSON.parse(rawText);
      } catch {
        // The route itself always returns JSON — a non-JSON body means the platform (Vercel)
        // cut the invocation off before our own response was sent, e.g. a timeout.
        setJobResult({ status: 'error', error: `A execução não terminou a tempo ou falhou na Vercel (resposta não veio em JSON, status ${response.status}). Veja os logs da function para detalhes.` });
        return;
      }
      setJobResult(data);
    } catch (error) {
      setJobResult({ status: 'error', error: error instanceof Error ? error.message : 'Falha ao rodar o teste.' });
    } finally {
      setRunningJob(null);
      loadConfig();
    }
  }

  function handleOpenHistoryLog(log: PortoSyncLog) {
    setJobModalJobType(log.job_type);
    setJobModalOpen(true);
    const details = log.details ?? [];
    setJobResult({
      status: log.status,
      technicians_processed: log.technicians_processed,
      rows_written: log.rows_written,
      range: log.range_start ? { start: log.range_start, end: log.range_end || log.range_start } : undefined,
      summary: details.length ? summarizeDetails(details) : undefined,
      details,
      error: log.error_message || undefined,
    });
  }

  async function handleOpenMatch() {
    setMatchModalOpen(true);
    setIsMatchLoading(true);
    setMatchError('');
    setMatchSaveMessage('');
    setPortoSocorristas([]);
    setMatchTechnicians([]);
    setMatchSelections({});
    try {
      const response = await fetch('/api/porto-config/socorristas', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Falha ao buscar técnicos do Porto.');
      }
      const socorristas: PortoSocorristaRow[] = data.socorristas ?? [];
      const technicians: MatchTechnician[] = data.technicians ?? [];
      setPortoSocorristas(socorristas);
      setMatchTechnicians(technicians);

      const initialSelections: Record<string, string> = {};
      for (const socorrista of socorristas) {
        const matched = technicians.find((technician) => technician.qra === socorrista.qra);
        initialSelections[socorrista.qra] = matched?.id ?? '';
      }
      setMatchSelections(initialSelections);
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : 'Falha ao buscar técnicos do Porto.');
    } finally {
      setIsMatchLoading(false);
    }
  }

  async function patchTechnicianMatch(technician: MatchTechnician, overrides: { qra: string | null; porto_name_hint: string | null }) {
    const response = await fetch(`/api/technicians?id=${technician.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qra: overrides.qra,
        porto_name_hint: overrides.porto_name_hint,
        name: technician.name,
        email: technician.email,
        commission_percentage: technician.commission_percentage,
        base_salary: technician.base_salary,
        va_allowance: technician.va_allowance,
        vr_allowance: technician.vr_allowance,
        status: technician.status,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Falha ao salvar match para o técnico ${technician.name}.`);
    }
  }

  async function handleSaveMatches() {
    setIsSavingMatches(true);
    setMatchError('');
    setMatchSaveMessage('');
    try {
      // Guard against the same local technician being picked for two different Porto QRAs — only
      // the last save would "win", silently dropping the other match.
      const selectedIds = Object.values(matchSelections).filter(Boolean);
      const duplicateId = selectedIds.find((id, index) => selectedIds.indexOf(id) !== index);
      if (duplicateId) {
        const duplicateTechnician = matchTechnicians.find((technician) => technician.id === duplicateId);
        throw new Error(`"${duplicateTechnician?.name ?? 'Um técnico'}" foi selecionado para mais de um QRA do Porto — corrija antes de salvar.`);
      }

      let savedCount = 0;
      for (const socorrista of portoSocorristas) {
        const previousTechnician = matchTechnicians.find((technician) => technician.qra === socorrista.qra);
        const selectedId = matchSelections[socorrista.qra] || '';
        const alreadyMatched = (previousTechnician?.id || '') === selectedId;
        if (alreadyMatched) continue;

        if (!selectedId) {
          if (previousTechnician) {
            await patchTechnicianMatch(previousTechnician, { qra: null, porto_name_hint: previousTechnician.porto_name_hint });
            savedCount++;
          }
          continue;
        }

        const technician = matchTechnicians.find((item) => item.id === selectedId);
        if (!technician) continue;
        await patchTechnicianMatch(technician, { qra: socorrista.qra, porto_name_hint: socorrista.name });
        savedCount++;
      }

      setMatchSaveMessage(savedCount ? `${savedCount} match(es) salvo(s) com sucesso.` : 'Nenhuma mudança para salvar.');
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : 'Falha ao salvar matches.');
    } finally {
      setIsSavingMatches(false);
    }
  }

  if (loading || isDataLoading || !user) {
    return <LoadingState />;
  }

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Integrações"
        title="Config. Porto"
        description="Login automático no Portal do Prestador (Porto Seguro) para importar apontamento de horas e escala."
      />

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <DataPanel title="Credenciais e automação" description="Login e senha usados para acessar o Portal do Prestador.">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">CPF</label>
              <input
                type="text"
                inputMode="numeric"
                value={cpf}
                onChange={(event) => setCpf(event.target.value)}
                placeholder="Somente números"
                className={inputClassName}
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Senha</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={config?.has_password ? '•••••••• (senha salva)' : 'Digite a senha do Porto'}
                className={inputClassName}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Deixe em branco para manter a senha atual.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Automação ligada</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Apontamento de horas: todo fim de dia, varre o mês inteiro até hoje (pula dias já
                  importados). Escala: checagem diária, importa só quando sai uma nova escala mensal.
                </p>
              </div>
              <Switch checked={automationEnabled} onCheckedChange={setAutomationEnabled} />
            </div>

            <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
              <div>
                <p className="text-sm font-medium text-amber-900">Modo teste (não grava nada)</p>
                <p className="mt-0.5 text-xs text-amber-800">
                  Com o modo teste ligado, os jobs rodam inteiros (login, busca, cálculo) mas não
                  escrevem em escala/horas — só aparecem no histórico abaixo o que <em>seria</em>{' '}
                  gravado. Recomendado manter ligado por alguns dias antes de desligar.
                </p>
              </div>
              <Switch checked={dryRunOnly} onCheckedChange={setDryRunOnly} />
            </div>

            {saveMessage ? <p className="text-sm text-emerald-700">{saveMessage}</p> : null}
            {saveError ? <p className="text-sm text-rose-700">{saveError}</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Salvar
              </Button>
              <Button type="button" variant="outline" onClick={handleTestLogin} disabled={isTestingLogin}>
                {isTestingLogin ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Testar login
              </Button>
            </div>

            {testResult ? (
              <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${testResult.success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
                {testResult.success ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>
                  {testResult.message}
                  {testResult.screenshotUrl ? (
                    <>
                      {' '}
                      <a href={testResult.screenshotUrl} target="_blank" rel="noreferrer" className="underline">
                        Ver screenshot da tentativa
                      </a>
                    </>
                  ) : null}
                </span>
              </div>
            ) : null}
          </form>
        </DataPanel>

        <DataPanel title="Status" description="Última execução de cada job.">
          <div className="flex flex-col gap-3 text-sm">
            <div className="rounded-md border border-border p-3">
              <p className="font-medium text-foreground">Apontamento de horas</p>
              <p className="mt-1 text-muted-foreground">
                Última execução: {formatDateTime(config?.last_hours_import_at ?? null)} — {statusLabel(config?.last_hours_import_status ?? null)}
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="font-medium text-foreground">Escala</p>
              <p className="mt-1 text-muted-foreground">
                Última checagem: {formatDateTime(config?.last_schedule_check_at ?? null)}
              </p>
              <p className="mt-1 text-muted-foreground">
                Último mês importado: {config?.last_schedule_import_month || '-'} — {statusLabel(config?.last_schedule_import_status ?? null)}
              </p>
            </div>
            {config?.last_error ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-700">
                Último erro: {config.last_error}
              </div>
            ) : null}
          </div>
        </DataPanel>
      </div>

      <div className="mt-4">
        <DataPanel
          title="Testes manuais"
          description="Roda o job inteiro (login, busca, cálculo) sem gravar nada em escala/horas — só mostra o que seria feito. Não conta pro limite de 1x/dia do agendamento automático, pode clicar quantas vezes quiser."
        >
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">De (apontamento de horas)</label>
              <input
                type="date"
                value={testStartDate}
                onChange={(event) => setTestStartDate(event.target.value)}
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Até</label>
              <input
                type="date"
                value={testEndDate}
                onChange={(event) => setTestEndDate(event.target.value)}
                disabled={!testStartDate}
                className={inputClassName}
              />
            </div>
            {testStartDate ? (
              <Button type="button" variant="ghost" onClick={() => { setTestStartDate(''); setTestEndDate(''); }}>
                Limpar (voltar pro mês inteiro)
              </Button>
            ) : (
              <p className="pb-2.5 text-xs text-muted-foreground">Em branco = mês inteiro até hoje (padrão).</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => handleRunTestJob('hours')} disabled={runningJob !== null}>
              {runningJob === 'hours' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              Testar apontamento de horas
            </Button>
            <Button type="button" variant="outline" onClick={() => handleRunTestJob('schedule')} disabled={runningJob !== null}>
              {runningJob === 'schedule' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              Testar escala
            </Button>
            <Button type="button" variant="outline" onClick={handleOpenMatch} disabled={runningJob !== null}>
              <Users className="h-4 w-4" />
              Match de técnicos
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            &quot;Match de técnicos&quot; faz login real no Porto, lista os QRAs de lá e deixa você
            confirmar manualmente qual técnico do sistema é cada um — corrige o &quot;Sem técnico
            correspondente&quot; que aparece nos testes acima.
          </p>
        </DataPanel>
      </div>

      <div className="mt-4">
        <DataPanel title="Histórico de execuções" description="Últimas execuções registradas pela automação.">
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma execução registrada ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-4">Job</th>
                    <th className="py-2 pr-4">Início</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Técnicos</th>
                    <th className="py-2 pr-4">Linhas gravadas</th>
                    <th className="py-2">Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      onClick={() => runningJob === null && handleOpenHistoryLog(log)}
                      className={`border-b border-border last:border-0 ${runningJob === null ? 'cursor-pointer hover:bg-secondary/40' : ''}`}
                    >
                      <td className="py-2 pr-4">{jobTypeLabel(log.job_type)}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{formatDateTime(log.started_at)}</td>
                      <td className="py-2 pr-4">{statusLabel(log.status)}</td>
                      <td className="py-2 pr-4">{log.technicians_processed}</td>
                      <td className="py-2 pr-4">{log.rows_written}</td>
                      <td className="py-2 text-rose-700">{log.error_message || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataPanel>
      </div>

      <Dialog open={jobModalOpen} onOpenChange={setJobModalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {jobModalJobType === 'hours' ? 'Apontamento de horas' : 'Escala'}
            </DialogTitle>
            <DialogDescription>
              {jobResult?.status === 'dry_run'
                ? 'Simulação real contra o Portal do Prestador. Nada foi gravado em escala ou horas.'
                : runningJob
                  ? 'Simulação real contra o Portal do Prestador. Nada foi gravado em escala ou horas.'
                  : 'Execução registrada — dados abaixo são os que foram (ou seriam) processados nessa rodada.'}
            </DialogDescription>
          </DialogHeader>

          {runningJob ? (
            <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p>Rodando login, busca e cálculo no Porto... isso pode levar até 1 minuto.</p>
            </div>
          ) : jobResult ? (
            <div className="flex flex-col gap-4">
              <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${jobResult.status === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : jobResult.status === 'skipped' ? 'border-border bg-secondary/40 text-muted-foreground' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                {jobResult.status === 'error' ? (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                ) : jobResult.status === 'skipped' ? (
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>
                  {statusLabel(jobResult.status)}
                  {jobResult.error ? ` — ${jobResult.error}` : ''}
                </span>
              </div>

              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Técnicos processados</p>
                  <p className="text-lg font-semibold text-foreground">{jobResult.technicians_processed ?? '-'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{jobResult.status === 'dry_run' ? 'Linhas que seriam gravadas' : 'Linhas gravadas'}</p>
                  <p className="text-lg font-semibold text-foreground">{jobResult.would_write ?? jobResult.rows_written ?? '-'}</p>
                </div>
                {jobResult.range ? (
                  <div>
                    <p className="text-muted-foreground">Período checado</p>
                    <p className="text-lg font-semibold text-foreground">
                      {jobResult.range.start === jobResult.range.end ? jobResult.range.start : `${jobResult.range.start} a ${jobResult.range.end}`}
                    </p>
                  </div>
                ) : null}
              </div>

              {jobResult.summary && Object.keys(jobResult.summary).length ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                  {Object.entries(jobResult.summary).map(([action, count]) => (
                    <span key={action}>{actionSummaryLabel(action, count)}</span>
                  ))}
                </div>
              ) : null}

              {jobResult.details && jobResult.details.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                        <th className="py-2 pr-4">QRA</th>
                        <th className="py-2 pr-4">Técnico</th>
                        <th className="py-2 pr-4">Resultado</th>
                        <th className="py-2">Detalhes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobResult.details
                        .filter((detail) => detail.qra)
                        .map((detail, index) => (
                          <tr key={`${detail.qra}-${index}`} className="border-b border-border last:border-0">
                            <td className="py-2 pr-4">{detail.qra}</td>
                            <td className="py-2 pr-4">{detail.technician_name || (detail.porto_name ? `${detail.porto_name} (Porto)` : '-')}</td>
                            <td className="py-2 pr-4">{jobDetailActionLabel(detail.action)}</td>
                            <td className="py-2 text-muted-foreground">{formatDetailExtra(detail)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum técnico processado nesse teste.</p>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={matchModalOpen} onOpenChange={setMatchModalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Match de técnicos</DialogTitle>
            <DialogDescription>
              Login real no Portal do Prestador para listar os QRAs cadastrados lá. Escolha qual
              técnico do sistema corresponde a cada um e salve — isso atualiza o QRA e o nome usado
              na busca de serviços de cada técnico.
            </DialogDescription>
          </DialogHeader>

          {isMatchLoading ? (
            <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p>Fazendo login e buscando técnicos no Porto...</p>
            </div>
          ) : matchError ? (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{matchError}</span>
            </div>
          ) : portoSocorristas.length ? (
            <div className="flex flex-col gap-4">
              {matchSaveMessage ? <p className="text-sm text-emerald-700">{matchSaveMessage}</p> : null}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-4">QRA</th>
                      <th className="py-2 pr-4">Nome no Porto</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2">Técnico no sistema</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portoSocorristas.map((socorrista) => (
                      <tr key={socorrista.qra} className="border-b border-border last:border-0">
                        <td className="py-2 pr-4">{socorrista.qra}</td>
                        <td className="py-2 pr-4">{socorrista.name}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{socorrista.status || '-'}</td>
                        <td className="py-2">
                          <select
                            className={inputClassName}
                            value={matchSelections[socorrista.qra] ?? ''}
                            onChange={(event) =>
                              setMatchSelections((previous) => ({ ...previous, [socorrista.qra]: event.target.value }))
                            }
                          >
                            <option value="">-- sem correspondência --</option>
                            {matchTechnicians.map((technician) => (
                              <option key={technician.id} value={technician.id}>
                                {technician.name}
                                {technician.qra && technician.qra !== socorrista.qra ? ` (QRA atual: ${technician.qra})` : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <Button type="button" onClick={handleSaveMatches} disabled={isSavingMatches}>
                  {isSavingMatches ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Salvar matches
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum técnico encontrado no Porto.</p>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
