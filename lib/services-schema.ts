import { sql } from './db';

let servicesSchemaReady: Promise<void> | null = null;

export async function ensureServicesSchema() {
  if (!servicesSchemaReady) {
    servicesSchemaReady = (async () => {
      await sql`
        ALTER TABLE services
        DROP CONSTRAINT IF EXISTS services_order_code_key
      `;

      await sql`
        ALTER TABLE services
        ADD COLUMN IF NOT EXISTS time_performed TIME
      `;

      await sql`
        ALTER TABLE services
        ADD COLUMN IF NOT EXISTS fortnight_period VARCHAR(2)
      `;
    })().catch((error) => {
      servicesSchemaReady = null;
      throw error;
    });
  }

  return servicesSchemaReady;
}
