import cron from 'node-cron';
import { runHoursJob } from '../lib/porto-jobs/run-hours-job';
import { runScheduleJob } from '../lib/porto-jobs/run-schedule-job';
import { runDueNotifications } from '../lib/whatsapp/notifications';
import { startWorkerServer } from './server';

function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// Without the Evolution API credentials every scheduled notification would still claim its
// day/month and then fail to send, so WhatsApp only runs here once the container has them.
const whatsappConfigured = Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE);

async function runHours() {
  log('Iniciando job de apontamento de horas...');
  try {
    const result = await runHoursJob({ manual: false });
    log('Resultado (horas):', JSON.stringify(result));
  } catch (error) {
    log('Job de horas falhou:', error);
    return;
  }

  // The end-of-shift WhatsApp goes out as soon as today's hours are in, rather than waiting for
  // its configured time — that time stays as the fallback (and it only ever sends once a day).
  if (whatsappConfigured) await runWhatsApp({ only: 'daily_hours', ignoreTime: true });
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
    const result = await runScheduleJob({ manual: false });
    log('Resultado (escala):', JSON.stringify(result));
  } catch (error) {
    log('Job de escala falhou:', error);
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
  // Expressed directly in Brasília time (America/Sao_Paulo) rather than a fixed UTC offset — a
  // real IANA timezone handles any future DST policy change correctly, a hardcoded UTC hour
  // wouldn't. Hours moved to fire at 23:00 BRT exactly (was 23:00 UTC = 20:00 BRT); schedule stays
  // at the same real-world moment as before (03:00 BRT = 06:00 UTC), just expressed natively
  // instead of converted. No maxDuration here — each run goes to full completion instead of
  // needing the Vercel route's time-budget cutoff.
  cron.schedule('0 23 * * *', runHours, { timezone: 'America/Sao_Paulo' });
  cron.schedule('0 3 * * *', runSchedule, { timezone: 'America/Sao_Paulo' });
  // WhatsApp notification times are edited in the admin UI, so rather than one cron entry per
  // notification (which would need a worker restart on every change) this just checks every few
  // minutes what is due. Each notification claims its day/month before running, so it's once only.
  if (whatsappConfigured) {
    cron.schedule('*/5 * * * *', () => runWhatsApp(), { timezone: 'America/Sao_Paulo' });
  }
  log(
    `Porto worker iniciado. Horas: 23:00 (Brasília) diariamente. Escala: 03:00 (Brasília) diariamente. WhatsApp: ${
      whatsappConfigured ? 'verificação a cada 5 min.' : 'desligado (EVOLUTION_API_URL/KEY/INSTANCE não configurados no container).'
    }`,
  );

  // Everything the admin UI triggers on demand (test-login, técnico match, manual job runs) is
  // now served from here too — the Vercel routes are thin proxies (see server.ts).
  startWorkerServer();
}
