import { sql } from './db';

let librarySchemaReady: Promise<void> | null = null;

export async function ensureLibrarySchema() {
  if (!librarySchemaReady) {
    librarySchemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS library_documents (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'Não classificado',
          audience TEXT NOT NULL DEFAULT 'Global',
          type TEXT NOT NULL DEFAULT 'PDF',
          url TEXT,
          technician_id TEXT,
          file_name TEXT,
          file_size BIGINT,
          uploaded_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        ALTER TABLE library_documents
        ADD COLUMN IF NOT EXISTS technician_id TEXT
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS library_documents_audience_idx
        ON library_documents (audience)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS library_documents_technician_idx
        ON library_documents (technician_id)
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS library_documents_updated_at_idx
        ON library_documents (updated_at DESC)
      `;
    })().catch((error) => {
      librarySchemaReady = null;
      throw error;
    });
  }

  return librarySchemaReady;
}
