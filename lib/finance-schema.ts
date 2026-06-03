import { sql } from './db';

let financeSchemaReady: Promise<void> | null = null;

export async function ensureFinanceSchema() {
  if (!financeSchemaReady) {
    financeSchemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS financial_entries (
          id TEXT PRIMARY KEY,
          type VARCHAR(16) NOT NULL CHECK (type IN ('payable', 'receivable')),
          description TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'Geral',
          amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
          due_date DATE NOT NULL,
          competence_month VARCHAR(7) NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
          paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
          paid_at DATE,
          series_id TEXT,
          installment_number INTEGER NOT NULL DEFAULT 1,
          installment_total INTEGER NOT NULL DEFAULT 1,
          is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        ALTER TABLE financial_entries
        ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0
      `;

      await sql`
        UPDATE financial_entries
        SET paid_amount = amount
        WHERE status = 'paid' AND paid_amount = 0
      `;

      await sql`
        ALTER TABLE financial_entries
        ADD COLUMN IF NOT EXISTS series_id TEXT
      `;

      await sql`
        ALTER TABLE financial_entries
        ADD COLUMN IF NOT EXISTS installment_number INTEGER NOT NULL DEFAULT 1
      `;

      await sql`
        ALTER TABLE financial_entries
        ADD COLUMN IF NOT EXISTS installment_total INTEGER NOT NULL DEFAULT 1
      `;

      await sql`
        ALTER TABLE financial_entries
        ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS financial_entries_competence_idx
        ON financial_entries (competence_month)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS financial_entries_due_date_idx
        ON financial_entries (due_date)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS financial_entries_series_idx
        ON financial_entries (series_id)
      `;
    })().catch((error) => {
      financeSchemaReady = null;
      throw error;
    });
  }

  return financeSchemaReady;
}
