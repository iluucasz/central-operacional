import { sql } from '../db';
import { currentMonth, isMonthKey, money } from './common';
import { partsOverview } from './overview';
import { addMonths } from './types';

/**
 * Financial view of Venda de Peças, for the company.
 *
 * Criteria (also in docs/controle-de-pecas.md):
 * - Sales count by the month they were made (Brasília time) and leave out canceled ones.
 * - "Faturamento" is what the technicians owe the company (their price), "vendido" is what the customers paid.
 * - "Custo" is the cost of the parts sold, copied into each sale item when it was made.
 * - "Recebido" is cash: payments registered in the technicians' accounts, by the day they were registered.
 * - "Compras" is cash out: units bought into the central stock × their unit cost.
 * - "Perdas" are the inventory shortages the company absorbs (central stock, or technician shortages it
 *   chose not to charge), at the part's current cost.
 * - The open balance and the stock are positions (a photo), not period flows.
 */

export type FinanceMode = 'month' | 'year';

interface Flow {
  sales: number;
  sold: number;
  revenue: number;
  cost: number;
  received: number;
  purchases: number;
  losses: number;
}

const emptyFlow = (): Flow => ({ sales: 0, sold: 0, revenue: 0, cost: 0, received: 0, purchases: 0, losses: 0 });

function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) months.push(month);
  return months;
}

function periodOf(mode: FinanceMode, value: string) {
  if (mode === 'year') {
    const year = Number(value);
    return { from: `${year}-01`, to: `${year}-12`, previous: { from: `${year - 1}-01`, to: `${year - 1}-12` }, series: { from: `${year}-01`, to: `${year}-12` } };
  }
  return { from: value, to: value, previous: { from: addMonths(value, -1), to: addMonths(value, -1) }, series: { from: addMonths(value, -11), to: value } };
}

function sumFlows(byMonth: Map<string, Flow>, from: string, to: string) {
  const total = emptyFlow();
  for (const month of monthsBetween(from, to)) {
    const flow = byMonth.get(month);
    if (!flow) continue;
    for (const key of Object.keys(total) as Array<keyof Flow>) total[key] += flow[key];
  }
  return total;
}

function derived(flow: Flow) {
  const profit = flow.revenue - flow.cost;
  return {
    sales: flow.sales,
    sold: money(flow.sold),
    revenue: money(flow.revenue),
    cost: money(flow.cost),
    profit: money(profit),
    margin: flow.revenue > 0 ? profit / flow.revenue : null,
    technicianGain: money(flow.sold - flow.revenue),
    averageTicket: flow.sales > 0 ? money(flow.sold / flow.sales) : 0,
    received: money(flow.received),
    purchases: money(flow.purchases),
    cashResult: money(flow.received - flow.purchases),
    losses: money(flow.losses),
  };
}

