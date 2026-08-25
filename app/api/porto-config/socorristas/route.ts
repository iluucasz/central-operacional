import { NextRequest, NextResponse } from 'next/server';
import type { Page } from 'playwright-core';
import { verifyAuth } from '@/lib/auth';
import { sql } from '@/lib/db';
import { decryptPortoPassword } from '@/lib/porto-crypto';
import { launchPortoBrowser } from '@/lib/porto-integration/browser';
import { loginToPorto, PortoLoginError } from '@/lib/porto-integration/login';
import { listSocorristas } from '@/lib/porto-integration/socorristas';
import { getPortoConfig } from '@/lib/porto-sync-log';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Real login + fetch of Porto's own socorristas list (QRA, nome, CPF, status), alongside the
 * locally registered technicians — feeds the "Match de técnicos" modal (admin/config-porto) where
 * an admin manually confirms which local technician each Porto QRA corresponds to, instead of
 * relying only on the automatic name-prefix guess used by the hours job.
 */
export async function POST(request: NextRequest) {
  let browser: Awaited<ReturnType<typeof launchPortoBrowser>>['browser'] | undefined;

  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const config = await getPortoConfig();
    if (!config || !config.cpf || !config.encrypted_password) {
      return NextResponse.json({ error: 'Configure CPF e senha antes de buscar os técnicos do Porto.' }, { status: 400 });
    }

    const password = decryptPortoPassword(config.encrypted_password as string);
    const launched = await launchPortoBrowser();
    browser = launched.browser;
    const page: Page = await launched.context.newPage();

    await loginToPorto(page, { cpf: config.cpf as string, password });
    const socorristas = await listSocorristas(page);

    const technicians = await sql`
      SELECT id, qra, porto_name_hint, name, email, commission_percentage, base_salary,
             va_allowance, vr_allowance, status
      FROM technicians
      ORDER BY name ASC
    `;

    return NextResponse.json({ socorristas, technicians });
  } catch (error) {
    const message = error instanceof PortoLoginError ? error.message : `Falha ao buscar técnicos do Porto: ${error instanceof Error ? error.message : String(error)}`;
    console.error('[porto-config/socorristas] error:', error);
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
