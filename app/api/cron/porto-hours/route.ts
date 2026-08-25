import { NextRequest, NextResponse } from 'next/server';
import { resolveCronCaller } from '@/lib/cron-auth';
import { decryptPortoPassword } from '@/lib/porto-crypto';
import { getEscalaForCurrentMonth } from '@/lib/porto-integration/escala';
import { launchPortoBrowser } from '@/lib/porto-integration/browser';
import { loginToPorto, PortoLoginError } from '@/lib/porto-integration/login';
import { listSocorristas } from '@/lib/porto-integration/socorristas';
import { getServicoDetail, searchServicosByDate } from '@/lib/porto-integration/servicos';
import { resolveTechnicianByQra } from '@/lib/porto-integration/technician-match';
import { finishSyncLog, getPortoConfig, recordHoursImportResult, startSyncLog } from '@/lib/porto-sync-log';
import { applyWorkHourEntries, getIsoWeekNumber, type WorkHourEntry } from '@/lib/work-hours-service';

export const runtime = 'nodejs';
export const maxDuration = 280;

const MAX_PLAUSIBLE_SHIFT_HOURS = 16;

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function toBrDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

/** Handles shifts that cross midnight (e.g. 22:00 -> 02:00) by wrapping the end time forward a day. */
function diffHours(startTime: string, endTime: string) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  return Number((minutes / 60).toFixed(2));
}

/**
 * V1 heuristic, reviewed and accepted by the product owner (2026-08-20):
 *
 * Porto's search-by-date flow (see lib/porto-integration/servicos.ts) does not filter by
 * technician, only by date, and returns technician names as free text — matching a row to a
 * specific technician here is done by name-prefix comparison, not an exact/stable identifier.
 * Accepted trade-off: fine for this team's size, but can misattribute services if two
 * technicians share a name prefix.
 *
 * There is also no validated way to read a technician's actual clock-in time from Porto — only
 * the completion ("Concluído") timestamp of each service was confirmed live. This job uses the
 * technician's planned escala start time for the day (lib/porto-integration/escala.ts, validated
 * live) as a stand-in for the real start time, and the latest same-day service completion
 * timestamp as the end time. Accepted: an approximate start time is fine for this use case.
 *
 * Still recommended: review a few days of output in porto_sync_log with dry-run mode on before
 * disabling it, since this feeds payroll-affecting data.
 */
