'use client';

import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Banknote, Boxes, Coins, Download, PackagePlus, Receipt, ShoppingCart, TrendingUp, TriangleAlert, Truck, Wallet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatPercent } from '@/lib/formatters';
import type { FinanceReport } from '@/lib/parts/finance';
import { formatMonthLabel } from '@/lib/parts/types';
import { Alert, currentMonthKey, inputClass, Spinner, useParts } from '../shared';

/**
 * Role-based hues, validated for color-blind separation: money in = purple, money out = amber,
 * result = teal, an open balance / alert = rose, "other" = neutral gray. Same role, same hue, in every chart.
 */
const C = { income: '#7161ef', expense: '#d98a2b', result: '#34b6aa', alert: '#c2527a', other: '#66889a' };

const axis = { tickLine: false, axisLine: false, tick: { fill: '#8a8b9b', fontSize: 11 }, minTickGap: 12 };
const tooltipStyle = { border: '1px solid #eeedf4', borderRadius: 12, boxShadow: '0 8px 30px #25233d12', fontSize: 12, color: '#252337' };
const compact = (value: number) => value.toLocaleString('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const money = (value: unknown) => formatCurrency(Number(value));

const METHOD_LABELS = { pix: 'Pix', cash: 'Dinheiro', transfer: 'Transferência', other: 'Outros' } as const;
const METHOD_COLORS = { pix: C.income, cash: C.result, transfer: C.expense, other: C.other } as const;

function shortMonth(month: string) {
  const [year, number] = month.split('-').map(Number);
  const name = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, number - 1, 1))).replace('.', '');
  return `${name}/${String(year).slice(2)}`;
}

/** Percent change against the previous period; null when there is nothing to compare with. */
function change(current: number, previous: number) {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ---------------------------------------------------------------- pieces

/** `up-bad` for what should shrink (losses); `neutral` for spending, where more is not good or bad by itself. */
function Delta({ value, kind = 'up-good', label }: { value: number | null; kind?: 'up-good' | 'up-bad' | 'neutral'; label: string }) {
  if (value === null) return <span className="text-xs text-muted-foreground">sem base {label}</span>;
  if (Math.abs(value) < 0.05) return <span className="text-xs text-muted-foreground">igual {label}</span>;
  const up = value > 0;
  const color = kind === 'neutral' ? 'text-foreground/70' : (kind === 'up-good') === up ? 'text-emerald-700' : 'text-rose-700';
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {up ? '+' : '−'}
      {formatPercent(Math.abs(value))} <span className="font-normal text-muted-foreground">{label}</span>
    </span>
  );
}

