import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { decryptPortoPassword } from '@/lib/porto-crypto';
import { launchPortoBrowser } from '@/lib/porto-integration/browser';
import { loginToPorto, PortoLoginError } from '@/lib/porto-integration/login';
import { getPortoConfig } from '@/lib/porto-sync-log';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let browser: Awaited<ReturnType<typeof launchPortoBrowser>>['browser'] | undefined;
  try {
    const auth = await verifyAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const config = await getPortoConfig();
    if (!config || !config.cpf || !config.encrypted_password) {
      return NextResponse.json({ error: 'Configure CPF e senha antes de testar.' }, { status: 400 });
    }

    const password = decryptPortoPassword(config.encrypted_password as string);
    const launched = await launchPortoBrowser();
    browser = launched.browser;
    const page = await launched.context.newPage();

    await loginToPorto(page, { cpf: config.cpf as string, password });

    return NextResponse.json({ message: 'Login realizado com sucesso no Portal do Prestador.' });
  } catch (error) {
    const message = error instanceof PortoLoginError ? error.message : `Falha ao testar login no Porto: ${error instanceof Error ? error.message : String(error)}`;
    console.error('[porto-config/test-login] error:', error);
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
