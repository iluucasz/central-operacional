import cron from 'node-cron';
import { runHoursJob } from '../lib/porto-jobs/run-hours-job';
import { runScheduleJob } from '../lib/porto-jobs/run-schedule-job';
import { runDueNotifications } from '../lib/whatsapp/notifications';
import { sql } from '../lib/db';
import { getOrganizationSettings } from '../lib/organization-settings-store';
import { sendPortoAlert } from '../lib/porto-alerts';
import { ensurePortoConfigSchema } from '../lib/porto-config-schema';
import { brasiliaNow } from '../lib/whatsapp/dates';
import { isJobDue } from './job-schedule';
import { portoLockInfo, waitForPortoLock } from './porto-lock';
import { startWorkerServer } from './server';

function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// Without the Evolution API credentials every scheduled notification would still claim its
// day/month and then fail to send, so WhatsApp only runs here once the container has them.
const whatsappConfigured = Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE);

async function runHours() {
  log('Iniciando job de apontamento de horas...');
  // The day this run imports — the end-of-shift message below is about it even when the run
  // (waiting on the lock, or a long catch-up) finishes after midnight.
  const runDay = new Date();
  try {
    const result = await waitForPortoLock('apontamento de horas (automático)', () => runHoursJob({ manual: false }));
    log('Resultado (horas):', JSON.stringify(result));
    await alertOnProblems('importação de horas', result);
    if (result.status !== 'success' && result.status !== 'partial') return;
  } catch (error) {
    log('Job de horas falhou:', error);
    await sendPortoAlert('a importação de horas falhou', [error instanceof Error ? error.message : String(error)]);
    return;
  }

  // The end-of-shift WhatsApp goes out as soon as the day's hours are in, rather than waiting for
  // its configured time — that time stays as the fallback (and it only ever sends once a day).
  if (whatsappConfigured) await runWhatsApp({ only: 'daily_hours', ignoreTime: true, now: runDay });
}

async function runWhatsApp(options: Parameters<typeof runDueNotifications>[0] = {}) {
  try {
    const summaries = await runDueNotifications(options);
    if (summaries.length) log('WhatsApp:', JSON.stringify(summaries));
  } catch (error) {
    log('Notificações WhatsApp falharam:', error);
  }
}

async function runSchedule() {
  log('Iniciando job de escala...');
  try {
    const result = await waitForPortoLock('escala (automática)', () => runScheduleJob({ manual: false }));
    log('Resultado (escala):', JSON.stringify(result));
    await alertOnProblems('importação da escala', result);
  } catch (error) {
    log('Job de escala falhou:', error);
    await sendPortoAlert('a importação da escala falhou', [error instanceof Error ? error.message : String(error)]);
  }
}

/** WhatsApp to the admin (Configurações) when an automatic run failed or finished with warnings. */
async function alertOnProblems(jobLabel: string, result: { status: string; error?: string; warnings?: string[] }) {
  let alert: { sent: boolean; reason?: string } | null = null;
  if (result.status === 'error') {
    alert = await sendPortoAlert(`a ${jobLabel} falhou`, [result.error ?? 'Erro sem detalhe.']);
  } else if (result.warnings?.length) {
    alert = await sendPortoAlert(`a ${jobLabel} terminou com avisos`, result.warnings);
  }
  if (alert && !alert.sent) log(`Alerta da ${jobLabel} não enviado:`, alert.reason);
}

type ScheduledJob = 'hours' | 'schedule';
const lastRunDay: Record<ScheduledJob, string | null> = { hours: null, schedule: null };
let lastRunDayLoaded = false;

/**
 * On (re)start, treat a job as done today when the sync log already has a run of it started today
 * at/after its configured time — so a restart right after 23:00 doesn't run the import twice.
 */
async function loadLastRunDays() {
  await ensurePortoConfigSchema();
  const settings = await getOrganizationSettings();
  const today = brasiliaNow().dateKey;
  const rows = await sql`
    SELECT job_type, MAX(to_char(started_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')) AS last_time
    FROM porto_sync_log
    WHERE (started_at AT TIME ZONE 'America/Sao_Paulo')::date = ${today}::date
      -- A manual test/"Rodar agora" run doesn't replace the scheduled one.
      AND COALESCE(run_trigger, 'auto') = 'auto'
    GROUP BY job_type
  `;
  for (const row of rows) {
    const job = row.job_type as ScheduledJob;
    const configured = job === 'hours' ? settings.portoHoursImportTime : settings.portoScheduleImportTime;
    if ((job === 'hours' || job === 'schedule') && String(row.last_time) >= configured) lastRunDay[job] = today;
  }
  lastRunDayLoaded = true;
}

