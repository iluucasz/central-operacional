import type { Frame, Page } from 'playwright-core';
import { openPortalFrame } from './navigation';

export type PortoServiceRow = {
  numeroServico: string;
  anoServico: string;
  technicianNameFragment: string;
  /** "dd/mm/aaaa" as shown in the results table — the scheduled/programmed date, not necessarily the actual completion date (see getServicoDetail). */
  dataProgramada: string;
  /**
   * "HH:mm" from the results table's "Hora Prevista" column (`cap_horaAtendimento`) — confirmed
   * live with the product owner (2026-08-29) as the real time the technician actually started
   * that service, unlike the neighboring "Hora Comb." column (`cap_horaProgramadaAtendimento`,
   * a generic/static programmed slot — always the same value like 08:00 regardless of what
   * actually happened, which is what falsely made every technician's recorded start time show as
   * 08:00 before this was found). Empty string if the column wasn't present/parseable.
   */
  horaAtendimento: string;
};

export type PortoServiceDetail = {
  situacaoAtual: string;
  /** All "dd/mm/aaaa HH:mm" timestamps found on the detail page, in document order. */
  timestamps: string[];
  /** The latest timestamp found — used as "completion time" for the hours-import job. */
  latestTimestamp: string | null;
};

export type PortoDateRange = { startDateKey: string; endDateKey: string };

const SEARCH_MENU_ID = 'PDP-00089';
const SEARCH_URL = 'https://wwws.portoseguro.com.br/integracoesportaldeprestadores/click/ConServCons.xhtml?portal=2';
const MAX_RANGE_DAYS = 15; // matches the site's own client-side cap (see runServiceSearch)

function toBrDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Opens the service search page and runs a search for the given date range. Validated live: the
 * date fields start out hidden inside a `display:none` div until "TIPO DE BUSCA" is set to
 * "Combinada com Cliente" (value "1") — selecting that first is required, otherwise the date
 * inputs are unreachable (an earlier attempt at posting the form directly, bypassing this UI
 * step, failed with a 500 from the server).
 *
 * The site's own JS clamps the range to 15 days (adjusts dataFinal on blur if it's further out) —
 * mirrored here defensively so callers get a predictable range rather than a silently-adjusted one.
 */
async function runServiceSearch(page: Page, range: PortoDateRange): Promise<Frame> {
  const frame = await openPortalFrame(page, SEARCH_MENU_ID, SEARCH_URL);
  await dismissBlockingModal(frame);
  const brStart = toBrDate(range.startDateKey);
  const brEnd = toBrDate(clampRangeEnd(range));

  await frame.selectOption('#tipoData', '1');
  await frame.fill('input[name="dataInicialInputDate"]', brStart);
  await frame.fill('input[name="dataFinalInputDate"]', brEnd);

  await Promise.all([
    frame.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => null),
    frame.locator('input[name="pesquisar"]').click(),
  ]);

  return frame;
}

/**
 * Porto's RichFaces app occasionally leaves an error modal open after a flaky request (session
 * hiccup, server-side validation error, etc). Confirmed live: a Playwright click failed with
 * `locator.click: Timeout 30000ms exceeded`, whose log showed the click target correctly resolved
 * but blocked by `#form-erro-modal\:modal-erroDiv` (a RichFaces modal mask) "intercepting pointer
 * events" — and since nothing ever dismissed it, every subsequent click for the rest of that run
 * failed the same way. Force-hides any such leftover modal defensively before interacting with the
 * page, so one glitch doesn't cascade into blocking everything downstream.
 */
async function dismissBlockingModal(frame: Frame): Promise<void> {
  await frame
    .evaluate(() => {
      document.querySelectorAll('[id*="modal-erro"]').forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });
    })
    .catch(() => {});
}

function clampRangeEnd(range: PortoDateRange): string {
  const start = new Date(`${range.startDateKey}T00:00:00Z`);
  const end = new Date(`${range.endDateKey}T00:00:00Z`);
  const maxEnd = new Date(start.getTime() + MAX_RANGE_DAYS * 86400000);
  return end.getTime() > maxEnd.getTime() ? maxEnd.toISOString().slice(0, 10) : range.endDateKey;
}

/**
 * Searches every service attended within a date range in one page load (the search form natively
 * supports a period, not just a single day — used here to sweep "start of month through today" in
 * one call instead of one search per day). Validated live: the resulting table lists service order
 * codes as visible "NNNNNNN/AA" text inside `<a onclick="changeUrlAW(this, ano, numero, ...)">`
 * links — the same NNNNNNN/AA text is used here to extract numeroServico/anoServico per row, along
 * with each row's own programmed date so callers can group results by day.
 */
export async function searchServicosByDateRange(page: Page, range: PortoDateRange): Promise<PortoServiceRow[]> {
  const frame = await runServiceSearch(page, range);
  const html = await frame.content();
  return parseServiceRowsFromHtml(html);
}