export async function partsFinance(input: { mode?: unknown; month?: unknown; year?: unknown }) {
  const mode: FinanceMode = input.mode === 'year' ? 'year' : 'month';
  const now = currentMonth();
  const value =
    mode === 'year'
      ? /^\d{4}$/.test(String(input.year)) ? String(input.year) : now.slice(0, 4)
      : isMonthKey(input.month) ? input.month : now;
  const period = periodOf(mode, value);

  const start = [period.previous.from, period.series.from].sort()[0];
  const end = period.to;
  // The open balance is as of the end of the period, but never counts installments of months still to come.
  const asOf = period.to < now ? period.to : now;

  const [salesRows, paymentRows, purchaseRows, lossRows, technicianRows, partRows, position] = await Promise.all([
    sql`
      SELECT to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        COUNT(*)::int AS sales, COALESCE(SUM(total_amount), 0) AS sold,
        COALESCE(SUM(total_technician_price), 0) AS revenue, COALESCE(SUM(total_cost), 0) AS cost
      FROM part_sales
      WHERE status <> 'canceled'
        AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${start} AND ${end}
      GROUP BY 1
    `,
    sql`
      SELECT to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        COALESCE(payment_method, 'other') AS method, COALESCE(-SUM(amount), 0) AS amount
      FROM part_account_entries
      WHERE kind = 'payment'
        AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${start} AND ${end}
      GROUP BY 1, 2
    `,
    sql`
      SELECT to_char(m.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        COALESCE(SUM(m.quantity * COALESCE(m.unit_cost, p.cost_price)), 0) AS amount
      FROM part_movements m JOIN parts p ON p.id = m.part_id
      WHERE m.kind = 'purchase'
        AND to_char(m.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${start} AND ${end}
      GROUP BY 1
    `,
    sql`
      SELECT to_char(i.closed_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        COALESCE(SUM(GREATEST(ii.expected - ii.counted, 0) * p.cost_price), 0) AS amount
      FROM part_inventory_items ii
      JOIN part_inventories i ON i.id = ii.inventory_id
      JOIN parts p ON p.id = ii.part_id
      WHERE i.status = 'closed' AND (i.technician_id IS NULL OR ii.resolution = 'absorb')
        AND to_char(i.closed_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${start} AND ${end}
      GROUP BY 1
    `,
    sql`
      WITH sales AS (
        SELECT technician_id, SUM(total_technician_price) AS revenue, SUM(total_amount) AS sold
        FROM part_sales
        WHERE status <> 'canceled'
          AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${period.from} AND ${period.to}
        GROUP BY technician_id
      ), pay AS (
        SELECT technician_id, -SUM(amount) AS received
        FROM part_account_entries
        WHERE kind = 'payment'
          AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${period.from} AND ${period.to}
        GROUP BY technician_id
      ), bal AS (
        SELECT technician_id, SUM(amount) AS due FROM part_account_entries WHERE due_month <= ${asOf} GROUP BY technician_id
      )
      SELECT t.id::text AS id, t.name,
        COALESCE(sales.revenue, 0) AS revenue, COALESCE(sales.sold, 0) AS sold,
        COALESCE(pay.received, 0) AS received, COALESCE(bal.due, 0) AS due
      FROM technicians t
      LEFT JOIN sales ON sales.technician_id = t.id::text
      LEFT JOIN pay ON pay.technician_id = t.id::text
      LEFT JOIN bal ON bal.technician_id = t.id::text
      WHERE sales.technician_id IS NOT NULL OR pay.technician_id IS NOT NULL OR COALESCE(bal.due, 0) <> 0
      ORDER BY COALESCE(sales.revenue, 0) DESC, t.name
    `,
    sql`
      SELECT i.part_id::text AS id, MAX(i.part_name) AS name, SUM(i.quantity)::int AS units,
        SUM(i.quantity * i.unit_technician_price) AS revenue,
        SUM(i.quantity * (i.unit_technician_price - i.unit_cost)) AS profit
      FROM part_sale_items i JOIN part_sales s ON s.id = i.sale_id
      WHERE s.status <> 'canceled'
        AND to_char(s.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${period.from} AND ${period.to}
      GROUP BY i.part_id
      ORDER BY profit DESC
      LIMIT 8
    `,
    partsOverview(now),
  ]);

  const byMonth = new Map<string, Flow>();
  const flowOf = (month: string) => {
    let flow = byMonth.get(month);
    if (!flow) byMonth.set(month, (flow = emptyFlow()));
    return flow;
  };
  for (const row of salesRows) {
    const flow = flowOf(String(row.month));
    flow.sales += Number(row.sales);
    flow.sold += Number(row.sold);
    flow.revenue += Number(row.revenue);
    flow.cost += Number(row.cost);
  }
  for (const row of paymentRows) flowOf(String(row.month)).received += Number(row.amount);
  for (const row of purchaseRows) flowOf(String(row.month)).purchases += Number(row.amount);
  for (const row of lossRows) flowOf(String(row.month)).losses += Number(row.amount);

  // How the company was paid in the period: Pix, cash, transfer, and everything else together.
  const methodTotals = new Map<string, number>();
  for (const row of paymentRows) {
    const month = String(row.month);
    if (month < period.from || month > period.to) continue;
    const method = ['pix', 'cash', 'transfer'].includes(String(row.method)) ? String(row.method) : 'other';
    methodTotals.set(method, (methodTotals.get(method) ?? 0) + Number(row.amount));
  }

  const technicians = technicianRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    revenue: money(row.revenue),
    sold: money(row.sold),
    received: money(row.received),
    balanceDue: money(row.due),
  }));

  return {
    mode,
    value,
    period: { from: period.from, to: period.to },
    previousPeriod: period.previous,
    asOf,
    current: derived(sumFlows(byMonth, period.from, period.to)),
    previous: derived(sumFlows(byMonth, period.previous.from, period.previous.to)),
    position: {
      balanceDue: money(technicians.reduce((sum, technician) => sum + Math.max(0, technician.balanceDue), 0)),
      centralUnits: position.centralUnits,
      centralCost: position.centralCost,
      technicianUnits: position.technicianUnits,
      technicianCost: position.technicianCost,
      technicianValue: position.technicianValue,
    },
    series: monthsBetween(period.series.from, period.series.to).map((month) => {
      const flow = byMonth.get(month) ?? emptyFlow();
      return {
        month,
        sold: money(flow.sold),
        revenue: money(flow.revenue),
        cost: money(flow.cost),
        profit: money(flow.revenue - flow.cost),
        received: money(flow.received),
        purchases: money(flow.purchases),
      };
    }),
    technicians,
    topParts: partRows.map((row) => ({ id: String(row.id), name: String(row.name), units: Number(row.units), revenue: money(row.revenue), profit: money(row.profit) })),
    receivedByMethod: (['pix', 'cash', 'transfer', 'other'] as const)
      .map((method) => ({ method, amount: money(methodTotals.get(method) ?? 0) }))
      .filter((item) => item.amount > 0),
  };
}

export type FinanceReport = Awaited<ReturnType<typeof partsFinance>>;