/** A run holding the Porto lock this long is considered stuck (a normal night takes minutes). */
const STUCK_RUN_ALERT_MS = 2 * 60 * 60 * 1000;
let stuckAlertSentFor: string | null = null;

/** Every later run waits on the lock, so a hung one would silently block the automation for good. */
async function checkStuckRun() {
  const held = portoLockInfo();
  if (!held || held.heldForMs < STUCK_RUN_ALERT_MS) return;
  const key = `${held.name}@${Math.floor((Date.now() - held.heldForMs) / 60000)}`;
  if (stuckAlertSentFor === key) return;
  stuckAlertSentFor = key;
  const minutes = Math.round(held.heldForMs / 60000);
  log(`Execução travada? "${held.name}" rodando há ${minutes} min.`);
  await sendPortoAlert('uma execução parece travada', [
    `"${held.name}" está rodando há ${minutes} minutos e bloqueia as próximas.`,
    'Reinicie o worker na VPS (docker restart porto-worker) se continuar assim.',
  ]);
}

async function runDueJobs() {
  try {
    await checkStuckRun();
    if (!lastRunDayLoaded) await loadLastRunDays();
    const settings = await getOrganizationSettings();
    const now = brasiliaNow();
    const jobs: Array<[ScheduledJob, string, () => Promise<void>]> = [
      ['hours', settings.portoHoursImportTime, runHours],
      ['schedule', settings.portoScheduleImportTime, runSchedule],
    ];
    for (const [job, time, run] of jobs) {
      if (!isJobDue({ scheduledTime: time, nowMinutes: now.minutes, today: now.dateKey, lastRunDay: lastRunDay[job] })) continue;
      // Claimed before starting, so the next tick never starts it again while it runs.
      lastRunDay[job] = now.dateKey;
      void run();
    }
  } catch (error) {
    log('Agendador: falha ao verificar os horários:', error);
  }
}

// `docker exec <container> node dist/worker/index.js --run=hours` (or --run=schedule) runs a
// one-off job and exits, reusing the same image/Chromium install — for on-demand verification
// without disturbing the main scheduler daemon (`cron.schedule` below keeps a process alive
// forever, so mixing the two in one invocation would leave the one-off `docker exec` hanging).
const runArg = process.argv.find((arg) => arg.startsWith('--run='))?.split('=')[1];

if (runArg) {
  const job = runArg === 'hours' ? runHours : runArg === 'schedule' ? runSchedule : null;
  if (!job) {
    console.error(`--run inválido: "${runArg}" (use "hours" ou "schedule")`);
    process.exit(1);
  }
  job().then(() => process.exit(0));
} else {
  // The run times are edited in Configurações (portoHoursImportTime / portoScheduleImportTime, in
  // Brasília time), so instead of fixed cron expressions — which would need a restart on every
  // change — a once-a-minute tick checks them. No maxDuration here: each run goes to completion.
  cron.schedule('* * * * *', () => void runDueJobs(), { timezone: 'America/Sao_Paulo' });
  // WhatsApp notification times are edited in the admin UI, so rather than one cron entry per
  // notification (which would need a worker restart on every change) this just checks every few
  // minutes what is due. Each notification claims its day/month before running, so it's once only.
  if (whatsappConfigured) {
    cron.schedule('*/5 * * * *', () => runWhatsApp(), { timezone: 'America/Sao_Paulo' });
  }
  void getOrganizationSettings()
    .then((settings) =>
      log(
        `Porto worker iniciado. Horas: ${settings.portoHoursImportTime} e escala: ${settings.portoScheduleImportTime} (Brasília, de Configurações). WhatsApp: ${
          whatsappConfigured ? 'verificação a cada 5 min.' : 'desligado (EVOLUTION_API_URL/KEY/INSTANCE não configurados no container).'
        }`,
      ),
    )
    .catch((error) => log('Não foi possível ler as Configurações na partida:', error));

  // Everything the admin UI triggers on demand (test-login, técnico match, manual job runs) is
  // now served from here too — the Vercel routes are thin proxies (see server.ts).
  startWorkerServer();
}
