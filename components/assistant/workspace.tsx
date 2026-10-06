'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Archive,
  ArrowUp,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  History,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { Markdown } from '@/components/markdown';
import './assistant.css';

type Usage = { month: string; uses: number; cost: number };
type Status = {
  available: boolean;
  reason: string | null;
  month: string;
  /** Spent this month, in R$. */
  spent: number;
  /** Monthly cap in R$ (0 = no cap). */
  budget: number;
  usage: Usage[];
  /** Starter questions built from the current data. */
  suggestions: string[];
  conversations: {
    id: string;
    title: string;
    updatedAt: string;
    messages: number;
  }[];
};
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed: string[];
  /** What the answer cost, in R$. */
  cost: number | null;
  /** Follow-up questions offered under an answer. */
  suggestions?: string[];
  createdAt: string;
};
type Preferences = {
  enterToSend: boolean;
  showSources: boolean;
  largeText: boolean;
};
type Tab = 'chat' | 'history' | 'usage' | 'settings';
const DEFAULTS: Preferences = {
  enterToSend: true,
  showSources: true,
  largeText: false,
};
const PREF_KEY = 'central-assistant-preferences';
const tabs = [
  { id: 'chat', label: 'Conversa', icon: MessageCircle },
  { id: 'history', label: 'Histórico', icon: History },
  { id: 'usage', label: 'Consumo', icon: Wallet },
  { id: 'settings', label: 'Preferências', icon: Settings2 },
] as const;
/** Used only until the server's suggestions arrive (or if it sends none). */
const fallbackSuggestions = [
  'Qual técnico mais produziu este mês?',
  'Quem recebeu advertência de laudo este mês?',
  'Quais folhas precisam de atenção?',
  'O robô do Porto rodou bem ontem?',
];
const toolLabels: Record<string, string> = {
  resumo_da_empresa: 'Empresa',
  listar_tecnicos: 'Técnicos',
  producao_por_tecnico: 'Produção',
  listar_os: 'Ordens de serviço',
  folha_da_competencia: 'Folha',
  horas_trabalhadas: 'Horas',
  escala: 'Escala',
  descontos_e_adiantamentos: 'Descontos',
  financeiro_do_mes: 'Financeiro',
  robo_do_porto: 'Robô do Porto',
};
const number = (value: number) => value.toLocaleString('pt-BR');
const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
/** Answers cost fractions of a cent: show them with enough digits to mean something. */
const smallMoney = (value: number) => {
  const digits = value > 0 && value < 0.1 ? 3 : 2;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
};
const monthName = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)))
    .replace('.', '');
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}/${String(year).slice(2)}`;
};
const time = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
const monthKey = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
};
async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(data?.error || 'Não foi possível concluir a ação.');
  return data as T;
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/plain;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AssistantWorkspace({ compact = false }: { compact?: boolean }) {
  const [tab, setTab] = useState<Tab>('chat');
  const [status, setStatus] = useState<Status | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [opening, setOpening] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const busy = useRef(false);
  const loadSequence = useRef(0);
  const refreshSequence = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const currentMonth = monthKey();
  const usage = status?.usage.find((item) => item.month === currentMonth);
  const title =
    status?.conversations.find((item) => item.id === conversationId)?.title ??
    (conversationId ? 'Conversa em andamento' : 'Nova conversa');

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setRefreshing(true);
    await request<Status>('/api/assistant')
      .then((data) => {
        if (sequence === refreshSequence.current) setStatus(data);
      })
      .catch((reason) => {
        if (sequence === refreshSequence.current) setError(reason.message);
      });
    if (sequence === refreshSequence.current) setRefreshing(false);
  }, []);
  useEffect(() => {
    void refresh();
    try {
      const value = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      setPrefs({
        enterToSend:
          typeof value.enterToSend === 'boolean' ? value.enterToSend : true,
        showSources:
          typeof value.showSources === 'boolean' ? value.showSources : true,
        largeText: value.largeText === true,
      });
    } catch {
      /* Defaults also work without storage. */
    }
  }, [refresh]);
  useEffect(() => {
    const area = scroll.current;
    if (area)
      area.scrollTo({
        top: messages.length || asking ? area.scrollHeight : 0,
        behavior: messages.length || asking ? 'smooth' : 'instant',
      });
  }, [messages, asking, tab]);

  function preference(key: keyof Preferences, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
      setNotice('Preferências salvas neste navegador.');
    } catch {
      setNotice(
        'Preferências aplicadas nesta sessão. O navegador bloqueou o armazenamento.',
      );
    }
  }
  function startNew() {
    if (busy.current) return;
    loadSequence.current++;
    setOpening(false);
    setConversationId(null);
    setMessages([]);
    setQuestion('');
    setError('');
    setTab('chat');
    input.current?.focus();
  }
  async function open(id: string) {
    if (busy.current) return;
    const sequence = ++loadSequence.current;
    setOpening(true);
    setError('');
    try {
      const data = await request<{ id: string; messages: Message[] }>(
        `/api/assistant/${id}`,
      );
      if (sequence !== loadSequence.current) return;
      setConversationId(data.id);
      setMessages(data.messages);
      setQuestion('');
      setTab('chat');
    } catch (reason) {
      if (sequence === loadSequence.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Não foi possível abrir a conversa.',
        );
    } finally {
      if (sequence === loadSequence.current) setOpening(false);
    }
  }
  async function archive(id: string) {
    if (
      busy.current ||
      !window.confirm(
        'Arquivar esta conversa? Ela deixará de aparecer no seu histórico.',
      )
    )
      return;
    busy.current = true;
    setOpening(true);
    try {
      await request(`/api/assistant/${id}`, 'DELETE');
      loadSequence.current++;
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Não foi possível arquivar.',
      );
    } finally {
      busy.current = false;
      setOpening(false);
    }
  }
  async function send(text?: string) {
    const content = (text ?? question).trim();
    if (!content || busy.current || opening || !status?.available) return;
    busy.current = true;
    setAsking(true);
    setError('');
    setQuestion('');
    const pending: Message = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content,
      toolsUsed: [],
      cost: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, pending]);
    try {
      const result = await request<{
        conversationId: string;
        message: Message;
      }>('/api/assistant', 'POST', { question: content, conversationId });
      setConversationId(result.conversationId);
      setMessages((current) => [...current, result.message]);
      await refresh();
    } catch (reason) {
      setMessages((current) =>
        current.filter((message) => message.id !== pending.id),
      );
      setQuestion(content);
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível responder.',
      );
    } finally {
      busy.current = false;
      setAsking(false);
      input.current?.focus();
    }
  }
  async function copy(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(message.id);
    } catch {
      setError(
        'Não foi possível copiar. Selecione o texto da resposta para copiar.',
      );
    }
  }

  const summary = (
    <div className="ai-summary">
      <button type="button" onClick={() => setTab('usage')}>
        <span>Gasto neste mês</span>
        <strong>
          {status ? money(status.spent) : '—'} <Sparkles size={19} />
        </strong>
        <small>
          {status
            ? status.budget > 0
              ? `Limite de ${money(status.budget)}`
              : 'Sem limite mensal'
            : 'Carregando consumo…'}
        </small>
      </button>
      <button type="button" onClick={() => setTab('usage')}>
        <span>Perguntas neste mês</span>
        <strong>{status ? number(usage?.uses ?? 0) : '—'}</strong>
        <small>{`Respondidas em ${currentMonth.split('-').reverse().join('/')}`}</small>
      </button>
      {!compact && (
        <div>
          <span>Custo médio por resposta</span>
          <strong>{usage?.uses ? smallMoney(usage.cost / usage.uses) : '—'}</strong>
          <Link href="/admin/configuracoes">
            Limite e preços <ArrowUpRight size={16} />
          </Link>
        </div>
      )}
    </div>
  );

  return (
    <section
      className={`nr-assistant ${compact ? 'is-compact' : ''} ${prefs.largeText ? 'is-large-text' : ''}`}
      aria-label="Assistente de IA"
    >
      {!compact && (
        <header className="ai-page-heading">
          <div>
            <span className="ai-eyebrow">CENTRAL OPERACIONAL / INTELIGÊNCIA</span>
            <h1>Sua operação, em uma conversa.</h1>
            <p>
              Consulte os dados da operação, encontre respostas e acompanhe o
              gasto com IA.
            </p>
          </div>
          <span className="ai-brand-icon">
            <Sparkles size={30} />
          </span>
        </header>
      )}
      {compact && summary}
      <div className="ai-workspace">
        <aside className="ai-navigation">
          <button
            className="ai-primary ai-new"
            disabled={asking || opening}
            onClick={startNew}
          >
            <Plus size={19} /> Nova conversa
          </button>
          <nav aria-label="Ferramentas do assistente">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => {
                  setTab(id);
                  setNotice('');
                }}
              >
                <Icon size={19} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <div className="ai-main">
          <header className="ai-panel-heading">
            <div>
              <h2>
                {tab === 'chat'
                  ? title
                  : tabs.find((item) => item.id === tab)?.label}
              </h2>
              <p>
                {tab === 'chat'
                  ? 'Assistente de IA'
                  : tab === 'history'
                    ? 'Retome suas últimas 50 conversas.'
                    : tab === 'usage'
                      ? 'Gasto com o assistente, mês a mês.'
                      : 'Deixe o assistente do seu jeito.'}
              </p>
            </div>
            <div className="ai-heading-actions">
              {compact && (
                <button
                  aria-label="Nova conversa"
                  title="Nova conversa"
                  disabled={asking || opening}
                  onClick={startNew}
                >
                  <Plus size={19} />
                </button>
              )}
              {tab === 'chat' && messages.length > 0 && (
                <button
                  title="Baixar conversa"
                  aria-label="Baixar conversa"
                  onClick={() =>
                    download(
                      'conversa-assistente.txt',
                      messages
                        .map(
                          (m) =>
                            `${m.role === 'user' ? 'Você' : 'Assistente'} · ${time(m.createdAt)}\n${m.content}`,
                        )
                        .join('\n\n'),
                    )
                  }
                >
                  <Download size={19} />
                </button>
              )}
              <button
                title="Atualizar consumo e histórico"
                aria-label="Atualizar consumo e histórico"
                disabled={refreshing || asking}
                onClick={() => void refresh()}
              >
                <RefreshCw
                  size={18}
                  className={refreshing ? 'animate-spin' : ''}
                />
              </button>
            </div>
          </header>
          {error && (
            <div role="alert" className="ai-error">
              {error}
              <button
                onClick={() => {
                  setError('');
                  void refresh();
                }}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {tab === 'chat' && (
            <>
              {status && !status.available && (
                <p className="ai-notice">
                  {status.reason}{' '}
                  <Link href="/admin/configuracoes">Abrir Configurações</Link>
                </p>
              )}
              <div
                className="ai-messages"
                ref={scroll}
                aria-label="Mensagens da conversa"
                aria-busy={asking || opening}
              >
                {!messages.length && (
                  <div className="ai-welcome">
                    <span className="ai-welcome-icon">
                      <Sparkles size={32} />
                    </span>
                    <h3>O que vamos descobrir hoje?</h3>
                    <p>
                      {compact ? (
                        'Consulte os dados da operação com uma pergunta.'
                      ) : (
                        <>
                          Comece com uma pergunta sobre sua operação.
                          <br />
                          Eu consulto os dados e organizo a resposta para você.
                        </>
                      )}
                    </p>
                    <div className="ai-suggestions">
                      {(status?.suggestions?.length ? status.suggestions : fallbackSuggestions)
                        .slice(0, compact ? 4 : 6)
                        .map((text, index) => (
                          <button
                            key={text}
                            disabled={!status?.available || asking}
                            onClick={() => void send(text)}
                          >
                            <span>0{index + 1}</span>
                            {text}
                            <ArrowUpRight size={17} />
                          </button>
                        ))}
                    </div>
                  </div>
                )}
                {messages.map((message, index) => (
                  <article
                    key={message.id}
                    className={`ai-message ${message.role === 'user' ? 'from-user' : 'from-assistant'}`}
                  >
                    <span className="ai-message-author">
                      {message.role === 'user' ? (
                        'Você'
                      ) : (
                        <>
                          <Sparkles size={16} /> Assistente
                        </>
                      )}
                    </span>
                    <div className="ai-message-body">
                      {message.role === 'user' ? (
                        message.content
                      ) : (
                        <Markdown text={message.content} />
                      )}
                    </div>
                    <footer>
                      <span>
                        {time(message.createdAt)}
                        {message.role === 'assistant' && message.cost !== null
                          ? ` · ${smallMoney(message.cost)}`
                          : ''}
                      </span>
                      {message.role === 'assistant' && (
                        <button
                          onClick={() => void copy(message)}
                          aria-label="Copiar resposta"
                        >
                          {copied === message.id ? (
                            <Check size={16} />
                          ) : (
                            <Copy size={16} />
                          )}
                          {copied === message.id ? 'Copiado' : 'Copiar'}
                        </button>
                      )}
                    </footer>
                    {prefs.showSources && message.toolsUsed.length > 0 && (
                      <div className="ai-sources">
                        Consultou:{' '}
                        {[
                          ...new Set(
                            message.toolsUsed.map(
                              (tool) => toolLabels[tool] ?? tool,
                            ),
                          ),
                        ].join(' · ')}
                      </div>
                    )}
                    {message.role === 'assistant' &&
                      index === messages.length - 1 &&
                      !asking &&
                      (message.suggestions?.length ?? 0) > 0 && (
                        <div className="ai-followups" aria-label="Sugestões de próximas perguntas">
                          {message.suggestions!.map((text) => (
                            <button
                              key={text}
                              type="button"
                              disabled={!status?.available || opening}
                              onClick={() => void send(text)}
                            >
                              {text}
                              <ArrowUpRight size={15} />
                            </button>
                          ))}
                        </div>
                      )}
                  </article>
                ))}
                {asking && (
                  <p className="ai-thinking" role="status">
                    <Loader2 className="animate-spin" size={19} /> Consultando
                    os dados da operação…
                  </p>
                )}
              </div>
              <form
                className="ai-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <div>
                  <textarea
                    ref={input}
                    aria-label="Sua pergunta"
                    placeholder={
                      status?.available
                        ? 'Pergunte sobre sua operação…'
                        : 'Aguardando disponibilidade do assistente…'
                    }
                    value={question}
                    rows={2}
                    maxLength={2000}
                    disabled={!status?.available || asking || opening}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        prefs.enterToSend &&
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="ai-primary"
                    aria-label="Enviar pergunta"
                    disabled={
                      !status?.available ||
                      asking ||
                      opening ||
                      !question.trim()
                    }
                  >
                    {asking ? (
                      <Loader2 size={22} className="animate-spin" />
                    ) : (
                      <ArrowUp size={22} />
                    )}
                  </button>
                </div>
                <p>
                  <span>
                    {status && status.budget > 0
                      ? `${money(status.spent)} de ${money(status.budget)} usados neste mês`
                      : 'Sem limite mensal de gastos'}
                  </span>
                  <span>{question.length}/2000</span>
                </p>
                <small>
                  O assistente consulta dados, sem alterá-los. Confira
                  informações importantes no sistema.
                </small>
              </form>
            </>
          )}
          {tab === 'history' && (
            <div className="ai-tab-content">
              <label className="ai-search">
                <Search size={19} />
                <input
                  aria-label="Buscar conversa"
                  placeholder="Buscar no histórico…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              {opening && <p role="status">Abrindo conversa…</p>}
              <div className="ai-history">
                {status?.conversations
                  .filter((item) =>
                    item.title
                      .toLocaleLowerCase()
                      .includes(search.toLocaleLowerCase()),
                  )
                  .map((item) => (
                    <div key={item.id}>
                      <button
                        disabled={asking || opening}
                        onClick={() => void open(item.id)}
                      >
                        <MessageCircle size={21} />
                        <span>
                          <strong>{item.title}</strong>
                          <small>
                            {time(item.updatedAt)} · {item.messages} mensagens
                          </small>
                        </span>
                        <ArrowUpRight size={18} />
                      </button>
                      <button
                        aria-label={`Arquivar ${item.title}`}
                        title="Arquivar conversa"
                        disabled={asking || opening}
                        onClick={() => void archive(item.id)}
                      >
                        <Archive size={18} />
                      </button>
                    </div>
                  ))}
              </div>
              {status &&
                !status.conversations.some((item) =>
                  item.title
                    .toLocaleLowerCase()
                    .includes(search.toLocaleLowerCase()),
                ) && (
                  <p className="ai-empty">
                    {search
                      ? 'Nenhuma conversa encontrada.'
                      : 'Suas conversas salvas vão aparecer aqui.'}
                  </p>
                )}
            </div>
          )}
          {tab === 'usage' && (
            <div className="ai-tab-content ai-consumption">
              {status ? (() => {
                const uses = usage?.uses ?? 0;
                const spent = status.spent;
                const budgetPercent = status.budget > 0 ? Math.min(100, Math.round((spent / status.budget) * 100)) : 0;
                const months = Array.from({ length: 6 }, (_, index) => {
                  const [year, month] = currentMonth.split('-').map(Number);
                  const key = new Date(Date.UTC(year, month - 6 + index, 1)).toISOString().slice(0, 7);
                  const item = status.usage.find((row) => row.month === key);
                  return { key, cost: item?.cost ?? 0, uses: item?.uses ?? 0 };
                });
                const maxMonth = Math.max(0.01, ...months.map((item) => item.cost));
                return (
                  <>
                    <div className="ai-credit-cards">
                      <div className="is-balance">
                        <span>Gasto neste mês</span>
                        <strong>{money(spent)}</strong>
                        <small>
                          {status.budget > 0
                            ? `Restam ${money(Math.max(0, status.budget - spent))} do limite`
                            : 'Sem limite mensal'}
                        </small>
                      </div>
                      <div>
                        <span>Perguntas respondidas</span>
                        <strong>{number(uses)}</strong>
                        <small>Em {monthName(currentMonth)}</small>
                      </div>
                      <div>
                        <span>Limite mensal</span>
                        <strong>{status.budget > 0 ? money(status.budget) : 'Sem limite'}</strong>
                        <small>Ajustável em Configurações</small>
                      </div>
                      <div>
                        <span>Custo médio</span>
                        <strong>{uses ? smallMoney(spent / uses) : '—'}</strong>
                        <small>Por resposta neste mês</small>
                      </div>
                    </div>

                    {status.budget > 0 && (
                      <section className="ai-consumption-section">
                        <div className="ai-section-heading">
                          <h3>Limite de {monthName(currentMonth)}</h3>
                          <span>
                            {money(spent)} de {money(status.budget)} · {budgetPercent}%
                          </span>
                        </div>
                        <div
                          className={`ai-quota ${budgetPercent >= 90 ? 'is-high' : ''}`}
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={budgetPercent}
                          aria-label="Uso do limite mensal"
                        >
                          <i style={{ width: `${budgetPercent}%` }} />
                        </div>
                        <p className="ai-muted">
                          Ao chegar no limite, o assistente para de responder até o mês seguinte (ou até o limite ser aumentado).
                        </p>
                      </section>
                    )}

                    <section className="ai-consumption-section">
                      <div className="ai-section-heading">
                        <h3>Últimos 6 meses</h3>
                        <span>Gasto e perguntas respondidas</span>
                      </div>
                      <div className="ai-month-chart">
                        {months.map((item) => (
                          <div key={item.key} className={item.key === currentMonth ? 'is-current' : ''}>
                            <b>{money(item.cost)}</b>
                            <div>
                              <i style={{ height: `${Math.max(item.cost ? 6 : 0, (item.cost / maxMonth) * 100)}%` }} />
                            </div>
                            <span>{monthName(item.key)}</span>
                            <small>
                              {number(item.uses)} pergunta{item.uses === 1 ? '' : 's'}
                            </small>
                          </div>
                        ))}
                      </div>
                      <p className="ai-muted">
                        Valores estimados com os preços por milhão de tokens das Configurações. A cobrança real é a do painel da DeepSeek.
                      </p>
                    </section>
                  </>
                );
              })() : <p role="status">Carregando consumo…</p>}
            </div>
          )}
          {tab === 'settings' && (
            <div className="ai-tab-content">
              <h3>Preferências de conversa</h3>
              <p className="ai-muted">
                Estas opções ficam salvas apenas neste navegador.
              </p>
              {(
                [
                  {
                    key: 'enterToSend',
                    title: 'Enviar com Enter',
                    description:
                      'Use Shift + Enter para quebrar a linha. Desativado, envie pelo botão.',
                  },
                  {
                    key: 'showSources',
                    title: 'Mostrar dados consultados',
                    description:
                      'Veja quais áreas da empresa foram consultadas em cada resposta.',
                  },
                  {
                    key: 'largeText',
                    title: 'Texto ampliado',
                    description:
                      'Aumente o tamanho das mensagens para uma leitura mais confortável.',
                  },
                ] as const
              ).map((item) => (
                <label key={item.key} className="ai-preference">
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs[item.key]}
                    onChange={(event) =>
                      preference(item.key, event.target.checked)
                    }
                  />
                </label>
              ))}
              {notice && (
                <p role="status" className="ai-notice">
                  {notice}
                </p>
              )}
              <div className="ai-settings-links">
                <Link href="/admin/configuracoes">
                  <SlidersHorizontal size={20} /> Limite mensal e preços do assistente{' '}
                  <ArrowUpRight size={18} />
                </Link>
                <button onClick={() => setTab('history')}>
                  <History size={20} /> Consultar histórico de conversas{' '}
                  <ArrowUpRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
