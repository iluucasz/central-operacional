'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, XCircle } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { LoadingState } from '@/components/loading-state';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAppSession } from '@/hooks/use-app-session';

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

type PortoSyncLog = {
  id: string;
  job_type: 'hours' | 'schedule';
  started_at: string;
  finished_at: string | null;
  status: string;
  technicians_processed: number;
  rows_written: number;
  error_message: string | null;
};

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
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

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
        setTestResult({ success: false, message: data.error || 'Falha ao testar login.' });
        return;
      }
      setTestResult({ success: true, message: data.message || 'Login realizado com sucesso.' });
    } catch {
      setTestResult({ success: false, message: 'Falha ao testar login.' });
    } finally {
      setIsTestingLogin(false);
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
                  Apontamento de horas: todo fim de dia. Escala: checagem diária, importa só quando sai uma nova escala mensal.
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
                <span>{testResult.message}</span>
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
                    <tr key={log.id} className="border-b border-border last:border-0">
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
    </AppShell>
  );
}
