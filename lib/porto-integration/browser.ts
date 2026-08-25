import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium, type Browser, type BrowserContext } from 'playwright-core';

const PORTO_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Launches a Chromium browser for scraping the Porto Seguro provider portal.
 *
 * On Vercel/Lambda this uses @sparticuz/chromium's serverless-compatible binary.
 * For local development, install a Chromium build once with `npx playwright install chromium`
 * — playwright-core auto-discovers browsers installed that way, no extra config needed.
 */
export async function launchPortoBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
  const serverless = isServerlessRuntime();

  const browser = await playwrightChromium.launch({
    args: serverless ? chromium.args : [],
    executablePath: serverless ? await chromium.executablePath() : undefined,
    headless: true,
  });

  const context = await browser.newContext({
    userAgent: PORTO_USER_AGENT,
    viewport: { width: 1280, height: 900 },
    locale: 'pt-BR',
  });

  return { browser, context };
}
