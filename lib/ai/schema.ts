import { sql } from '../db';

let schemaReady: Promise<void> | null = null;

/**
 * The AI assistant's conversations (one list per admin) and messages. Each answer keeps its token
 * usage and cost in R$, which the monthly budget in Configurações is checked against.
 */
export function ensureAiSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS ai_conversations (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id      TEXT NOT NULL,
          title        TEXT NOT NULL,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          -- Hidden from the history list, kept in the database.
          archived_at  TIMESTAMPTZ
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS ai_conversations_user_idx ON ai_conversations (user_id, updated_at DESC)`;
      await sql`
        CREATE TABLE IF NOT EXISTS ai_messages (
          id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id    UUID NOT NULL REFERENCES ai_conversations (id),
          role               TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content            TEXT NOT NULL,
          -- Which data the assistant looked up to answer: [{ "name", "arguments" }].
          tools_used         JSONB,
          prompt_tokens      INTEGER,
          completion_tokens  INTEGER,
          -- What this answer cost, in R$, at the prices set in Configurações.
          cost               NUMERIC(12, 6),
          created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx ON ai_messages (conversation_id, created_at)`;
      await sql`CREATE INDEX IF NOT EXISTS ai_messages_created_idx ON ai_messages (created_at) WHERE role = 'assistant'`;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}
