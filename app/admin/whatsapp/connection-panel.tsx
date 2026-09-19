'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, Loader2, Plug, Send, UserX, XCircle } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { StatusBadge } from '@/components/status-badge';
import { PhoneInput } from '@/components/phone-input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { validatePhone } from '@/lib/whatsapp/phone';
import { inputClassName, type EnvConnection, type TechnicianOption, type WhatsAppConfigForm } from './types';

interface ConnectionPanelProps {
  form: WhatsAppConfigForm;
  connection: EnvConnection;
  onChange: (patch: Partial<WhatsAppConfigForm>) => void;
  technicians: TechnicianOption[];
  /** True while an edit hasn't reached the server yet — sending would use the old settings. */
  unsaved: boolean;
}

type Feedback = { tone: 'success' | 'error'; text: string } | null;

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;

  const Icon = feedback.tone === 'success' ? CheckCircle2 : XCircle;
  return (
    <p className={`flex items-start gap-2 text-sm ${feedback.tone === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      {feedback.text}
    </p>
  );
}

export function ConnectionPanel({ form, connection, onChange, technicians, unsaved }: ConnectionPanelProps) {
  const connectionReady = Boolean(connection.apiUrl && connection.instance && connection.hasApiKey);
  const envRows = [
    { variable: 'EVOLUTION_API_URL', value: connection.apiUrl },
    { variable: 'EVOLUTION_INSTANCE', value: connection.instance },
    { variable: 'EVOLUTION_API_KEY', value: connection.hasApiKey ? '•••••••• (definida)' : '' },
  ];
  const [isTesting, setIsTesting] = useState(false);
  const [connectionFeedback, setConnectionFeedback] = useState<Feedback>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testText, setTestText] = useState('Mensagem de teste da Central Operacional ✅');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testFeedback, setTestFeedback] = useState<Feedback>(null);

  const withoutPhone = technicians.filter((technician) => technician.status === 'active' && !technician.phone);

  async function handleTestConnection() {
    setIsTesting(true);
    setConnectionFeedback(null);

    try {
      const response = await fetch('/api/whatsapp/connection', { method: 'POST' });
      const data = await response.json().catch(() => null);

      if (!response.ok) throw new Error(data?.error || 'Não foi possível testar.');

      setConnectionFeedback(
        data.connected
          ? { tone: 'success', text: 'Conectado: a instância está online no WhatsApp.' }
          : { tone: 'error', text: data.error || `Instância não conectada${data.state ? ` (estado: ${data.state})` : ''}. Leia o QR Code no painel da Evolution.` },
      );
    } catch (error) {
      setConnectionFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível testar.' });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSendTest() {
    setIsSendingTest(true);
    setTestFeedback(null);

    try {
      const response = await fetch('/api/whatsapp/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testPhone, message: testText }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) throw new Error(data?.error || 'Não foi possível enviar.');

      setTestFeedback({ tone: 'success', text: 'Mensagem enviada. Confira no WhatsApp.' });
    } catch (error) {
      setTestFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível enviar.' });
    } finally {
      setIsSendingTest(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] xl:items-start">
      <DataPanel title="Evolution API" description="A conexão vem do .env, com as mesmas variáveis do EssencialCentro. Aqui você liga a automação e testa.">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background px-3 py-3">
            <div>
              <p className="text-sm font-medium">Automação ativa</p>
              <p className="text-xs text-muted-foreground">Desligada, nenhuma notificação automática é enviada. Envios manuais e de teste continuam funcionando.</p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(enabled) => onChange({ enabled })} />
          </div>

          <div className="rounded-md border border-border bg-secondary/30 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Conexão (via .env)</p>
              <StatusBadge tone={connectionReady ? 'success' : 'danger'}>{connectionReady ? 'Configurada' : 'Incompleta'}</StatusBadge>
            </div>
            <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
              {envRows.map((row) => (
                <div key={row.variable} className="contents">
                  <dt className="font-mono text-xs leading-6 text-muted-foreground">{row.variable}</dt>
                  <dd className={`min-w-0 break-all ${row.value ? '' : 'text-rose-700'}`}>{row.value || 'não definida'}</dd>
                </div>
              ))}
            </dl>
            {!connectionReady ? (
              <p className="mt-2 text-xs text-rose-700">
                Defina as variáveis que faltam no .env (local), na Vercel e no container do worker na VPS, e reinicie.
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Link do sistema (opcional)</span>
              <input
                type="url"
                value={form.appUrl}
                onChange={(event) => onChange({ appUrl: event.target.value })}
                placeholder="https://seu-sistema.vercel.app"
                className={inputClassName}
              />
              <span className="mt-1 block text-xs text-muted-foreground">Usado pela variável {'{link}'} nas mensagens.</span>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Número de teste (opcional)</span>
              <PhoneInput
                value={form.testPhone}
                onChange={(testPhone) => onChange({ testPhone })}
                className={inputClassName}
                checkWhatsApp
                hint={
                  <>
                    Preenchido, <strong>todas</strong> as notificações vão para este número em vez dos técnicos. Esvazie para liberar os envios reais.
                  </>
                }
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={handleTestConnection} disabled={isTesting || !connectionReady}>
              {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              Testar conexão
            </Button>
          </div>
          <FeedbackLine feedback={connectionFeedback} />
        </div>
      </DataPanel>

      <div className="space-y-5">
        <DataPanel title="Mensagem de teste" description="Envia agora, para o número digitado. Fica registrada no histórico.">
          <div className="space-y-3">
            <div>
              <PhoneInput value={testPhone} onChange={setTestPhone} className={inputClassName} checkWhatsApp />
            </div>
            <textarea
              value={testText}
              onChange={(event) => setTestText(event.target.value)}
              rows={3}
              className={`${inputClassName} py-2`}
            />
            <Button type="button" onClick={handleSendTest} disabled={isSendingTest || unsaved || validatePhone(testPhone).status !== 'valid' || !testText.trim()}>
              {isSendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar teste
            </Button>
            <FeedbackLine feedback={testFeedback} />
          </div>
        </DataPanel>

        <DataPanel
          title="Técnicos sem WhatsApp"
          description={withoutPhone.length ? 'Técnicos ativos que não recebem notificações por falta de número.' : 'Todos os técnicos ativos têm número cadastrado.'}
        >
          {withoutPhone.length ? (
            <div className="space-y-2">
              <ul className="space-y-1.5 text-sm">
                {withoutPhone.map((technician) => (
                  <li key={technician.id} className="flex items-center gap-2">
                    <UserX className="h-4 w-4 text-amber-600" />
                    {technician.name}
                  </li>
                ))}
              </ul>
              <Link href="/admin/technicians" className="inline-block text-sm font-medium text-primary hover:underline">
                Cadastrar números em Técnicos →
              </Link>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Tudo certo.
            </p>
          )}
        </DataPanel>
      </div>
    </div>
  );
}
