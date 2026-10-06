// Relative imports only: runs in the VPS worker (worker/tsconfig.json).
import { getOrganizationSettings } from './organization-settings-store';
import { sendEvolutionText } from './whatsapp/evolution';
import { connectionFromConfig, getWhatsAppConfig } from './whatsapp/store';

/**
 * Warns the admin by WhatsApp (Configurações → "WhatsApp para alertas do robô") that an automatic
 * Porto run failed or looked wrong. Independent of the technicians' notification switch — it's an
 * operational alarm, not a notification. Never throws: a failed alert only gets logged.
 */
export async function sendPortoAlert(title: string, lines: string[]): Promise<{ sent: boolean; reason?: string }> {
  try {
    const phone = (await getOrganizationSettings()).portoAlertPhone.trim();
    if (!phone) return { sent: false, reason: 'Nenhum WhatsApp de alerta configurado.' };

    const connection = connectionFromConfig(await getWhatsAppConfig());
    if (!connection) return { sent: false, reason: 'WhatsApp (Evolution) não configurado neste servidor.' };

    const body = lines.slice(0, 12).map((line) => `• ${line}`).join('\n');
    const more = lines.length > 12 ? `\n• … e mais ${lines.length - 12}` : '';
    const text = `⚠️ *Robô do Porto*: ${title}\n\n${body}${more}\n\nDetalhes em Config. Porto → Histórico de execuções.`;
    const result = await sendEvolutionText(connection, phone, text);
    if (!result.ok) console.error('[porto-alerts] send failed:', result.error);
    return result.ok ? { sent: true } : { sent: false, reason: result.error ?? undefined };
  } catch (error) {
    console.error('[porto-alerts] error:', error);
    return { sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
