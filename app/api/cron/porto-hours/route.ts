import { NextRequest, NextResponse } from 'next/server';
import { resolveCronCaller } from '@/lib/cron-auth';
import { decryptPortoPassword } from '@/lib/porto-crypto';
import { getEscalaForCurrentMonth, type PortoEscalaDay } from '@/lib/porto-integration/escala';
import { launchAuthenticatedPortoSession } from '@/lib/porto-integration/browser';
import { PortoLoginError } from '@/lib/porto-integration/login';
import { listSocorristas } from '@/lib/porto-integration/socorristas';
import { getServicoDetail, searchServicosByDateRange, type PortoServiceRow } from '@/lib/porto-integration/servicos';
import { resolveTechnicianByQra } from '@/lib/porto-integration/technician-match';
import { finishSyncLog, getPortoConfig, recordHoursImportResult, startSyncLog } from '@/lib/porto-sync-log';
import { applyWorkHourEntries, getExistingPortoImportedDates, getIsoWeekNumber, type WorkHourEntry } from '@/lib/work-hours-service';
import type { Technician } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 280;

const MAX_PLAUSIBLE_SHIFT_HOURS = 16;
const SEARCH_CHUNK_DAYS = 15; // matches the site's own client-side range cap (see servicos.ts)

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getMonthStartKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function toBrDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

