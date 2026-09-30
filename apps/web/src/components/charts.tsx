import type { ReactNode } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * Chart conventions (see the dataviz guidance): one y-axis, thin marks (bars ≤ 24px with a 4px
 * rounded end, 2px lines), 2px gaps between bars, hairline solid gridlines, a legend whenever
 * there are two or more series, and a hover tooltip on every chart. Series colours come from the
 * validated --series-* tokens; text always uses text colours.
 */

const axisTick = { fill: 'var(--muted-foreground)', fontSize: 11 };

/**
 * Charts plot whole currency units (rupees, not paisa) so the axis picks round ticks such as
 * 50K / 1L; tooltips still show exact amounts from the original data.
 */
/** Round axis ticks (steps of 1, 2, 2.5 or 5 × 10ⁿ) covering 0…max, at most count+1 ticks. */
export function niceTicks(max: number, count = 4): { ticks: number[]; top: number } {
  if (!(max > 0)) return { ticks: [0, 1], top: 1 };
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { ticks, top };
}

/** Like niceTicks, for data that can go below zero. */
export function niceRange(min: number, max: number, count = 4) {
  const span = Math.max(max, 0) - Math.min(min, 0);
  const { ticks } = niceTicks(span || 1, count);
  const step = ticks[1] ?? 1;
  const lo = Math.floor(Math.min(min, 0) / step) * step;
  const hi = Math.ceil(Math.max(max, 0) / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return { ticks: out, domain: [lo, hi] as [number, number] };
}

function useMajorUnits() {
  const f = useFormat();
  const unit = 10 ** f.digits();
  return {
    f,
    major: (minor: number | null) => (minor === null ? null : minor / unit),
    tick: (value: number) => f.compact(Math.round(value * unit)).replace(/^(-?)Rs\. /, '$1'),
  };
}

export interface LegendItem {
  label: string;
  color: string;
  kind?: 'swatch' | 'line';
}

export function ChartLegend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground',
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.kind === 'line' ? (
            <span
              className="h-0.5 w-3.5 rounded-full"
              style={{ backgroundColor: item.color }}
              aria-hidden
            />
          ) : (
            <span
              className="size-2.5 rounded-[3px]"
              style={{ backgroundColor: item.color }}
              aria-hidden
            />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function TooltipCard({
  title,
  rows,
}: {
  title: ReactNode;
  rows: Array<{ label: string; color: string; value: string }>;
}) {
  return (
    <div className="min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-foreground">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 py-0.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: r.color }} />
          <span className="text-muted-foreground">{r.label}</span>
          <span className="ml-auto pl-3 font-medium text-foreground tabular">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Spending pace: cumulative spending this period vs an even pace to the budget
// ---------------------------------------------------------------------------------------------

export interface PacePoint {
  date: string;
  label: string;
  spent: number | null;
  pace: number | null;
}

export function PaceChart({
  data,
  height = 200,
  paceLabel,
}: {
  data: PacePoint[];
  height?: number;
  paceLabel: string;
}) {
  const { f, major, tick } = useMajorUnits();
  const scale = niceTicks(
    Math.max(0, ...data.flatMap((d) => [major(d.spent) ?? 0, major(d.pace) ?? 0])),
  );
  return (
    <div role="img" aria-label="Cumulative spending this month compared with an even pace">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="pace-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="label"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-axis)' }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={tick}
            ticks={scale.ticks}
            domain={[0, scale.top]}
          />
          <Tooltip
            cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }}
            content={(props) => {
              const p = props.payload?.[0]?.payload as PacePoint | undefined;
              if (!props.active || !p) return null;
              const rows = [];
              if (p.spent !== null)
                rows.push({
                  label: 'Spent so far',
                  color: 'var(--series-1)',
                  value: f.money(p.spent),
                });
              if (p.pace !== null)
                rows.push({
                  label: paceLabel,
                  color: 'var(--chart-reference)',
                  value: f.money(p.pace),
                });
              return <TooltipCard title={f.date(p.date, 'medium')} rows={rows} />;
            }}
          />
          <Area
            type="monotone"
            dataKey={(d: PacePoint) => major(d.spent)}
            stroke="var(--series-1)"
            strokeWidth={2}
            fill="url(#pace-fill)"
            connectNulls={false}
            dot={false}
            activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey={(d: PacePoint) => major(d.pace)}
            stroke="var(--chart-reference)"
            strokeWidth={2}
            strokeOpacity={0.6}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Cash flow: income vs spending per month
// ---------------------------------------------------------------------------------------------

export interface CashFlowPoint {
  label: string;
  shortLabel: string;
  income: number;
  expense: number;
}

export function CashFlowChart({ data, height = 260 }: { data: CashFlowPoint[]; height?: number }) {
  const { f, major, tick } = useMajorUnits();
  const scale = niceTicks(
    Math.max(0, ...data.flatMap((d) => [major(d.income) ?? 0, major(d.expense) ?? 0])),
  );
  return (
    <div role="img" aria-label="Income and spending per month">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          barGap={2}
          barCategoryGap="28%"
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="shortLabel"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-axis)' }}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={tick}
            ticks={scale.ticks}
            domain={[0, scale.top]}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
            content={(props) => {
              const p = props.payload?.[0]?.payload as CashFlowPoint | undefined;
              if (!props.active || !p) return null;
              return (
                <TooltipCard
                  title={p.label}
                  rows={[
                    { label: 'Income', color: 'var(--series-1)', value: f.money(p.income) },
                    { label: 'Spending', color: 'var(--series-2)', value: f.money(p.expense) },
                    {
                      label: 'Net',
                      color: 'transparent',
                      value: f.money(p.income - p.expense, undefined, { sign: 'always' }),
                    },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey={(d: CashFlowPoint) => major(d.income)}
            fill="var(--series-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          />
          <Bar
            dataKey={(d: CashFlowPoint) => major(d.expense)}
            fill="var(--series-2)"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Budget vs actual: spending bars with the budget as a reference line
// ---------------------------------------------------------------------------------------------

export interface BudgetPoint {
  label: string;
  shortLabel: string;
  spent: number;
  budgeted: number | null;
}

export function BudgetVsActualChart({
  data,
  height = 240,
}: {
  data: BudgetPoint[];
  height?: number;
}) {
  const { f, major, tick } = useMajorUnits();
  const scale = niceTicks(
    Math.max(0, ...data.flatMap((d) => [major(d.spent) ?? 0, major(d.budgeted) ?? 0])),
  );
  return (
    <div role="img" aria-label="Spending compared with budget per month">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="shortLabel"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-axis)' }}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={tick}
            ticks={scale.ticks}
            domain={[0, scale.top]}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
            content={(props) => {
              const p = props.payload?.[0]?.payload as BudgetPoint | undefined;
              if (!props.active || !p) return null;
              return (
                <TooltipCard
                  title={p.label}
                  rows={[
                    { label: 'Spent', color: 'var(--series-1)', value: f.money(p.spent) },
                    {
                      label: 'Budget',
                      color: 'var(--chart-reference)',
                      value: p.budgeted ? f.money(p.budgeted) : 'None',
                    },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey={(d: BudgetPoint) => major(d.spent)}
            fill="var(--series-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          />
          <Line
            type="step"
            dataKey={(d: BudgetPoint) => major(d.budgeted)}
            stroke="var(--chart-reference)"
            strokeWidth={2}
            dot={{ r: 4, fill: 'var(--chart-reference)', stroke: 'var(--card)', strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Small multiple: one category's spending per month, on a shared scale
// ---------------------------------------------------------------------------------------------

export function MiniColumns({
  values,
  labels,
  max,
  height = 64,
  ariaLabel,
}: {
  values: number[];
  labels: string[];
  max: number;
  height?: number;
  ariaLabel: string;
}) {
  const f = useFormat();
  const data = values.map((v, i) => ({ v: Math.max(0, v), label: labels[i] ?? '' }));
  return (
    <div role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          barCategoryGap="18%"
          margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
        >
          <YAxis hide domain={[0, max || 1]} />
          <XAxis
            dataKey="label"
            tick={false}
            tickLine={false}
            height={1}
            axisLine={{ stroke: 'var(--chart-axis)' }}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
            content={(props) => {
              const p = props.payload?.[0]?.payload as { v: number; label: string } | undefined;
              if (!props.active || !p) return null;
              return (
                <TooltipCard
                  title={p.label}
                  rows={[{ label: 'Spent', color: 'var(--series-1)', value: f.money(p.v) }]}
                />
              );
            }}
          />
          <Bar
            dataKey="v"
            fill="var(--series-1)"
            radius={[3, 3, 0, 0]}
            maxBarSize={18}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground" aria-hidden>
        <span>{labels[0]}</span>
        <span>{labels.at(-1)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Net worth: assets up, debts down, net as a line
// ---------------------------------------------------------------------------------------------

export interface NetWorthPoint {
  label: string;
  shortLabel: string;
  assets: number;
  liabilities: number;
  net: number;
}

export function NetWorthChart({ data, height = 280 }: { data: NetWorthPoint[]; height?: number }) {
  const { f, major, tick } = useMajorUnits();
  const values = data.flatMap((d) => [
    major(d.assets) ?? 0,
    major(d.liabilities) ?? 0,
    major(d.net) ?? 0,
  ]);
  const range = niceRange(Math.min(0, ...values), Math.max(0, ...values));
  return (
    <div role="img" aria-label="Net worth at the end of each month">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={data}
          barGap={2}
          barCategoryGap="28%"
          stackOffset="sign"
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="shortLabel"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-axis)' }}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={tick}
            ticks={range.ticks}
            domain={range.domain}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
            content={(props) => {
              const p = props.payload?.[0]?.payload as NetWorthPoint | undefined;
              if (!props.active || !p) return null;
              return (
                <TooltipCard
                  title={p.label}
                  rows={[
                    { label: 'Assets', color: 'var(--series-1)', value: f.money(p.assets) },
                    { label: 'Debts', color: 'var(--series-2)', value: f.money(p.liabilities) },
                    { label: 'Net worth', color: 'var(--foreground)', value: f.money(p.net) },
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey={(d: NetWorthPoint) => major(d.assets)}
            stackId="balance"
            fill="var(--series-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          />
          <Bar
            dataKey={(d: NetWorthPoint) => major(d.liabilities)}
            stackId="balance"
            fill="var(--series-2)"
            radius={[0, 0, 4, 4]}
            maxBarSize={24}
            isAnimationActive={false}
          />
          <Line
            dataKey={(d: NetWorthPoint) => major(d.net)}
            stroke="var(--foreground)"
            strokeWidth={2}
            dot={{ r: 2.5, fill: 'var(--foreground)' }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
