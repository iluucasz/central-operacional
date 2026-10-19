import { sql } from './db';

let partsSchemaReady: Promise<void> | null = null;

/**
 * Controle de Peças: parts the company hands to technicians under consignment. Stock is never a
 * stored number — it is the sum of part_movements (insert-only). What a technician owes is the sum
 * of part_account_entries (insert-only too). See docs/controle-de-pecas.md.
 *
 * Technician and user ids are TEXT (no foreign key) to match the rest of the app, which stores them
 * as text; queries compare them through `::text`.
 */
export async function ensurePartsSchema() {
  if (!partsSchemaReady) {
    partsSchemaReady = (async () => {
      // One round trip, serialized: two cold starts creating the same tables at once would otherwise
      // collide on the catalog's unique constraints.
      await sql.transaction([
        sql`SELECT pg_advisory_xact_lock(hashtext('parts-schema'))`,

        // Stock guard used inside the transactions that take units out of a stock (see lib/parts/common.ts).
        sql`
          CREATE OR REPLACE FUNCTION parts_require_units(p_technician_id TEXT, p_part_id UUID, p_quantity INT)
          RETURNS VOID LANGUAGE plpgsql AS $fn$
          DECLARE
            have INT;
          BEGIN
            SELECT COALESCE(SUM(quantity), 0) INTO have
            FROM part_movements
            WHERE part_id = p_part_id AND technician_id IS NOT DISTINCT FROM p_technician_id;
            IF have < p_quantity THEN
              RAISE EXCEPTION 'insufficient stock' USING ERRCODE = 'P0409';
            END IF;
          END
          $fn$
        `,

        sql`
          CREATE TABLE IF NOT EXISTS parts (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name              TEXT NOT NULL,
            barcode           TEXT,
            sku               TEXT,
            category          TEXT,
            brand             TEXT,
            unit              TEXT NOT NULL DEFAULT 'un',
            description       TEXT,
            image_id          UUID,
            cost_price        NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
            technician_price  NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (technician_price >= 0),
            suggested_price   NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (suggested_price >= 0),
            min_stock         INTEGER CHECK (min_stock >= 0),
            active            BOOLEAN NOT NULL DEFAULT TRUE,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by        TEXT,
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at        TIMESTAMPTZ,
            deleted_by        TEXT
          )
        `,
        sql`CREATE INDEX IF NOT EXISTS parts_name_idx ON parts (name)`,
        sql`CREATE UNIQUE INDEX IF NOT EXISTS parts_barcode_idx ON parts (barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL`,

        sql`
          CREATE TABLE IF NOT EXISTS part_images (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            part_id       UUID NOT NULL REFERENCES parts (id),
            url           TEXT NOT NULL,
            content_type  TEXT NOT NULL,
            file_size     INTEGER NOT NULL CHECK (file_size >= 0),
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by    TEXT,
            replaced_at   TIMESTAMPTZ
          )
        `,
        sql`CREATE INDEX IF NOT EXISTS part_images_part_idx ON part_images (part_id, created_at DESC)`,

        // Remittances to a technician ('out') and returns ('return'), with the receipt the technician
        // confirms in the app: the trail that backs the consignment.
        sql`
          CREATE TABLE IF NOT EXISTS part_transfers (
            id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            number                   INTEGER NOT NULL,
            technician_id            TEXT NOT NULL,
            direction                TEXT NOT NULL CHECK (direction IN ('out', 'return')),
            total_technician_price   NUMERIC(12, 2) NOT NULL DEFAULT 0,
            total_cost               NUMERIC(12, 2) NOT NULL DEFAULT 0,
            note                     TEXT,
            created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by               TEXT,
            acknowledged_at          TIMESTAMPTZ,
            acknowledged_by          TEXT,
            acknowledged_ip          TEXT
          )
        `,
        sql`CREATE UNIQUE INDEX IF NOT EXISTS part_transfers_number_idx ON part_transfers (number)`,
        sql`CREATE INDEX IF NOT EXISTS part_transfers_technician_idx ON part_transfers (technician_id, created_at DESC)`,

        sql`
          CREATE TABLE IF NOT EXISTS part_sales (
            id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            number                   INTEGER NOT NULL,
            technician_id            TEXT NOT NULL,
            customer_name            TEXT,
            customer_phone           TEXT,
            order_code               TEXT,
            status                   TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment', 'paid', 'canceled')),
            payment_method           TEXT NOT NULL CHECK (payment_method IN ('pix', 'card_link', 'card_present', 'cash')),
            total_amount             NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
            total_technician_price   NUMERIC(12, 2) NOT NULL,
            total_cost               NUMERIC(12, 2) NOT NULL,
            mp_order_id              TEXT,
            mp_preference_id         TEXT,
            mp_payment_id            TEXT,
            mp_status                TEXT,
            payment_url              TEXT,
            pix_qr_code              TEXT,
            pix_qr_base64            TEXT,
            payment_expires_at       TIMESTAMPTZ,
            payment_attempts         INTEGER NOT NULL DEFAULT 0,
            payment_error            TEXT,
            paid_at                  TIMESTAMPTZ,
            payment_confirmed_by     TEXT CHECK (payment_confirmed_by IN ('mercadopago', 'technician')),
            payment_link_sent_at     TIMESTAMPTZ,
            receipt_sent_at          TIMESTAMPTZ,
            note                     TEXT,
            created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by               TEXT,
            canceled_at              TIMESTAMPTZ,
            canceled_by              TEXT,
            cancel_reason            TEXT
          )
        `,
        sql`CREATE UNIQUE INDEX IF NOT EXISTS part_sales_number_idx ON part_sales (number)`,
        sql`CREATE INDEX IF NOT EXISTS part_sales_technician_idx ON part_sales (technician_id, created_at DESC)`,
        sql`CREATE INDEX IF NOT EXISTS part_sales_status_idx ON part_sales (status, created_at DESC)`,
        // A Mercado Pago payment can settle only one sale.
        sql`CREATE UNIQUE INDEX IF NOT EXISTS part_sales_mp_payment_idx ON part_sales (mp_payment_id) WHERE mp_payment_id IS NOT NULL`,
        sql`CREATE INDEX IF NOT EXISTS part_sales_mp_order_idx ON part_sales (mp_order_id) WHERE mp_order_id IS NOT NULL`,

        sql`
          CREATE TABLE IF NOT EXISTS part_sale_items (
            id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            sale_id                UUID NOT NULL REFERENCES part_sales (id),
            part_id                UUID NOT NULL REFERENCES parts (id),
            part_name              TEXT NOT NULL,
            quantity               INTEGER NOT NULL CHECK (quantity > 0),
            unit_price             NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
            unit_technician_price  NUMERIC(12, 2) NOT NULL,
            unit_cost              NUMERIC(12, 2) NOT NULL
          )
        `,
        sql`CREATE INDEX IF NOT EXISTS part_sale_items_sale_idx ON part_sale_items (sale_id)`,

        // Stock counts of one technician's stock or of the central stock (technician_id NULL).
        sql`
          CREATE TABLE IF NOT EXISTS part_inventories (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            number           INTEGER NOT NULL,
            technician_id    TEXT,
            status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'canceled')),
            note             TEXT,
            started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            started_by       TEXT,
            closed_at        TIMESTAMPTZ,
            closed_by        TEXT,
            shortage_value   NUMERIC(12, 2),
            surplus_units    INTEGER
          )
        `,
        sql`CREATE UNIQUE INDEX IF NOT EXISTS part_inventories_number_idx ON part_inventories (number)`,
        sql`
          CREATE UNIQUE INDEX IF NOT EXISTS part_inventories_open_idx ON part_inventories ((COALESCE(technician_id, '')))
          WHERE status = 'open'
        `,

        sql`
          CREATE TABLE IF NOT EXISTS part_inventory_items (
            id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            inventory_id           UUID NOT NULL REFERENCES part_inventories (id),
            part_id                UUID NOT NULL REFERENCES parts (id),
            counted                INTEGER NOT NULL DEFAULT 0 CHECK (counted >= 0),
            expected               INTEGER,
            unit_technician_price  NUMERIC(12, 2),
            resolution             TEXT CHECK (resolution IN ('charge', 'absorb')),
            updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by             TEXT,
            UNIQUE (inventory_id, part_id)
          )
        `,

        // Debts of a technician for missing parts (or set by hand), paid in installments.
        sql`
          CREATE TABLE IF NOT EXISTS part_debts (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            number             INTEGER NOT NULL,
            technician_id      TEXT NOT NULL,
            inventory_id       UUID REFERENCES part_inventories (id),
            description        TEXT NOT NULL,
            total_amount       NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
            installments       INTEGER NOT NULL CHECK (installments BETWEEN 1 AND 48),
            first_due_month    VARCHAR(7) NOT NULL,
            status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
            created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by         TEXT,
            acknowledged_at    TIMESTAMPTZ,
            acknowledged_by    TEXT,
            acknowledged_ip    TEXT,
            canceled_at        TIMESTAMPTZ,
            canceled_by        TEXT,
            cancel_reason      TEXT
          )
        `,
        sql`CREATE UNIQUE INDEX IF NOT EXISTS part_debts_number_idx ON part_debts (number)`,

        // Every unit that enters or leaves a stock. technician_id NULL = the central stock.
        sql`
          CREATE TABLE IF NOT EXISTS part_movements (
            id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            part_id                UUID NOT NULL REFERENCES parts (id),
            technician_id          TEXT,
            quantity               INTEGER NOT NULL CHECK (quantity <> 0),
            kind                   TEXT NOT NULL CHECK (kind IN (
              'purchase', 'adjustment', 'transfer', 'sale', 'sale_canceled', 'inventory_shortage', 'inventory_surplus'
            )),
            unit_cost              NUMERIC(12, 2),
            unit_technician_price  NUMERIC(12, 2),
            transfer_id            UUID REFERENCES part_transfers (id),
            sale_id                UUID REFERENCES part_sales (id),
            inventory_id           UUID REFERENCES part_inventories (id),
            note                   TEXT,
            created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by             TEXT
          )
        `,
        sql`CREATE INDEX IF NOT EXISTS part_movements_stock_idx ON part_movements (technician_id, part_id)`,
        sql`CREATE INDEX IF NOT EXISTS part_movements_part_idx ON part_movements (part_id, created_at DESC)`,
        // A sale (or its cancellation) moves each part exactly once: a second cancel aborts its transaction.
        sql`CREATE UNIQUE INDEX IF NOT EXISTS part_movements_sale_idx ON part_movements (sale_id, part_id) WHERE kind = 'sale'`,
        sql`CREATE UNIQUE INDEX IF NOT EXISTS part_movements_sale_canceled_idx ON part_movements (sale_id, part_id) WHERE kind = 'sale_canceled'`,

        // amount > 0: the technician owes; < 0: paid or credited.
        sql`
          CREATE TABLE IF NOT EXISTS part_account_entries (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            technician_id   TEXT NOT NULL,
            kind            TEXT NOT NULL CHECK (kind IN ('sale', 'sale_canceled', 'debt_installment', 'debt_canceled', 'payment', 'adjustment')),
            amount          NUMERIC(12, 2) NOT NULL CHECK (amount <> 0),
            due_month       VARCHAR(7) NOT NULL,
            sale_id         UUID REFERENCES part_sales (id),
            debt_id         UUID REFERENCES part_debts (id),
            installment     INTEGER,
            payment_method  TEXT CHECK (payment_method IN ('pix', 'cash', 'transfer', 'deduction', 'other')),
            description     TEXT NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_by      TEXT
          )
        `,
        sql`CREATE INDEX IF NOT EXISTS part_account_entries_technician_idx ON part_account_entries (technician_id, due_month)`,
        sql`CREATE UNIQUE INDEX IF NOT EXISTS part_account_entries_sale_canceled_idx ON part_account_entries (sale_id) WHERE kind = 'sale_canceled'`,

        // Single row, same pattern as whatsapp_config.
        sql`
          CREATE TABLE IF NOT EXISTS parts_settings (
            id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            company_name      TEXT,
            payment_methods   TEXT[] NOT NULL DEFAULT ARRAY['pix', 'card_link', 'card_present', 'cash'],
            receipt_footer    TEXT,
            settlement_day    INTEGER NOT NULL DEFAULT 10 CHECK (settlement_day BETWEEN 1 AND 28),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by        TEXT
          )
        `,

        // Each technician's own Mercado Pago account, authorized through OAuth. Tokens are encrypted
        // (MERCADOPAGO_TOKEN_KEY) and never leave the server.
        sql`
          CREATE TABLE IF NOT EXISTS mercadopago_accounts (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            technician_id      TEXT NOT NULL,
            mp_user_id         TEXT NOT NULL,
            nickname           TEXT,
            email              TEXT,
            access_token_enc   TEXT NOT NULL,
            refresh_token_enc  TEXT,
            public_key         TEXT,
            live_mode          BOOLEAN,
            expires_at         TIMESTAMPTZ,
            terminal_id        TEXT,
            connected_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            refreshed_at       TIMESTAMPTZ,
            last_error         TEXT,
            disconnected_at    TIMESTAMPTZ,
            disconnected_by    TEXT
          )
        `,
        sql`CREATE UNIQUE INDEX IF NOT EXISTS mercadopago_accounts_active_idx ON mercadopago_accounts (technician_id) WHERE disconnected_at IS NULL`,
        sql`CREATE INDEX IF NOT EXISTS mercadopago_accounts_user_idx ON mercadopago_accounts (mp_user_id) WHERE disconnected_at IS NULL`,

        // OAuth in flight: the callback carries only the state, so the state says who started it.
        // Single use, valid for 15 minutes.
        sql`
          CREATE TABLE IF NOT EXISTS mercadopago_oauth_states (
            state          TEXT PRIMARY KEY,
            technician_id  TEXT NOT NULL,
            user_id        TEXT NOT NULL,
            code_verifier  TEXT NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            used_at        TIMESTAMPTZ
          )
        `,

        sql`
          CREATE TABLE IF NOT EXISTS mercadopago_webhook_events (
            id            BIGSERIAL PRIMARY KEY,
            received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            topic         TEXT,
            action        TEXT,
            resource_id   TEXT,
            mp_user_id    TEXT,
            live_mode     BOOLEAN,
            payload       JSONB NOT NULL,
            sale_id       UUID,
            processed_at  TIMESTAMPTZ,
            error         TEXT
          )
        `,
        sql`CREATE INDEX IF NOT EXISTS mercadopago_webhook_events_received_idx ON mercadopago_webhook_events (received_at DESC)`,

        sql`
          CREATE TABLE IF NOT EXISTS parts_audit_log (
            id           BIGSERIAL PRIMARY KEY,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            actor_id     TEXT,
            actor_role   TEXT,
            action       TEXT NOT NULL,
            target_type  TEXT,
            target_id    TEXT,
            details      JSONB
          )
        `,
        sql`CREATE INDEX IF NOT EXISTS parts_audit_log_created_idx ON parts_audit_log (created_at DESC)`,
      ]);
    })().catch((error) => {
      partsSchemaReady = null;
      throw error;
    });
  }

  return partsSchemaReady;
}