function brDateToKey(brDate: string): string | null {
  const match = brDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function addDaysToKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Splits [startKey, endKey] into chunks of at most SEARCH_CHUNK_DAYS days each. */
function buildDateChunks(startKey: string, endKey: string): { startDateKey: string; endDateKey: string }[] {
  const chunks: { startDateKey: string; endDateKey: string }[] = [];
  let cursor = startKey;
  while (cursor <= endKey) {
    const chunkEnd = addDaysToKey(cursor, SEARCH_CHUNK_DAYS - 1);
    chunks.push({ startDateKey: cursor, endDateKey: chunkEnd > endKey ? endKey : chunkEnd });
    cursor = addDaysToKey(chunkEnd > endKey ? endKey : chunkEnd, 1);
  }
  return chunks;
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
 * Coverage (2026-08-25, reviewed with the product owner): this job sweeps every day from the 1st
 * of the current month through today in one run — not just "today" — since Porto's search form
 * natively supports a date range (capped at 15 days by the site itself, so a month past day 15
 * needs 2+ search chunks). To keep every run cheap after the first catch-up, it skips re-fetching
 * service detail pages for (technician, date) pairs that already have a `source='porto'` row in
 * `work_hours` — only genuinely new days do the expensive per-service detail lookup.
 */
// Fixing the technician-name column bug (servicos.ts) meant matches actually work now, which
// exposed a real risk: a full month catch-up can involve far more per-service detail fetches
// (each one a fresh search + click, see servicos.ts) than a single invocation can finish inside
// Vercel's maxDuration. Rather than let the platform kill the function mid-flight (which returns
// a raw non-JSON error page instead of a clean response), the loop below checks elapsed time and
// stops itself early, leaving whatever's left for the next run to pick up via the existing
// already-imported skip check.
const TIME_BUDGET_MS = 240_000; // ~40s margin under maxDuration=280s for browser.close() + response

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const timeBudgetExceeded = () => Date.now() - startedAt > TIME_BUDGET_MS;

  const caller = await resolveCronCaller(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await getPortoConfig();
  const missingCredentials = !config || !config.encrypted_password || !config.cpf;
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
    const { browser, page } = await launchAuthenticatedPortoSession({ cpf: config.cpf as string, password });

    try {
      const monthStartKey = getMonthStartKey();
      const todayKey = getTodayKey();

      const socorristas = await listSocorristas(page);

      // Resolve all technicians up front so we know which (technician, date) pairs to skip.
      const resolved: Array<{ qra: string; technician: Technician }> = [];
      for (const socorrista of socorristas) {
        techniciansProcessed++;
        const technician = await resolveTechnicianByQra(socorrista.qra);
        if (!technician) {
          details.push({ qra: socorrista.qra, action: 'skipped_no_match' });
          continue;
        }
        resolved.push({ qra: socorrista.qra, technician });
      }

      const technicianIds = resolved.map((r) => r.technician.id);
      const existingDates = await getExistingPortoImportedDates(technicianIds, monthStartKey, todayKey);

      // One search per 15-day chunk covers the whole month-to-date, instead of one per day.
      const chunks = buildDateChunks(monthStartKey, todayKey);
      const allServices: PortoServiceRow[] = [];
      for (const chunk of chunks) {
        const services = await searchServicosByDateRange(page, chunk);
        allServices.push(...services);
      }

      const escalaCache = new Map<string, PortoEscalaDay[]>();
      let budgetExceeded = false;

      // Match each technician's services once up front (name-prefix match doesn't depend on date).
      const technicianServicesByQra = new Map<string, { technician: Technician; services: PortoServiceRow[] }>();
      for (const { qra, technician } of resolved) {
        // Prefer the admin-set Porto name hint (lib/types.ts Technician.porto_name_hint) when
        // present — the registered `name` sometimes doesn't match how Porto displays the person
        // (nickname, abbreviation, etc), and there's no stable ID in the search results to match
        // on instead (see servicos.ts).
        const nameSource = (technician.porto_name_hint || technician.name).trim();
        const namePrefix = nameSource.toUpperCase().slice(0, 8);
        const services = allServices.filter((service) => service.technicianNameFragment.toUpperCase().startsWith(namePrefix));
        if (!services.length) {
          details.push({ qra, technician_id: technician.id, action: 'no_services' });
          continue;
        }
        technicianServicesByQra.set(qra, { technician, services });
      }

      // Group into date -> [technician's services that day], then walk dates most-recent-first.
      // Each (technician, date) detail fetch costs two real page loads against a slow legacy
      // portal (confirmed live: a first full-month catch-up can burn the whole time budget on a
      // single technician's handful of days), so a run can easily get cut off before finishing.
      // Processing most-recent-first means whatever gets cut off is the oldest, least
      // time-sensitive data, and every technician gets a shot at today/yesterday instead of only
      // whichever technician happens to be first in Porto's own listing order.
      const byDate = new Map<string, Array<{ qra: string; technician: Technician; services: PortoServiceRow[] }>>();
      for (const [qra, { technician, services }] of technicianServicesByQra) {
        const byDateForTechnician = new Map<string, PortoServiceRow[]>();
        for (const service of services) {
          const dateKey = brDateToKey(service.dataProgramada);
          if (!dateKey) continue;
          const list = byDateForTechnician.get(dateKey) ?? [];
          list.push(service);
          byDateForTechnician.set(dateKey, list);
        }
        for (const [dateKey, servicesForDay] of byDateForTechnician) {
          const list = byDate.get(dateKey) ?? [];
          list.push({ qra, technician, services: servicesForDay });
          byDate.set(dateKey, list);
        }
      }

      const sortedDateKeys = Array.from(byDate.keys()).sort().reverse();

      dateLoop:
      for (const dateKey of sortedDateKeys) {
        if (timeBudgetExceeded()) {
          budgetExceeded = true;
          break dateLoop;
        }

        for (const { qra, technician, services: servicesForDay } of byDate.get(dateKey)!) {
          if (timeBudgetExceeded()) {
            budgetExceeded = true;
            break dateLoop;
          }

          const dedupKey = `${technician.id}::${dateKey}`;
          if (existingDates.has(dedupKey)) {
            details.push({ qra, technician_id: technician.id, action: 'already_imported', date: dateKey });
            continue;
          }

          const brDate = toBrDate(dateKey);
          const dayRange = { startDateKey: dateKey, endDateKey: dateKey };

          let latestCompletion: string | null = null;
          for (const service of servicesForDay) {
            if (timeBudgetExceeded()) {
              budgetExceeded = true;
              break dateLoop;
            }
            // A single flaky service page (stuck modal, navigation hiccup on Porto's legacy JSF
            // app — confirmed live: a leftover RichFaces error modal blocked every subsequent
            // click for the rest of the run) shouldn't abort the whole month's import. Log it and
            // keep going instead of letting one bad service take down everything already computed.
            let detail;
            try {
              detail = await getServicoDetail(page, dayRange, { anoServico: service.anoServico, numeroServico: service.numeroServico });
            } catch (detailError) {
              details.push({
                qra,
                technician_id: technician.id,
                action: 'service_detail_failed',
                date: dateKey,
                numeroServico: service.numeroServico,
                error: detailError instanceof Error ? detailError.message.slice(0, 300) : String(detailError),
              });
              continue;
            }
            for (const timestamp of detail.timestamps) {
              if (!timestamp.startsWith(brDate)) continue;
              const timeOnly = timestamp.split(' ')[1];
              if (timeOnly && (!latestCompletion || timeOnly > latestCompletion)) {
                latestCompletion = timeOnly;
              }
            }
          }

          if (!latestCompletion) {
            details.push({ qra, technician_id: technician.id, action: 'no_completion_time', date: dateKey });
            continue;
          }

          let plannedStart = '08:00';
          try {
            if (!escalaCache.has(qra)) {
              escalaCache.set(qra, await getEscalaForCurrentMonth(page, qra));
            }
            const escalaDays = escalaCache.get(qra) ?? [];
            const dayOfMonth = Number(dateKey.slice(8, 10));
            plannedStart = escalaDays.find((day) => day.day === dayOfMonth)?.startTime ?? '08:00';
          } catch (escalaError) {
            details.push({ qra, technician_id: technician.id, action: 'escala_fetch_failed_fallback_0800', date: dateKey, error: escalaError instanceof Error ? escalaError.message : String(escalaError) });
          }

          const hoursWorked = diffHours(plannedStart, latestCompletion);
          if (hoursWorked <= 0 || hoursWorked > MAX_PLAUSIBLE_SHIFT_HOURS) {
            details.push({ qra, technician_id: technician.id, action: 'invalid_hours', date: dateKey, plannedStart, latestCompletion, hoursWorked });
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
            details.push({ qra, technician_id: technician.id, action: 'would_import', date: dateKey, hoursWorked });
            continue;
          }

          // Write per (technician, date) — not batched — so a timeout partway through still
          // preserves everything computed so far instead of discarding the whole run.
          const result = await applyWorkHourEntries([entry], { source: 'porto' });
          rowsWritten += result.count;
          details.push({ qra, technician_id: technician.id, action: 'imported', date: dateKey, hoursWorked });
        }
      }

      if (budgetExceeded) {
        details.push({
          action: 'time_budget_exceeded_stopping_early',
          note: 'Execução parou antes do limite de tempo da function. Os dias/técnicos restantes serão processados na próxima execução (nada é perdido — dias já gravados continuam marcados como importados).',
        });
      }

      if (dryRun) {
        details.unshift({ dry_run: true, manual: caller.manual, would_write: importedCount, range: `${monthStartKey}..${todayKey}`, partial: budgetExceeded });
        await finishSyncLog(logId, {
          status: 'dry_run',
          technicians_processed: techniciansProcessed,
          rows_written: importedCount,
          details,
        });
        return NextResponse.json({ status: 'dry_run', technicians_processed: techniciansProcessed, would_write: importedCount, partial: budgetExceeded, details });
      }

      const overallStatus = budgetExceeded ? 'partial' : importedCount ? 'success' : 'partial';
      await recordHoursImportResult({ status: overallStatus });
      await finishSyncLog(logId, {
        status: overallStatus,
        technicians_processed: techniciansProcessed,
        rows_written: rowsWritten,
        details,
      });

      return NextResponse.json({ status: overallStatus, technicians_processed: techniciansProcessed, rows_written: rowsWritten, partial: budgetExceeded, details });
    } finally {
      await browser.close();
    }
  } catch (error) {
    const message = error instanceof PortoLoginError ? error.message : 'Erro inesperado ao importar horas do Porto.';
    console.error('[cron/porto-hours] error:', error);
    if (!caller.manual) {
      await recordHoursImportResult({ status: 'error', error: message });
    }
    await finishSyncLog(logId, { status: 'error', technicians_processed: techniciansProcessed, rows_written: rowsWritten, details, error_message: message });
    return NextResponse.json({ status: 'error', error: message, details }, { status: 500 });
  }
}