function Tile({ label, value, hint, icon: Icon, delta, tone }: { label: string; value: string; hint?: string; icon: typeof Wallet; delta?: React.ReactNode; tone?: 'danger' | 'success' }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${tone === 'danger' ? 'text-rose-700' : tone === 'success' ? 'text-emerald-700' : ''}`}>{value}</p>
      <div className="mt-1 grid gap-0.5">
        {delta}
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** A chart with a title, an optional legend and a "Tabela" view with the same numbers (no color-only reading). */
function ChartCard({
  title,
  description,
  legend,
  columns,
  rows,
  empty,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  legend?: Array<{ label: string; color: string }>;
  columns: string[];
  rows: Array<Array<string | number>>;
  empty: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={`grid content-start gap-3 rounded-xl border bg-card p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {!empty ? (
          <div className="flex shrink-0 rounded-lg bg-muted p-0.5 text-xs" role="group" aria-label="Forma de exibição">
            {(['chart', 'table'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                aria-pressed={view === value}
                className={`rounded-md px-2.5 py-1 font-medium transition ${view === value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}
              >
                {value === 'chart' ? 'Gráfico' : 'Tabela'}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {empty ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Sem dados no período.</p>
      ) : view === 'chart' ? (
        <>
          {legend && legend.length > 1 ? <Legend items={legend} /> : null}
          {children}
        </>
      ) : (
        <div className="max-h-80 overflow-auto rounded-lg border">
          <table className="w-full min-w-max text-sm">
            <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                {columns.map((column, index) => (
                  <th key={column} className={`px-3 py-2 font-medium ${index ? 'text-right' : ''}`}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t">
                  {row.map((cell, index) => (
                    <td key={index} className={`px-3 py-2 ${index ? 'text-right tabular-nums' : 'font-medium'}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- tab

export function FinanceTab() {
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [month, setMonth] = useState(currentMonthKey());
  const [year, setYear] = useState(currentMonthKey().slice(0, 4));
  const { data, error, loading } = useParts<{ report: FinanceReport }>(
    mode === 'year' ? `/api/parts/finance?mode=year&year=${year}` : `/api/parts/finance?mode=month&month=${month}`,
  );
  const report = data?.report;
  const years = Array.from({ length: 5 }, (_, index) => String(Number(currentMonthKey().slice(0, 4)) - index));
  const versus = mode === 'year' ? 'ano anterior' : 'mês anterior';
  const periodLabel = mode === 'year' ? year : formatMonthLabel(month);

  function exportSheet() {
    if (!report) return;
    const { current, previous, position } = report;
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet([
        { Indicador: 'Faturamento (a receber dos técnicos)', Período: current.revenue, 'Período anterior': previous.revenue },
        { Indicador: 'Custo das peças vendidas', Período: current.cost, 'Período anterior': previous.cost },
        { Indicador: 'Lucro bruto', Período: current.profit, 'Período anterior': previous.profit },
        { Indicador: 'Vendido aos clientes', Período: current.sold, 'Período anterior': previous.sold },
        { Indicador: 'Ganho dos técnicos', Período: current.technicianGain, 'Período anterior': previous.technicianGain },
        { Indicador: 'Recebido dos técnicos', Período: current.received, 'Período anterior': previous.received },
        { Indicador: 'Compras (saída de caixa)', Período: current.purchases, 'Período anterior': previous.purchases },
        { Indicador: 'Resultado de caixa', Período: current.cashResult, 'Período anterior': previous.cashResult },
        { Indicador: 'Perdas por faltas assumidas', Período: current.losses, 'Período anterior': previous.losses },
        { Indicador: 'Saldo em aberto (posição)', Período: position.balanceDue },
        { Indicador: 'Estoque central (custo)', Período: position.centralCost },
        { Indicador: 'Estoque com técnicos (custo)', Período: position.technicianCost },
        { Indicador: 'Estoque com técnicos (preço de técnico)', Período: position.technicianValue },
      ]),
      'Resumo',
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(report.series.map((item) => ({ Mês: item.month, Faturamento: item.revenue, Custo: item.cost, Lucro: item.profit, 'Vendido aos clientes': item.sold, Recebido: item.received, Compras: item.purchases }))),
      'Mensal',
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(report.technicians.map((item) => ({ Técnico: item.name, Faturamento: item.revenue, 'Vendido aos clientes': item.sold, Recebido: item.received, 'Saldo em aberto': item.balanceDue }))),
      'Técnicos',
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(report.topParts.map((item) => ({ Peça: item.name, Unidades: item.units, Faturamento: item.revenue, Lucro: item.profit }))),
      'Peças',
    );
    XLSX.writeFile(book, `financeiro-pecas-${mode === 'year' ? year : month}.xlsx`);
  }

  const series = report?.series ?? [];
  const technicianChart = (report?.technicians ?? [])
    .filter((item) => item.revenue > 0 || item.balanceDue > 0)
    .slice(0, 8)
    .map((item) => ({ name: item.name.split(' ').slice(0, 2).join(' '), full: item.name, revenue: item.revenue, open: Math.max(0, item.balanceDue) }));
  const methodTotal = (report?.receivedByMethod ?? []).reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg bg-muted p-1" role="group" aria-label="Período">
            {([['month', 'Mensal'], ['year', 'Anual']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={`min-h-9 rounded-md px-4 text-sm font-medium transition ${mode === value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === 'month' ? (
            <input type="month" className={inputClass('h-11 w-auto text-base sm:text-sm')} value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} aria-label="Mês" />
          ) : (
            <select className={inputClass('h-11 w-auto text-base sm:text-sm')} value={year} onChange={(event) => setYear(event.target.value)} aria-label="Ano">
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          )}
        </div>
        <Button variant="outline" size="lg" onClick={exportSheet} disabled={!report}>
          <Download className="h-4 w-4" />
          Exportar planilha
        </Button>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {!report ? (
        loading ? <Spinner /> : null
      ) : (
        <>
          <p className="-mt-3 text-sm text-muted-foreground">
            Resultado de <strong className="text-foreground">{periodLabel}</strong>, comparado com o {versus}.
          </p>

          <Group title="Resultado das vendas">
            <Tile
              label="Faturamento"
              value={formatCurrency(report.current.revenue)}
              hint="O que os técnicos devem à empresa"
              icon={Receipt}
              delta={<Delta value={change(report.current.revenue, report.previous.revenue)} label={versus} />}
            />
            <Tile
              label="Lucro bruto"
              value={formatCurrency(report.current.profit)}
              hint={report.current.margin === null ? 'Faturamento − custo das peças' : `Margem de ${formatPercent(report.current.margin * 100)}`}
              icon={TrendingUp}
              tone={report.current.profit < 0 ? 'danger' : undefined}
              delta={<Delta value={change(report.current.profit, report.previous.profit)} label={versus} />}
            />
            <Tile
              label="Vendido aos clientes"
              value={formatCurrency(report.current.sold)}
              hint={`${report.current.sales} venda(s) · ticket ${formatCurrency(report.current.averageTicket)}`}
              icon={ShoppingCart}
              delta={<Delta value={change(report.current.sold, report.previous.sold)} label={versus} />}
            />
            <Tile
              label="Custo das peças vendidas"
              value={formatCurrency(report.current.cost)}
              hint={`Ficam com os técnicos: ${formatCurrency(report.current.technicianGain)}`}
              icon={Coins}
              delta={<Delta value={change(report.current.cost, report.previous.cost)} kind="neutral" label={versus} />}
            />
          </Group>

          <Group title="Caixa do período">
            <Tile
              label="Recebido dos técnicos"
              value={formatCurrency(report.current.received)}
              hint="Pagamentos registrados no Acerto"
              icon={Banknote}
              delta={<Delta value={change(report.current.received, report.previous.received)} label={versus} />}
            />
            <Tile
              label="Compras de peças"
              value={formatCurrency(report.current.purchases)}
              hint="Entradas no estoque central"
              icon={PackagePlus}
              delta={<Delta value={change(report.current.purchases, report.previous.purchases)} kind="neutral" label={versus} />}
            />
            <Tile
              label="Resultado de caixa"
              value={formatCurrency(report.current.cashResult)}
              hint="Recebido − compras"
              icon={Wallet}
              tone={report.current.cashResult < 0 ? 'danger' : undefined}
              delta={<Delta value={change(report.current.cashResult, report.previous.cashResult)} label={versus} />}
            />
            <Tile
              label="Perdas por faltas"
              value={formatCurrency(report.current.losses)}
              hint="Faltas de inventário que a empresa assumiu"
              icon={TriangleAlert}
              tone={report.current.losses > 0 ? 'danger' : undefined}
              delta={<Delta value={change(report.current.losses, report.previous.losses)} kind="up-bad" label={versus} />}
            />
          </Group>

          <Group title={`Posição em ${report.asOf === report.period.to ? shortMonth(report.asOf) : 'hoje'}`}>
            <Tile label="Saldo em aberto" value={formatCurrency(report.position.balanceDue)} hint="Que os técnicos ainda devem" icon={Wallet} tone={report.position.balanceDue > 0 ? 'danger' : 'success'} />
            <Tile label="Estoque central" value={formatCurrency(report.position.centralCost)} hint={`${report.position.centralUnits} un. a preço de custo`} icon={Boxes} />
            <Tile label="Com os técnicos (custo)" value={formatCurrency(report.position.technicianCost)} hint={`${report.position.technicianUnits} un. em consignação`} icon={Truck} />
            <Tile label="Com os técnicos (a receber)" value={formatCurrency(report.position.technicianValue)} hint="Se tudo for vendido, a preço de técnico" icon={Coins} />
          </Group>

          <ChartCard
            title="Evolução do resultado"
            description={mode === 'year' ? `Mês a mês em ${year}` : 'Últimos 12 meses'}
            legend={[
              { label: 'Faturamento', color: C.income },
              { label: 'Custo das peças', color: C.expense },
              { label: 'Lucro bruto', color: C.result },
            ]}
            columns={['Mês', 'Faturamento', 'Custo', 'Lucro']}
            rows={series.map((item) => [shortMonth(item.month), money(item.revenue), money(item.cost), money(item.profit)])}
            empty={!series.some((item) => item.revenue || item.cost)}
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series.map((item) => ({ ...item, label: shortMonth(item.month) }))} margin={{ top: 12, right: 8, left: 0, bottom: 5 }} accessibilityLayer>
                  <defs>
                    <linearGradient id="fin-income-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.income} stopOpacity={0.17} />
                      <stop offset="100%" stopColor={C.income} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#eeedf4" strokeDasharray="4 5" vertical={false} />
                  <XAxis dataKey="label" {...axis} dy={8} />
                  <YAxis {...axis} tickFormatter={compact} width={64} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(value)} />
                  <ReferenceLine y={0} stroke="#dedde9" />
                  <Area type="monotone" dataKey="revenue" name="Faturamento" stroke={C.income} strokeWidth={2.5} fill="url(#fin-income-fill)" dot={{ r: 4, stroke: '#fff', strokeWidth: 2, fill: C.income }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="cost" name="Custo das peças" stroke={C.expense} strokeWidth={2} dot={{ r: 4, stroke: '#fff', strokeWidth: 2, fill: C.expense }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="profit" name="Lucro bruto" stroke={C.result} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4, stroke: '#fff', strokeWidth: 2, fill: C.result }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Entradas e saídas de caixa"
              description="O que os técnicos pagaram e o que a empresa gastou em compras"
              legend={[
                { label: 'Recebido dos técnicos', color: C.income },
                { label: 'Compras de peças', color: C.expense },
              ]}
              columns={['Mês', 'Recebido', 'Compras', 'Resultado']}
              rows={series.map((item) => [shortMonth(item.month), money(item.received), money(item.purchases), money(item.received - item.purchases)])}
              empty={!series.some((item) => item.received || item.purchases)}
            >
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series.map((item) => ({ ...item, label: shortMonth(item.month) }))} margin={{ top: 8, right: 8, left: 0, bottom: 5 }} barGap={2} accessibilityLayer>
                    <CartesianGrid stroke="#eeedf4" strokeDasharray="4 5" vertical={false} />
                    <XAxis dataKey="label" {...axis} dy={8} />
                    <YAxis {...axis} tickFormatter={compact} width={64} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(value)} cursor={{ fill: '#f4f3fa' }} />
                    <ReferenceLine y={0} stroke="#dedde9" />
                    <Bar dataKey="received" name="Recebido dos técnicos" fill={C.income} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
                    <Bar dataKey="purchases" name="Compras de peças" fill={C.expense} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard
              title="Como os técnicos pagaram"
              description={`Recebido em ${periodLabel}, por forma de pagamento`}
              columns={['Forma', 'Valor', '%']}
              rows={(report.receivedByMethod ?? []).map((item) => [METHOD_LABELS[item.method], money(item.amount), formatPercent((item.amount / (methodTotal || 1)) * 100)])}
              empty={!methodTotal}
            >
              <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="relative mx-auto h-52 w-full max-w-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={report.receivedByMethod} dataKey="amount" nameKey="method" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
                        {report.receivedByMethod.map((item) => (
                          <Cell key={item.method} fill={METHOD_COLORS[item.method]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(value, _name, entry) => [money(value), METHOD_LABELS[(entry?.payload?.method ?? 'other') as keyof typeof METHOD_LABELS]]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
                    <p className="text-xs text-muted-foreground">Total</p>
                    <p className="text-base font-semibold tabular-nums">{formatCurrency(methodTotal)}</p>
                  </div>
                </div>
                <ul className="grid gap-2 text-sm">
                  {report.receivedByMethod.map((item) => (
                    <li key={item.method} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: METHOD_COLORS[item.method] }} aria-hidden="true" />
                        {METHOD_LABELS[item.method]}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatCurrency(item.amount)} · {formatPercent((item.amount / (methodTotal || 1)) * 100)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Técnicos: faturamento e saldo em aberto"
              description="Os 8 que mais faturaram no período"
              legend={[
                { label: 'Faturamento do período', color: C.income },
                { label: 'Saldo em aberto', color: C.alert },
              ]}
              columns={['Técnico', 'Faturamento', 'Saldo em aberto']}
              rows={technicianChart.map((item) => [item.full, money(item.revenue), money(item.open)])}
              empty={!technicianChart.length}
            >
              <div style={{ height: Math.max(220, technicianChart.length * 52 + 30) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={technicianChart} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }} barGap={2} accessibilityLayer>
                    <CartesianGrid stroke="#eeedf4" strokeDasharray="4 5" horizontal={false} />
                    <XAxis type="number" {...axis} tickFormatter={compact} />
                    <YAxis type="category" dataKey="name" {...axis} width={96} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(value)} labelFormatter={(label, items) => items?.[0]?.payload?.full ?? label} cursor={{ fill: '#f4f3fa' }} />
                    <Bar dataKey="revenue" name="Faturamento do período" fill={C.income} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
                    <Bar dataKey="open" name="Saldo em aberto" fill={C.alert} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard
              title="Peças que mais deram lucro"
              description="Lucro da empresa por peça vendida no período"
              columns={['Peça', 'Unidades', 'Faturamento', 'Lucro']}
              rows={report.topParts.map((item) => [item.name, item.units, money(item.revenue), money(item.profit)])}
              empty={!report.topParts.length}
            >
              <div style={{ height: Math.max(220, report.topParts.length * 40 + 30) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.topParts.map((item) => ({ ...item, short: item.name.length > 16 ? `${item.name.slice(0, 15)}…` : item.name }))} layout="vertical" margin={{ top: 4, right: 64, left: 0, bottom: 4 }} accessibilityLayer>
                    <CartesianGrid stroke="#eeedf4" strokeDasharray="4 5" horizontal={false} />
                    <XAxis type="number" {...axis} tickFormatter={compact} />
                    <YAxis type="category" dataKey="short" {...axis} width={96} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(value)} labelFormatter={(label, items) => items?.[0]?.payload?.name ?? label} cursor={{ fill: '#f4f3fa' }} />
                    <Bar dataKey="profit" name="Lucro da empresa" fill={C.result} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
                      <LabelList dataKey="profit" position="right" formatter={(value: unknown) => money(value)} style={{ fill: '#252337', fontSize: 11 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>

          <section className="grid gap-3 rounded-xl border bg-card p-4 sm:p-5">
            <h3 className="text-sm font-semibold">Por técnico em {periodLabel}</h3>
            {!report.technicians.length ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum técnico com movimento.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-150 text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3 font-medium">Técnico</th>
                      <th className="py-2 pr-3 text-right font-medium">Vendido aos clientes</th>
                      <th className="py-2 pr-3 text-right font-medium">Faturamento</th>
                      <th className="py-2 pr-3 text-right font-medium">Recebido</th>
                      <th className="py-2 text-right font-medium">Saldo em aberto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.technicians.map((item) => (
                      <tr key={item.id} className="border-b last:border-0">
                        <td className="py-2.5 pr-3 font-medium">{item.name}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{formatCurrency(item.sold)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{formatCurrency(item.revenue)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{formatCurrency(item.received)}</td>
                        <td className={`py-2.5 text-right font-semibold tabular-nums ${item.balanceDue > 0 ? 'text-rose-700' : ''}`}>{formatCurrency(item.balanceDue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <details className="rounded-xl border bg-card px-4 py-3.5 text-sm">
            <summary className="cursor-pointer select-none font-medium">Como os números são calculados</summary>
            <ul className="mt-3 grid gap-1.5 text-muted-foreground">
              <li>
                <strong className="text-foreground">Vendas</strong> contam pelo mês em que foram feitas, sem as canceladas.
              </li>
              <li>
                <strong className="text-foreground">Faturamento</strong> é o preço de técnico: o que os técnicos devem à empresa. <strong className="text-foreground">Vendido aos clientes</strong> é o que o cliente pagou; a diferença fica com o técnico.
              </li>
              <li>
                <strong className="text-foreground">Lucro bruto</strong> = faturamento − custo das peças vendidas (o custo de cada venda fica guardado no momento da venda).
              </li>
              <li>
                <strong className="text-foreground">Recebido</strong> são os pagamentos registrados no Acerto, no dia do registro. <strong className="text-foreground">Compras</strong> são as entradas no estoque central × o custo de cada uma.
              </li>
              <li>
                <strong className="text-foreground">Perdas</strong> são as faltas de inventário que a empresa assumiu (estoque central, ou faltas que ela decidiu não cobrar), pelo custo atual da peça.
              </li>
              <li>
                <strong className="text-foreground">Saldo em aberto</strong> e <strong className="text-foreground">estoque</strong> são uma posição, não um total do período. Parcelas de meses futuros não entram no saldo.
              </li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
