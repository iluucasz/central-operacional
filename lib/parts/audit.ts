import { sql } from '../db';

export interface AuditEntry {
  actorId: string | null;
  actorRole: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

/**
 * Who did what in Controle de Peças. Best effort: a failed log write must never undo a sale or a
 * remittance that already happened.
 */
export async function recordAudit(entry: AuditEntry) {
  try {
    await sql`
      INSERT INTO parts_audit_log (actor_id, actor_role, action, target_type, target_id, details)
      VALUES (
        ${entry.actorId}, ${entry.actorRole}, ${entry.action}, ${entry.targetType ?? null}, ${entry.targetId ?? null},
        ${entry.details ? JSON.stringify(entry.details) : null}::jsonb
      )
    `;
  } catch (error) {
    console.error('[parts] audit:', error instanceof Error ? error.message : error);
  }
}