export async function GET(request: NextRequest) {
  const caller = await resolveCronCaller(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await getPortoConfig();
  const missingCredentials = !config || !config.encrypted_password || !config.cpf;
  // Manual test clicks (admin session, not CRON_SECRET) work even with automation off — that's
  // the whole point of letting an admin try it before committing to turning the real thing on.
  if (missingCredentials || (!caller.manual && !config.automation_enabled)) {
    const logId = await startSyncLog('hours');
    const errorMessage = missingCredentials ? 'Credenciais não configuradas.' : 'Automação desligada.';
    await finishSyncLog(logId, { status: 'skipped', error_message: errorMessage });
    return NextResponse.json({ status: 'skipped', error: errorMessage });
  }

  const logId = await startSyncLog('hours');
  const details: Array<Record<string, unknown>> = [];
  let techniciansProcessed = 0;
  let importedCount = 0;
  let rowsWritten = 0;
  // Manual test runs never write real data, regardless of the dry_run_only toggle.
  const dryRun = caller.manual || config.dry_run_only !== false;

  try {
    const password = decryptPortoPassword(config.encrypted_password as string);
    const { browser, context } = await launchPortoBrowser();

    try {
      const page = await context.newPage();
      await loginToPorto(page, { cpf: config.cpf as string, password });

      const dateKey = getTodayKey();
      const brDate = toBrDate(dateKey);
      const socorristas = await listSocorristas(page);
      const services = await searchServicosByDate(page, dateKey);

      for (const socorrista of socorristas) {
        techniciansProcessed++;
        const technician = await resolveTechnicianByQra(socorrista.qra);
        if (!technician) {
          details.push({ qra: socorrista.qra, action: 'skipped_no_match' });
          continue;
        }

        const namePrefix = technician.name.trim().toUpperCase().slice(0, 8);
        const technicianServices = services.filter((service) => service.technicianNameFragment.toUpperCase().startsWith(namePrefix));

        if (!technicianServices.length) {
          details.push({ qra: socorrista.qra, technician_id: technician.id, action: 'no_services' });
          continue;
        }

        // Only consider timestamps that actually fall on the date being processed — a service's
        // detail page can list timestamps from other stages/days, and comparing bare "HH:MM"
        // strings across different calendar days would otherwise pick the wrong "latest" time.
        let latestCompletion: string | null = null;
        for (const service of technicianServices) {
          const detail = await getServicoDetail(page, dateKey, { anoServico: service.anoServico, numeroServico: service.numeroServico });
          for (const timestamp of detail.timestamps) {
            if (!timestamp.startsWith(brDate)) continue;
            const timeOnly = timestamp.split(' ')[1];
            if (timeOnly && (!latestCompletion || timeOnly > latestCompletion)) {
              latestCompletion = timeOnly;
            }
          }
        }

        if (!latestCompletion) {
          details.push({ qra: socorrista.qra, technician_id: technician.id, action: 'no_completion_time' });
          continue;
        }

        let plannedStart = '08:00';
        try {
          const escalaDays = await getEscalaForCurrentMonth(page, socorrista.qra);
          const todayDay = Number(dateKey.slice(8, 10));
          plannedStart = escalaDays.find((day) => day.day === todayDay)?.startTime ?? '08:00';
        } catch (escalaError) {
          details.push({ qra: socorrista.qra, technician_id: technician.id, action: 'escala_fetch_failed_fallback_0800', error: escalaError instanceof Error ? escalaError.message : String(escalaError) });
        }

        const hoursWorked = diffHours(plannedStart, latestCompletion);
        if (hoursWorked <= 0 || hoursWorked > MAX_PLAUSIBLE_SHIFT_HOURS) {
          details.push({ qra: socorrista.qra, technician_id: technician.id, action: 'invalid_hours', plannedStart, latestCompletion, hoursWorked });
          continue;
        }

        const entry: WorkHourEntry = {
          technician_id: technician.id,
          date: dateKey,
          start_time: plannedStart,
          end_time: latestCompletion,
          planned_start_time: plannedStart,
          planned_end_time: latestCompletion,
          hours_worked: hoursWorked,
          week_number: getIsoWeekNumber(dateKey),
          month: Number(dateKey.slice(5, 7)),
          year: Number(dateKey.slice(0, 4)),
          attendance_status: 'worked',
          notes: 'Importado automaticamente do Porto Seguro.',
        };

        importedCount++;

        if (dryRun) {
          details.push({ qra: socorrista.qra, technician_id: technician.id, action: 'would_import', hoursWorked });
          continue;
        }

        // Write per technician (not once at the end) so a timeout partway through the loop still
        // preserves everything computed so far, instead of discarding the whole day's work.
        const result = await applyWorkHourEntries([entry], { source: 'porto' });
        rowsWritten += result.count;
        details.push({ qra: socorrista.qra, technician_id: technician.id, action: 'imported', hoursWorked });
      }

      if (dryRun) {
        details.unshift({ dry_run: true, manual: caller.manual, would_write: importedCount });
        await finishSyncLog(logId, {
          status: 'dry_run',
          technicians_processed: techniciansProcessed,
          rows_written: importedCount,
          details,
        });
        return NextResponse.json({ status: 'dry_run', technicians_processed: techniciansProcessed, would_write: importedCount, details });
      }

      const overallStatus = importedCount ? 'success' : 'partial';
      await recordHoursImportResult({ status: overallStatus });
      await finishSyncLog(logId, {
        status: overallStatus,
        technicians_processed: techniciansProcessed,
        rows_written: rowsWritten,
        details,
      });

      return NextResponse.json({ status: overallStatus, technicians_processed: techniciansProcessed, rows_written: rowsWritten, details });
    } finally {
      await browser.close();
    }
  } catch (error) {
    const message = error instanceof PortoLoginError ? error.message : 'Erro inesperado ao importar horas do Porto.';
    console.error('[cron/porto-hours] error:', error);
    // Only the real scheduled run's bookkeeping should reflect an error — a failed manual test
    // shouldn't make the admin panel think today's real automated import failed.
    if (!caller.manual) {
      await recordHoursImportResult({ status: 'error', error: message });
    }
    await finishSyncLog(logId, { status: 'error', technicians_processed: techniciansProcessed, rows_written: rowsWritten, details, error_message: message });
    return NextResponse.json({ status: 'error', error: message, details }, { status: 500 });
  }
}
