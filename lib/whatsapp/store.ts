// Relative imports only: this module is also compiled into the VPS worker (worker/tsconfig.json),
// which has no `@/` path alias.
import { randomUUID } from 'crypto';
import { sql } from '../db';
import type { EvolutionConnection } from './evolution';
import {
  normalizeNotificationSettings,
  type MessageStatus,
  type MessageTrigger,
  type NotificationSettings,
  type NotificationType,
} from './notification-types';

let whatsappSchemaReady: Promise<void> | null = null;

export async function ensureWhatsAppSchema() {
  if (!whatsappSchemaReady) {
    whatsappSchemaReady = (async () => {
      // Single row, same pattern as porto_config. Only what the admin screen edits lives here — the
      // Evolution connection itself comes from the EVOLUTION_* env vars (see evolutionEnv).
      await sql`
        CREATE TABLE IF NOT EXISTS whatsapp_config (
          id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          enabled BOOLEAN NOT NULL DEFAULT FALSE,
          test_phone TEXT,
          app_url TEXT,
          notifications JSONB NOT NULL DEFAULT '{}'::jsonb,
          job_runs JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by TEXT
        )
      `;

      // Both the send history and the de-duplication ledger: a notification claims its
      // `dedupe_key` before sending, so the worker and a manual "Rodar agora" can never both send
      // it. The key is cleared again when a send fails or is skipped, so a later run can retry.
      await sql`
        CREATE TABLE IF NOT EXISTS whatsapp_messages (
          id TEXT PRIMARY KEY,
          technician_id TEXT,
          technician_name TEXT,
          phone TEXT,
          type VARCHAR(32) NOT NULL,
          trigger_kind VARCHAR(16) NOT NULL,
          dedupe_key TEXT UNIQUE,
          reference_date DATE,
          message TEXT NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'pending',
          error TEXT,
          redirected_to_test BOOLEAN NOT NULL DEFAULT FALSE,
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          sent_at TIMESTAMPTZ
        )
      `;

      await sql`CREATE INDEX IF NOT EXISTS whatsapp_messages_created_idx ON whatsapp_messages (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS whatsapp_messages_technician_idx ON whatsapp_messages (technician_id, created_at DESC)`;

      // Keeps the cleanup below (which runs on every cold start) from scanning the whole table.
      await sql`
        CREATE INDEX IF NOT EXISTS whatsapp_messages_test_dedupe_idx
        ON whatsapp_messages (dedupe_key) WHERE redirected_to_test
      `;

      // Messages diverted to the test number never reached the technician, so they must not hold
      // that technician's dedupe key. New ones don't take a key at all (see `deliver`); this clears
      // the ones recorded before that, which were blocking the real send as "already sent".
      await sql`
        UPDATE whatsapp_messages
        SET dedupe_key = NULL
        WHERE redirected_to_test = TRUE AND dedupe_key IS NOT NULL
      `;

      await sql`ALTER TABLE technicians ADD COLUMN IF NOT EXISTS phone TEXT`;
    })().catch((error) => {
      whatsappSchemaReady = null;
      throw error;
    });
  }

  return whatsappSchemaReady;
}

/**
 * The Evolution connection: EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE, the same
 * variables as the EssencialCentro project. Env only — set on Vercel and on the worker container.
 */
export function evolutionEnv() {
  return {
    apiUrl: (process.env.EVOLUTION_API_URL ?? '').trim(),
    apiKey: (process.env.EVOLUTION_API_KEY ?? '').trim(),
    instance: (process.env.EVOLUTION_INSTANCE ?? '').trim(),
  };
}

export interface WhatsAppConfig {
  apiUrl: string;
  apiKey: string;
  instance: string;
  enabled: boolean;
  /** When set, every message goes to this number instead of the technician's. */
  testPhone: string;
  /** Public URL of this system, used by the `{link}` template variable. */
  appUrl: string;
  notifications: NotificationSettings;
  updatedAt: string | null;
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  await ensureWhatsAppSchema();

  const rows = await sql`SELECT * FROM whatsapp_config WHERE id = 1`;
  const row = rows[0] as Record<string, unknown> | undefined;

