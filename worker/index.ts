import cron from 'node-cron';
import { runHoursJob } from '../lib/porto-jobs/run-hours-job';
import { runScheduleJob } from '../lib/porto-jobs/run-schedule-job';
import { startWorkerServer } from './server';

function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

async function runHours() {
  log('Iniciando job de apontamento de horas...');
  try {
    const result = await runHoursJob({ manual: false });
    log('Resultado (horas):', JSON.stringify(result));
  } catch (error) {
    log('Job de horas falhou:', error);
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

// `docker exec <container> npx tsx worker/index.ts --run=hours` (or --run=schedule) runs a
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
  // Same schedule as the original vercel.json crons (kept in UTC for consistency): hours at
  // 23:00 UTC (20:00 BRT), schedule at 06:00 UTC (03:00 BRT). No maxDuration here — each run
  // goes to full completion instead of needing the Vercel route's time-budget cutoff.
  cron.schedule('0 23 * * *', runHours, { timezone: 'UTC' });
  cron.schedule('0 6 * * *', runSchedule, { timezone: 'UTC' });
  log('Porto worker iniciado. Horas: 23:00 UTC diariamente. Escala: 06:00 UTC diariamente.');

  // Everything the admin UI triggers on demand (test-login, técnico match, manual job runs) is
  // now served from here too — the Vercel routes are thin proxies (see server.ts).
  startWorkerServer();
}
