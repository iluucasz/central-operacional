import { decryptPortoPassword } from '../porto-crypto';
import { launchAuthenticatedPortoSession } from '../porto-integration/browser';
import { getEscalaForCurrentMonth } from '../porto-integration/escala';
import { PortoLoginError } from '../porto-integration/login';
import { listSocorristas } from '../porto-integration/socorristas';
import { resolveTechnicianByQra } from '../porto-integration/technician-match';
import { finishSyncLog, getPortoConfig, recordScheduleCheck, recordScheduleImportResult, startSyncLog } from '../porto-sync-log';
import { replacePortoScheduleRows, PORTO_SCHEDULE_NOTE_PREFIX } from '../schedule-write-service';
import type { ScheduleSeedRow } from '../schedule-planner';

const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type ScheduleJobOptions = {
  /** Manual test runs (admin UI button) always run the full preview, never write real data. */
  manual: boolean;
};

export type ScheduleJobResult = {
  status: 'skipped' | 'dry_run' | 'success' | 'partial' | 'error';
  technicians_processed: number;
  rows_written?: number;
  would_write?: number;
  action?: 'check_only';
  error?: string;
  details: Array<Record<string, unknown>>;
};

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthDateRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    year,
    month,
    startDate: `${year}-${pad(month)}-01`,
    endDate: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

/**
 * Extracted from app/api/cron/porto-schedule/route.ts so both the Vercel route and the VPS worker
 * share one implementation. Unlike the hours job, this one has no time-budget concern in
 * practice — one escala fetch per technician, not per-service — so no timeBudgetMs parameter.
 */