  return {
    ...evolutionEnv(),
    enabled: Boolean(row?.enabled),
    testPhone: String(row?.test_phone ?? ''),
    appUrl: String(row?.app_url ?? ''),
    notifications: normalizeNotificationSettings(row?.notifications),
    updatedAt: row?.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
  };
}

export function connectionFromConfig(config: WhatsAppConfig): EvolutionConnection | null {
  if (!config.apiUrl || !config.apiKey || !config.instance) return null;
  return { apiUrl: config.apiUrl, apiKey: config.apiKey, instance: config.instance };
}

export interface WhatsAppConfigUpdate {
  enabled: boolean;
  testPhone: string;
  appUrl: string;
  notifications: NotificationSettings;
}

export async function saveWhatsAppConfig(update: WhatsAppConfigUpdate, updatedBy: string) {
  await ensureWhatsAppSchema();

  await sql`
    INSERT INTO whatsapp_config (id, enabled, test_phone, app_url, notifications, updated_at, updated_by)
    VALUES (1, ${update.enabled}, ${update.testPhone}, ${update.appUrl}, ${JSON.stringify(update.notifications)}::jsonb, NOW(), ${updatedBy})
    ON CONFLICT (id) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        test_phone = EXCLUDED.test_phone,
        app_url = EXCLUDED.app_url,
        notifications = EXCLUDED.notifications,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
  `;
}

/**
 * Atomically marks a scheduled job as run for `periodKey` (a day or a month). Returns false when
 * it already ran for that period — so the worker's 5-minute ticks and a manual run can't overlap.
 */
export async function claimJobRun(type: NotificationType, periodKey: string) {
  await ensureWhatsAppSchema();

  // Make sure the row exists, otherwise the UPDATE below has nothing to claim.
  await sql`INSERT INTO whatsapp_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;

  const rows = await sql`
    UPDATE whatsapp_config
    SET job_runs = jsonb_set(job_runs, ${`{${type}}`}::text[], to_jsonb(${periodKey}::text))
    WHERE id = 1 AND COALESCE(job_runs->>${type}, '') <> ${periodKey}
    RETURNING id
  `;

  return rows.length > 0;
}

export interface NewMessage {
  technicianId: string | null;
  technicianName: string | null;
  phone: string | null;
  type: NotificationType | 'test';
  trigger: MessageTrigger;
  dedupeKey: string | null;
  referenceDate: string | null;
  message: string;
  createdBy?: string | null;
}

/**
 * Inserts a pending row. Returns its id, or null when `dedupeKey` is already claimed — meaning
 * this exact notification was already sent (or is being sent right now).
 */
export async function claimMessage(message: NewMessage): Promise<string | null> {
  await ensureWhatsAppSchema();

  const id = randomUUID();
  const rows = await sql`
    INSERT INTO whatsapp_messages (
      id, technician_id, technician_name, phone, type, trigger_kind, dedupe_key, reference_date, message, status, created_by
    )
    VALUES (
      ${id}, ${message.technicianId}, ${message.technicianName}, ${message.phone}, ${message.type}, ${message.trigger},
      ${message.dedupeKey}, ${message.referenceDate}, ${message.message}, 'pending', ${message.createdBy ?? null}
    )
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id
  `;

  return rows.length ? id : null;
}

export async function finishMessage(
  id: string,
  result: { status: Exclude<MessageStatus, 'pending'>; error: string | null; phone: string | null; redirectedToTest: boolean },
) {
  // Only a successful send keeps its dedupe key: a failed or skipped notification must stay
  // retryable, by the next manual run or once the technician's phone number is fixed.
  await sql`
    UPDATE whatsapp_messages
    SET status = ${result.status},
        error = ${result.error},
        phone = ${result.phone},
        redirected_to_test = ${result.redirectedToTest},
        sent_at = CASE WHEN ${result.status} = 'sent' THEN NOW() ELSE NULL END,
        dedupe_key = CASE WHEN ${result.status} = 'sent' THEN dedupe_key ELSE NULL END
    WHERE id = ${id}
  `;
}
