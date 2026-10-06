import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { parseOrganizationSettingsInput, pickTechnicianSettings } from '@/lib/organization-settings';
import { getOrganizationSettings, getOrganizationSettingsMeta, saveOrganizationSettings } from '@/lib/organization-settings-store';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const settings = await getOrganizationSettings();

    // A technician (or an admin previewing one) only gets what their own screens use — salaries
    // and the default commission never leave the admin side.
    if (auth.role !== 'admin' || auth.preview) {
      return NextResponse.json({ settings: pickTechnicianSettings(settings) });
    }

    return NextResponse.json({ settings, ...(await getOrganizationSettingsMeta()) });
  } catch (error) {
    console.error('[organization-settings] GET error:', error);
    return NextResponse.json({ error: 'Não foi possível carregar as configurações.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }
    if (auth.role !== 'admin' || auth.preview) {
      return NextResponse.json({ error: 'Apenas o administrador pode alterar as configurações.' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const parsed = parseOrganizationSettingsInput(body?.settings ?? body);
    if (parsed.error !== undefined) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const before = await getOrganizationSettings();
    const saved = await saveOrganizationSettings(parsed.settings, auth.userId);
    // No audit table in this project — keep a before/after trail in the server logs.
    console.info('[organization-settings] updated by', auth.userId, JSON.stringify({ before, after: saved }));

    return NextResponse.json({ settings: saved, ...(await getOrganizationSettingsMeta()) });
  } catch (error) {
    console.error('[organization-settings] PUT error:', error);
    return NextResponse.json({ error: 'Não foi possível salvar as configurações.' }, { status: 500 });
  }
}