const ONCLICK_CODE_PATTERN = /onclick="changeUrlAW\(this,\s*(\d+),\s*(\d+)/i;
const NAME_CELL_PATTERN = /<!--\s*Nome Tratamento\s*-->\s*<td[^>]*>([\s\S]*?)<\/td>/i;
const DATE_SPAN_PATTERN = /cap_dataProgramadaAtendimento"[^>]*>([\s\S]*?)<\/span>/i;
// "Hora Prevista" column — cap_horaAtendimento is the real per-service start time (see
// PortoServiceRow.horaAtendimento doc comment); not to be confused with the neighboring
// cap_horaProgramadaAtendimento ("Hora Comb.") column, a static scheduled slot.
const HORA_ATENDIMENTO_PATTERN = /cap_horaAtendimento"[^>]*>([\s\S]*?)<\/span>/i;

/**
 * Validated live against a real 15-day range result (402 rows): the row's other all-caps cells
 * (Sigla Empresa like "SERVICOS"/"PORTO SEGURO", Tipo Serviço) also match a naive "all-caps text
 * cell" heuristic and were being picked up ahead of the real technician name — silently breaking
 * every name-based match. The table's own HTML comments (`<!-- Nome Tratamento -->` etc) are
 * reliable, stable anchors for each column instead of guessing by content shape; the service code
 * itself is read from the `onclick="changeUrlAW(this, ano, numero, ...)"` attribute, not the cell
 * text, for the same reason.
 */
function parseServiceRowsFromHtml(html: string): PortoServiceRow[] {
  const rows: PortoServiceRow[] = [];
  const rowMatches = html.split(/<tr[\s>]/i).slice(1);

  for (const rawRow of rowMatches) {
    const codeMatch = rawRow.match(ONCLICK_CODE_PATTERN);
    if (!codeMatch) continue;

    const [, anoServico, numeroServico] = codeMatch;

    const nameMatch = rawRow.match(NAME_CELL_PATTERN);
    const technicianNameFragment = nameMatch
      ? nameMatch[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
      : '';

    const dateMatch = rawRow.match(DATE_SPAN_PATTERN);
    const dataProgramada = dateMatch ? dateMatch[1].trim() : '';

    const horaMatch = rawRow.match(HORA_ATENDIMENTO_PATTERN);
    const horaAtendimento = horaMatch ? horaMatch[1].replace(/&nbsp;/g, ' ').trim() : '';

    if (!technicianNameFragment) continue;

    rows.push({ numeroServico, anoServico, technicianNameFragment, dataProgramada, horaAtendimento });
  }

  return rows;
}

/**
 * Fetches a service's detail and extracts its completion timestamp. Validated live end-to-end:
 * re-runs the same range search (detail pages reject direct URL navigation with "Acesso
 * proibido", same as escala.ts — they only work when reached via a real click from the search
 * results), then clicks the specific result whose `onclick="changeUrlAW(this, anoServico,
 * numeroServico, ...)"` matches. Confirmed against production: extracted timestamps for service
 * 5167437/26 matched exactly (17/08/2026 06:13, 09:17, 10:25, 10:58 — "Concluído" at 10:58).
 *
 * Known trade-off: re-running the full search per call means N services cost N searches, not 1 —
 * clicking a result navigates the frame away, so getting "back" to a fresh results list is only
 * reliable by re-searching rather than trusting iframe back-navigation. The caller
 * (app/api/cron/porto-hours/route.ts) keeps this bounded by only fetching detail for
 * (technician, date) combinations not already imported, so a month-long range stays cheap on
 * every run after the first catch-up.
 */
export async function getServicoDetail(page: Page, range: PortoDateRange, params: { anoServico: string; numeroServico: string }): Promise<PortoServiceDetail> {
  const frame = await runServiceSearch(page, range);
  await dismissBlockingModal(frame);
  const link = frame.locator(`a[onclick*="changeUrlAW(this, ${params.anoServico}, ${params.numeroServico}"]`).first();

  if (!(await link.count())) {
    return { situacaoAtual: '', timestamps: [], latestTimestamp: null };
  }

  await Promise.all([
    frame.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => null),
    link.click(),
  ]);

  const html = await frame.content();

  const situacaoMatch = html.match(/Situa[çc][ãa]o Atual[\s\S]{0,200}?pv-campo-padrao">([^<]*)</i);
  const timestamps = Array.from(html.matchAll(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/g)).map((match) => match[0]);

  const latestTimestamp =
    timestamps.length > 0
      ? timestamps.reduce((latest, current) => (parseBrDateTime(current) > parseBrDateTime(latest) ? current : latest))
      : null;

  return {
    situacaoAtual: situacaoMatch?.[1]?.trim() ?? '',
    timestamps,
    latestTimestamp,
  };
}

function parseBrDateTime(value: string): number {
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!match) return 0;
  const [, day, month, year, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).getTime();
}
