import type { Page } from 'playwright-core';
import { openPortalFrame } from './navigation';

export type PortoEscalaDay = {
  /** Day of month, 1-31. */
  day: number;
  startTime: string | null;
  endTime: string | null;
  /** True when the day has an "indisponibilidade" marker (férias, folga, doença, etc). */
  unavailable: boolean;
  /** Free-text reason, when available next to the marker. */
  reason: string | null;
};

const SOCORRISTAS_MENU_ID = 'PDP-00192';
const SOCORRISTAS_URL = 'https://wwws.portoseguro.com.br/integracoesportaldeprestadores/click/ConSocor.xhtml?portal=2';

/**
 * Reads the current month's schedule for one technician (identified by QRA).
 *
 * Validated live against a real field technician (not the account owner — the owner's own QRA
 * has an empty schedule and looks misleadingly like the cells carry no data at all). Each day
 * cell (`.organizerDayCell`) contains the time range as plain text, e.g. "08:00 - 18:00", and an
 * `<img src=".../indisponibilidade.png">` on days with an exception — confirmed present on 9 of
 * 42 cells for a real technician's August 2026 calendar.
 *
 * Navigation: detail pages reject direct URL access ("Acesso proibido"), so this opens the
 * socorristas list through its portal wrapper and clicks the technician's own link, exactly like
 * a real user would, rather than constructing the ConDetSocor.xhtml URL directly.
 */
export async function getEscalaForCurrentMonth(page: Page, qra: string): Promise<PortoEscalaDay[]> {
  const listFrame = await openPortalFrame(page, SOCORRISTAS_MENU_ID, SOCORRISTAS_URL);
  const link = listFrame.locator(`a[href*="numeroQRA=${qra}"]`).first();

  if (!(await link.count())) {
    return [];
  }

  await Promise.all([
    listFrame.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => null),
    link.click(),
  ]);

  const detailFrame = page.frames().find((f) => f.url().includes('ConDetSocor')) ?? listFrame;

  return detailFrame.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.organizerDayCell'));

    return cells
      .map((cell) => {
        // Day number and time range live in separate elements — read them independently rather
        // than the whole cell's concatenated textContent, which merges them with no separator
        // (e.g. day "1" + "08:00 - 18:00" reads as "108:00 - 18:00", making a naive /^\d{1,2}/
        // match misread day 1 as day 10). The day span has no stable class, but it's reliably the
        // first element with only digits as content within the cell.
        const dayCandidate = Array.from(cell.querySelectorAll('span')).find((span) => /^\d{1,2}$/.test(span.textContent?.trim() ?? ''));
        if (!dayCandidate) return null;

        const timeCandidate = cell.querySelector('span[title="Escala"]')?.textContent ?? '';
        const timeMatch = timeCandidate.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        const hasUnavailabilityIcon = Boolean(cell.querySelector('img[src*="indisponibilidade"]'));

        return {
          day: Number(dayCandidate.textContent!.trim()),
          startTime: timeMatch ? timeMatch[1] : null,
          endTime: timeMatch ? timeMatch[2] : null,
          unavailable: hasUnavailabilityIcon,
          reason: null as string | null,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  });
}
