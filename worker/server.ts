import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { decryptPortoPassword } from '../lib/porto-crypto';
import { sql } from '../lib/db';
import { launchPortoBrowser } from '../lib/porto-integration/browser';
import { loginToPorto, PortoLoginError } from '../lib/porto-integration/login';
import { listSocorristas } from '../lib/porto-integration/socorristas';
import { getPortoConfig } from '../lib/porto-sync-log';
import { runHoursJob } from '../lib/porto-jobs/run-hours-job';
import { runScheduleJob } from '../lib/porto-jobs/run-schedule-job';

const PORT = Number(process.env.PORTO_WORKER_PORT ?? 8090);
const SECRET = process.env.PORTO_WORKER_SECRET;

function isAuthorized(req: IncomingMessage): boolean {
  if (!SECRET) return false;
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  const token = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(SECRET);
  return token.length === expected.length && timingSafeEqual(token, expected);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

async function handleTestLogin(res: ServerResponse) {
  const config = await getPortoConfig();
  if (!config || !config.cpf || !config.encrypted_password) {
    sendJson(res, 400, { error: 'Configure CPF e senha antes de testar.' });
    return;
  }

  const password = decryptPortoPassword(config.encrypted_password as string);
  const { browser, context } = await launchPortoBrowser();
  try {
    const page = await context.newPage();
    await loginToPorto(page, { cpf: config.cpf as string, password });
    sendJson(res, 200, { message: 'Login realizado com sucesso no Portal do Prestador.' });
  } catch (error) {
    const message = error instanceof PortoLoginError ? error.message : `Falha ao testar login no Porto: ${error instanceof Error ? error.message : String(error)}`;
    sendJson(res, 400, { error: message });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function handleSocorristas(res: ServerResponse) {
  const config = await getPortoConfig();
  if (!config || !config.cpf || !config.encrypted_password) {
    sendJson(res, 400, { error: 'Configure CPF e senha antes de buscar os técnicos do Porto.' });
    return;
  }

  const password = decryptPortoPassword(config.encrypted_password as string);
  const { browser, context } = await launchPortoBrowser();
  try {
    const page = await context.newPage();
    await loginToPorto(page, { cpf: config.cpf as string, password });
    const socorristas = await listSocorristas(page);
    const technicians = await sql`
      SELECT id, qra, porto_name_hint, name, email, commission_percentage, base_salary,
             va_allowance, vr_allowance, status
      FROM technicians
      ORDER BY name ASC
    `;
    sendJson(res, 200, { socorristas, technicians });
  } catch (error) {
    const message = error instanceof PortoLoginError ? error.message : `Falha ao buscar técnicos do Porto: ${error instanceof Error ? error.message : String(error)}`;
    sendJson(res, 400, { error: message });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function handleRunHours(url: URL, res: ServerResponse) {
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const dateRange = start ? { startDateKey: start, endDateKey: end || start } : undefined;
  const result = await runHoursJob({ manual: true, dateRange });
  sendJson(res, result.status === 'error' ? 500 : 200, result);
}

async function handleRunSchedule(res: ServerResponse) {
  const result = await runScheduleJob({ manual: true });
  sendJson(res, result.status === 'error' ? 500 : 200, result);
}

/**
 * Exposes the same admin-triggered actions the Vercel-hosted admin UI used to run inline
 * (test-login, técnico match list, manual hours/schedule test) as plain HTTP endpoints — the
 * Vercel routes now just forward here (see app/api/porto-config/* and app/api/cron/porto-*),
 * so no Playwright/Chromium code runs on Vercel at all. Bound to 127.0.0.1 only in Docker (see
 * the `docker run -p 127.0.0.1:PORT:PORT` invocation) and reverse-proxied through the VPS's
 * existing Caddy instance (HTTPS) under /porto-worker/* — never exposed directly.
 */
export function startWorkerServer() {
  if (!SECRET) {
    console.error('[worker/server] PORTO_WORKER_SECRET não configurado — servidor HTTP não vai iniciar.');
    return;
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (!isAuthorized(req)) {
          sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }

        const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

        if (req.method === 'GET' && url.pathname === '/run/hours') {
          await handleRunHours(url, res);
          return;
        }
        if (req.method === 'GET' && url.pathname === '/run/schedule') {
          await handleRunSchedule(res);
          return;
        }
        if (req.method === 'POST' && url.pathname === '/test-login') {
          await handleTestLogin(res);
          return;
        }
        if (req.method === 'POST' && url.pathname === '/socorristas') {
          await handleSocorristas(res);
          return;
        }

        sendJson(res, 404, { error: 'Not found' });
      } catch (error) {
        console.error('[worker/server] unhandled error:', error);
        sendJson(res, 500, { error: 'Erro interno do worker.' });
      }
    })();
  });

  // Listens on all interfaces inside the container — host-level exposure is restricted by the
  // `docker run -p 127.0.0.1:PORT:PORT` binding instead (binding to 127.0.0.1 in here would be
  // unreachable even through that published port, since Docker's NAT targets the container's
  // real interface, not its loopback).
  server.listen(PORT, () => {
    console.log(`[worker/server] HTTP server ouvindo na porta ${PORT}`);
  });
}
