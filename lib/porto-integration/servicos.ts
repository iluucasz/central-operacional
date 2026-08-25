import type { Frame, Page } from 'playwright-core';
import { openPortalFrame } from './navigation';

export type PortoServiceRow = {
  numeroServico: string;
  anoServico: string;
  technicianNameFragment: string;
  dataProgramada: string;
};

export type PortoServiceDetail = {
  situacaoAtual: string;
  /** All "dd/mm/aaaa HH:mm" timestamps found on the detail page, in document order. */
  timestamps: string[];
  /** The latest timestamp found — used as "completion time" for the hours-import job. */
  latestTimestamp: string | null;
};

const SEARCH_MENU_ID = 'PDP-00089';
const SEARCH_URL = 'https://wwws.portoseguro.com.br/integracoesportaldeprestadores/click/ConServCons.xhtml?portal=2';
const SERVICE_CODE_PATTERN = /^(\d{5,8})\/(\d{2})$/;

function toBrDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Opens the service search page and runs a search for the given date. Validated live: the date
 * fields start out hidden inside a `display:none` div until "TIPO DE BUSCA" is set to "Combinada
 * com Cliente" (value "1") — selecting that first is required, otherwise the date inputs are
 * unreachable (an earlier attempt at posting the form directly, bypassing this UI step, failed
 * with a 500 from the server).
 */
async function runServiceSearch(page: Page, dateKey: string): Promise<Frame> {
  const frame = await openPortalFrame(page, SEARCH_MENU_ID, SEARCH_URL);
  const brDate = toBrDate(dateKey);

  await frame.selectOption('#tipoData', '1');
  await frame.fill('input[name="dataInicialInputDate"]', brDate);
  await frame.fill('input[name="dataFinalInputDate"]', brDate);

  await Promise.all([
    frame.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => null),
    frame.locator('input[name="pesquisar"]').click(),
  ]);

  return frame;
}

/**
 * Searches services attended on a given date. Validated live: the resulting table lists service
 * order codes as visible "NNNNNNN/AA" text inside `<a onclick="changeUrlAW(this, ano, numero, ...)">`
 * links — the same NNNNNNN/AA text is used here to extract numeroServico/anoServico per row.
 */
export async function searchServicosByDate(page: Page, dateKey: string): Promise<PortoServiceRow[]> {
  const frame = await runServiceSearch(page, dateKey);
  const html = await frame.content();
  return parseServiceRowsFromHtml(html);
}

function parseServiceRowsFromHtml(html: string): PortoServiceRow[] {
  const rows: PortoServiceRow[] = [];
  const rowMatches = html.split(/<tr[\s>]/i).slice(1);

  for (const rawRow of rowMatches) {
    const cellTexts = Array.from(rawRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((match) =>
      match[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
    );

    const codeCell = cellTexts.find((text) => SERVICE_CODE_PATTERN.test(text));
    if (!codeCell) continue;

    const [, numeroServico, anoServico] = codeCell.match(SERVICE_CODE_PATTERN)!;
    const dateCell = cellTexts.find((text) => /^\d{2}\/\d{2}\/\d{4}$/.test(text)) ?? '';
    const nameCell = cellTexts.find((text) => /^[A-ZÀ-Ú\s]{4,40}$/.test(text)) ?? '';

    rows.push({
      numeroServico,
      anoServico,
      technicianNameFragment: nameCell,
      dataProgramada: dateCell,
    });
  }

  return rows;
}

/**
 * Fetches a service's detail and extracts its completion timestamp. Validated live end-to-end:
 * re-runs the search for `dateKey` (detail pages reject direct URL navigation with "Acesso
 * proibido", same as escala.ts — they only work when reached via a real click from the search
 * results), then clicks the specific result whose `onclick="changeUrlAW(this, anoServico,
 * numeroServico, ...)"` matches. Confirmed against production: extracted timestamps for service
 * 5167437/26 matched exactly (17/08/2026 06:13, 09:17, 10:25, 10:58 — "Concluído" at 10:58).
 *
 * Known trade-off: re-running the full search per call means N services cost N searches, not 1 —
 * clicking a result navigates the frame away, so getting "back" to a fresh results list is only
 * reliable by re-searching rather than trusting iframe back-navigation. Acceptable at this
 * account's scale (~12 technicians, a handful of services/day) within the 280s function budget;
 * the caller (app/api/cron/porto-hours/route.ts) also writes each technician's result immediately
 * rather than batching, so a timeout here loses at most the technicians not yet processed, not
 * the whole day's already-computed entries.
 */
export async function getServicoDetail(page: Page, dateKey: string, params: { anoServico: string; numeroServico: string }): Promise<PortoServiceDetail> {
  const frame = await runServiceSearch(page, dateKey);
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