export async function runScheduleJob(options: ScheduleJobOptions): Promise<ScheduleJobResult> {
  const config = await getPortoConfig();
  const missingCredentials = !config || !config.encrypted_password || !config.cpf;
  if (missingCredentials || (!options.manual && !config.automation_enabled)) {
    const logId = await startSyncLog('schedule');
    const errorMessage = missingCredentials ? 'Credenciais não configuradas.' : 'Automação desligada.';
    await finishSyncLog(logId, { status: 'skipped', error_message: errorMessage });
    return { status: 'skipped', technicians_processed: 0, error: errorMessage, details: [] };
  }

  const currentMonthKey = getCurrentMonthKey();
  // Manual test clicks always run the full preview — an admin clicking "testar" wants to see what
  // would actually be imported, not the lightweight "already done this month" shortcut.
  const alreadyImportedThisMonth =
    !options.manual && config.last_schedule_import_month === currentMonthKey && config.last_schedule_import_status === 'success';

  if (alreadyImportedThisMonth) {
    const lastCheck = config.last_schedule_check_at ? new Date(config.last_schedule_check_at as string).getTime() : 0;
    if (Date.now() - lastCheck < RECHECK_INTERVAL_MS) {
      const logId = await startSyncLog('schedule');
      await finishSyncLog(logId, { status: 'skipped', error_message: 'Mês já importado e checado recentemente.' });
      return { status: 'skipped', technicians_processed: 0, details: [] };
    }
  }

  const logId = await startSyncLog('schedule');
  const details: Array<Record<string, unknown>> = [];
  let techniciansProcessed = 0;
  let rowsWritten = 0;

  try {
    const password = decryptPortoPassword(config.encrypted_password as string);
    const { browser, page } = await launchAuthenticatedPortoSession({ cpf: config.cpf as string, password });

    try {
      if (alreadyImportedThisMonth) {
        // Lightweight path: just confirm the portal still responds and the escala for a reference
        // technician still resolves, without a full multi-technician scrape.
        const socorristas = await listSocorristas(page);
        techniciansProcessed = socorristas.length;
        if (socorristas.length) {
          await getEscalaForCurrentMonth(page, socorristas[0].qra);
        }

        await recordScheduleCheck();
        await finishSyncLog(logId, { status: 'success', technicians_processed: techniciansProcessed, rows_written: 0, details: [{ action: 'check_only' }] });
        return { status: 'success', technicians_processed: techniciansProcessed, action: 'check_only', details: [] };
      }

      // Full import path.
      const socorristas = await listSocorristas(page);
      const { year, month, startDate, endDate } = getMonthDateRange();
      const rows: ScheduleSeedRow[] = [];
      const resolvedTechnicianIds: string[] = [];

      for (const socorrista of socorristas) {
        techniciansProcessed++;
        const technician = await resolveTechnicianByQra(socorrista.qra);
        if (!technician) {
          details.push({ qra: socorrista.qra, action: 'skipped_no_match' });
          continue;
        }

        let escalaDays;
        try {
          escalaDays = await getEscalaForCurrentMonth(page, socorrista.qra);
        } catch (escalaError) {
          // A navigation hiccup for one technician shouldn't abort the whole month's import —
          // log it and move on; the shortfall is visible via technicians_processed vs. days count.
          details.push({ qra: socorrista.qra, technician_id: technician.id, action: 'escala_fetch_failed', error: escalaError instanceof Error ? escalaError.message : String(escalaError) });
          continue;
        }

        resolvedTechnicianIds.push(technician.id);

        for (const day of escalaDays) {
          const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
          const reason = day.unavailable ? day.reason || 'indisponibilidade' : 'escala normal';

          // schedule.start_time/end_time expect a valid time literal even on non-working days —
          // mirrors the fallback convention already used by buildPersistedSchedule in schedule-planner.ts.
          rows.push({
            technician_id: technician.id,
            date: dateKey,
            start_time: day.startTime ?? '00:00',
            end_time: day.endTime ?? '00:00',
            status: day.unavailable ? 'cancelled' : 'scheduled',
            notes: `${PORTO_SCHEDULE_NOTE_PREFIX} ${reason}`,
          });
        }

        details.push({ qra: socorrista.qra, technician_id: technician.id, action: 'imported', days: escalaDays.length });
      }

      const dryRun = options.manual || config.dry_run_only !== false;

      if (dryRun) {
        // Modo teste: calcula o que seria importado mas não grava, e não marca o mês como
        // importado — senão, ao desligar o modo teste, o import real seria pulado por engano.
        rowsWritten = rows.length;
        details.unshift({ dry_run: true, manual: options.manual, would_write: rows.length });
        await finishSyncLog(logId, {
          status: 'dry_run',
          technicians_processed: techniciansProcessed,
          rows_written: rowsWritten,
          details,
        });
        return { status: 'dry_run', technicians_processed: techniciansProcessed, would_write: rowsWritten, details };
      }

      if (resolvedTechnicianIds.length && rows.length) {
        const { inserted } = await replacePortoScheduleRows({
          technicianIds: resolvedTechnicianIds,
          startDate,
          endDate,
          rows,
        });
        rowsWritten = inserted.length;
      }

      const overallStatus = resolvedTechnicianIds.length ? 'success' : 'partial';
      await recordScheduleImportResult({ monthKey: currentMonthKey, status: overallStatus });
      await finishSyncLog(logId, {
        status: overallStatus,
        technicians_processed: techniciansProcessed,
        rows_written: rowsWritten,
        details,
      });

      return { status: overallStatus, technicians_processed: techniciansProcessed, rows_written: rowsWritten, details };
    } finally {
      await browser.close();
    }
  } catch (error) {
    const message = error instanceof PortoLoginError ? error.message : 'Erro inesperado ao importar escala do Porto.';
    console.error('[porto-jobs/schedule] error:', error);
    if (!options.manual) {
      await recordScheduleImportResult({ monthKey: currentMonthKey, status: 'error', error: message });
    }
    await finishSyncLog(logId, { status: 'error', technicians_processed: techniciansProcessed, rows_written: rowsWritten, details, error_message: message });
    return { status: 'error', technicians_processed: techniciansProcessed, rows_written: rowsWritten, error: message, details };
  }
}
