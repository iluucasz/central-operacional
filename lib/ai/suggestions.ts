import { sql } from '../db';
import { PORTO_WARNING_MARKER } from '../organization-settings';
import { ensurePortoConfigSchema } from '../porto-config-schema';

/** Starter questions are rebuilt at most this often (they cost a few small queries). */
const CACHE_MS = 5 * 60_000;
const MIN_SUGGESTIONS = 4;
const MAX_SUGGESTIONS = 6;

let cached: { at: number; urgent: string[]; pool: string[] } | null = null;

function brasiliaDateParts(offsetMonths = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const date = new Date(Date.UTC(year, month - 1 + offsetMonths, 1));
  const key = date.toISOString().slice(0, 7);
  const name = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(date);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return { key, name, from: `${key}-01`, to: `${key}-${String(last).padStart(2, '0')}` };
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/**
 * Starter questions built from the current state of the data: what needs attention comes first
 * (laudo warnings this month, payrolls still in draft, a Porto run that failed), the rest is drawn
 * from questions that make sense for the month. Never fewer than four.
 */
export async function getStarterSuggestions(): Promise<string[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return pick(cached.urgent, cached.pool);

  const current = brasiliaDateParts();
  const previous = brasiliaDateParts(-1);
  const urgent: string[] = [];
  const pool: string[] = [
    `Qual técnico mais produziu em ${current.name}?`,
    `Quem está abaixo da jornada de horas em ${current.name}?`,
    'Quem está escalado para amanhã?',
    `Como está a produção da quinzena atual comparada com ${previous.name}?`,
    `Qual o valor médio por OS em ${current.name}?`,
    'Algum técnico está sem horas apontadas nos últimos dias?',
  ];

  try {
    await ensurePortoConfigSchema();
    const [warnings, drafts, lastRun, pendingBills, currentServices] = await Promise.all([
      sql`
        SELECT COUNT(*)::int AS total FROM schedule
        WHERE date BETWEEN ${current.from}::date AND ${current.to}::date AND notes LIKE ${`%${PORTO_WARNING_MARKER}%`}
      `,
      sql`SELECT COUNT(*)::int AS total FROM payroll WHERE competence_month = ${previous.key} AND COALESCE(status, 'draft') <> 'closed'`,
      sql`SELECT status, error_message FROM porto_sync_log WHERE job_type = 'hours' AND status <> 'running' ORDER BY started_at DESC LIMIT 1`,
      sql`
        SELECT COUNT(*)::int AS total FROM financial_entries
        WHERE status <> 'paid' AND due_date BETWEEN ${current.from}::date AND ${current.to}::date
      `.catch(() => [{ total: 0 }]),
      sql`SELECT COUNT(*)::int AS total FROM services WHERE competence_month = ${current.key}`,
    ]);

    if (Number(warnings[0]?.total) > 0) urgent.push(`Quem recebeu advertência de laudo em ${current.name}?`);
    else pool.push(`Algum técnico recebeu advertência de laudo em ${current.name}?`);

    if (Number(drafts[0]?.total) > 0) urgent.push(`Quais folhas de ${previous.name} ainda estão em rascunho?`);
    else pool.push(`Qual foi o líquido total da folha de ${previous.name}?`);

    const run = lastRun[0];
    if (run && (run.status === 'error' || String(run.error_message ?? '').startsWith('Atenção'))) {
      urgent.push('O que deu errado na última execução do robô do Porto?');
    } else {
      pool.push('O robô do Porto importou as horas de ontem?');
    }

    if (Number(pendingBills[0]?.total) > 0) pool.push(`Quais contas de ${current.name} ainda estão pendentes?`);

    // Early in the month there's little production yet: ask about the previous one instead.
    if (Number(currentServices[0]?.total) === 0) {
      pool[0] = `Qual técnico mais produziu em ${previous.name}?`;
    }
  } catch (error) {
    console.error('[assistant] suggestions error:', error);
  }

  cached = { at: Date.now(), urgent, pool };
  return pick(urgent, pool);
}

/** What needs attention first, then a different mix of the rest on every call. */
function pick(urgent: string[], pool: string[]) {
  const all = [...urgent, ...shuffle(pool)];
  return all.slice(0, Math.max(MIN_SUGGESTIONS, Math.min(MAX_SUGGESTIONS, all.length)));
}
