import {
  AD_MONTH_NAMES,
  addDays,
  addMonths,
  adToBs,
  BS_MONTH_NAMES,
  bsDaysInMonth,
  bsToAd,
  diffDays,
  type IsoDate,
  isBsSupported,
  listMonthPeriods,
  parseIsoDate,
  rangeLength,
  shiftMonthPeriod,
  WEEKDAY_NAMES,
} from '@et/shared';
import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, Hash, Users } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import { ChartLegend, NetWorthChart } from '@/components/charts';
import { CategoryIcon } from '@/components/icons';
import { Money } from '@/components/money';
import { EmptyState, ErrorState, StatCard } from '@/components/page';
import { Card, CardContent, CardHeader, CardTitle, Progress, Skeleton } from '@/components/ui/card';
import { Segmented } from '@/components/ui/menu';
import { useFormat } from '@/lib/format';
import {
  type ReportRange,
  useCategoryMap,
  useComparison,
  useDailySpending,
  useNetWorthSeries,
  usePayees,
  useSpendingByPayee,
  useSpendingByTag,
  useTags,
} from '@/lib/queries';
import { useWorkspace } from '@/lib/session';
import { cn } from '@/lib/utils';

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return <StatCard label={label} value={value} hint={hint} />;
}

// ---------------------------------------------------------------------------------------------
// Net worth
// ---------------------------------------------------------------------------------------------

export function NetWorthReport({ range }: { range: ReportRange }) {
  const f = useFormat();
  const report = useNetWorthSeries(range);
  if (report.error) return <ErrorState error={report.error} retry={() => report.refetch()} />;
  if (!report.data) return <Skeleton className="h-96" />;
  const points = report.data.points;
  const first = points[0]!;
  const last = points.at(-1)!;
  const data = points.map((p) => ({
    label: `${f.month(p)} (${f.date(p.date, 'short')})`,
    shortLabel: f.month(p, 'short'),
    assets: p.assetsMinor,
    liabilities: p.liabilitiesMinor,
    net: p.netMinor,
  }));
  const change = last.netMinor - first.netMinor;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="Net worth" value={<Money minor={last.netMinor} trimZero />} />
        <Tile
          label="Change"
          value={<Money minor={change} signed colored trimZero />}
          hint={`since ${first.label}`}
        />
        <Tile label="Assets" value={<Money minor={last.assetsMinor} trimZero />} />
        <Tile label="Debts" value={<Money minor={-last.liabilitiesMinor} trimZero />} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Net worth at the end of each month</CardTitle>
          <ChartLegend
            items={[
              { label: 'Assets', color: 'var(--series-1)' },
              { label: 'Debts', color: 'var(--series-2)' },
              { label: 'Net worth', color: 'var(--foreground)', kind: 'line' },
            ]}
          />
        </CardHeader>
        <CardContent>
          <NetWorthChart data={data} />
          <p className="mt-2 text-xs text-muted-foreground">
            Accounts marked “include in net worth”, converted at each month-end’s exchange rate.
          </p>
        </CardContent>
      </Card>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm tabular">
          <caption className="sr-only">Net worth per month</caption>
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Month</th>
              <th className="px-4 py-2 text-right font-medium">Assets</th>
              <th className="px-4 py-2 text-right font-medium">Debts</th>
              <th className="px-4 py-2 text-right font-medium">Net worth</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {[...points].reverse().map((p) => (
              <tr key={p.start}>
                <td className="px-4 py-2">{f.month(p)}</td>
                <td className="px-4 py-2 text-right">
                  {f.money(p.assetsMinor, undefined, { trimZeroFraction: true })}
                </td>
                <td className="px-4 py-2 text-right">
                  {f.money(-p.liabilitiesMinor, undefined, { trimZeroFraction: true })}
                </td>
                <td className="px-4 py-2 text-right font-medium">
                  {f.money(p.netMinor, undefined, { trimZeroFraction: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// By payee / by tag
// ---------------------------------------------------------------------------------------------

export function GroupReport({ range, by }: { range: ReportRange; by: 'payee' | 'tag' }) {
  const payeeReport = useSpendingByPayee(range);
  const tagReport = useSpendingByTag(range);
  const report = by === 'payee' ? payeeReport : tagReport;
  const { data: payees = [] } = usePayees();
  const { data: tags = [] } = useTags();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  if (report.error) return <ErrorState error={report.error} retry={() => report.refetch()} />;
  if (!report.data) return <Skeleton className="h-96" />;
  const d = report.data;
  const items = kind === 'expense' ? d.expense : d.income;
  const total = kind === 'expense' ? d.totalExpenseMinor : d.totalIncomeMinor;
  const max = Math.max(1, ...items.map((i) => i.amountMinor));

  const name = (id: string | null) =>
    id === null
      ? 'No payee'
      : by === 'payee'
        ? (payees.find((p) => p.id === id)?.name ?? 'Unknown payee')
        : `#${tags.find((t) => t.id === id)?.name ?? 'deleted'}`;
  const color = (id: string | null) =>
    by === 'tag' ? tags.find((t) => t.id === id)?.color : undefined;

  return (
    <Card>
      <CardHeader>
        <Segmented
          size="sm"
          label="Show"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense', label: 'Spending' },
            { value: 'income', label: 'Income' },
          ]}
        />
        <Money minor={total} className="text-lg font-semibold" trimZero />
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState
            icon={by === 'payee' ? Users : Hash}
            title={by === 'payee' ? 'Nothing here' : 'No tagged transactions'}
            description={
              by === 'tag'
                ? 'Tag transactions (e.g. #dashain, #trip-pokhara) to see what an event or project cost.'
                : undefined
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-1">
            {items.slice(0, 50).map((item) => (
              <li key={item.id ?? 'none'}>
                <Link
                  to="/transactions"
                  search={{
                    ...(by === 'payee'
                      ? { payeeIds: item.id ?? 'none' }
                      : { tagIds: item.id ?? undefined }),
                    from: range.from,
                    to: range.to,
                  }}
                  className="-mx-2 grid grid-cols-1 gap-1.5 rounded-lg px-2 py-2 hover:bg-muted/60"
                >
                  <span className="flex items-center gap-3 text-sm">
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate font-medium',
                        color(item.id) && 'tag-text',
                      )}
                      style={
                        color(item.id) ? ({ '--tag': color(item.id) } as CSSProperties) : undefined
                      }
                    >
                      {name(item.id)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {item.count} · {total > 0 ? Math.round((item.amountMinor / total) * 100) : 0}%
                    </span>
                    <Money minor={item.amountMinor} className="w-28 text-right" trimZero />
                  </span>
                  <Progress value={(item.amountMinor / max) * 100} className="h-1.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Compare two periods
// ---------------------------------------------------------------------------------------------

/** The same dates a year earlier, in the workspace calendar. */
function yearEarlier(date: IsoDate, calendar: 'bs' | 'ad') {
  if (calendar === 'bs' && isBsSupported(date)) {
    const { year, month, day } = adToBs(date);
    return bsToAd({ year: year - 1, month, day: Math.min(day, bsDaysInMonth(year - 1, month)) });
  }
  return addMonths(date, -12);
}

/**
 * The period just before: whole budget months when the range is whole months (6 BS months →
 * the 6 before), otherwise the same number of days.
 */
function previousPeriod(
  from: IsoDate,
  to: IsoDate,
  ws: { calendar: 'bs' | 'ad'; monthStartDay: number },
): [IsoDate, IsoDate] {
  const settings = { calendar: ws.calendar, monthStartDay: ws.monthStartDay };
  const periods = listMonthPeriods(from, to, settings);
  const first = periods[0];
  const last = periods.at(-1);
  if (first && last && first.start === from && last.end === to) {
    return [
      shiftMonthPeriod(first, -periods.length, settings).start,
      shiftMonthPeriod(last, -periods.length, settings).end,
    ];
  }
  const length = rangeLength({ start: from, end: to });
  return [addDays(from, -length), addDays(from, -1)];
}

export function CompareReport({ range }: { range: ReportRange }) {
  const f = useFormat();
  const ws = useWorkspace();
  const categories = useCategoryMap();
  const [mode, setMode] = useState<'previous' | 'year'>('previous');
  const [compareFrom, compareTo] =
    mode === 'previous'
      ? previousPeriod(range.from, range.to, ws)
      : [yearEarlier(range.from, ws.calendar), yearEarlier(range.to, ws.calendar)];
  const report = useComparison(range, compareFrom, compareTo);
  if (report.error) return <ErrorState error={report.error} retry={() => report.refetch()} />;
  if (!report.data) return <Skeleton className="h-96" />;
  const d = report.data;
  const pct = (now: number, before: number) =>
    before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 100);
  const spendChange = pct(d.current.expenseMinor, d.previous.expenseMinor);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          size="sm"
          label="Compare with"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'previous', label: 'Previous period' },
            { value: 'year', label: 'A year earlier' },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {f.date(range.from)} – {f.date(range.to)} vs {f.date(compareFrom)} – {f.date(compareTo)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="Spending now" value={<Money minor={d.current.expenseMinor} trimZero />} />
        <Tile
          label="Spending before"
          value={<Money minor={d.previous.expenseMinor} trimZero />}
          hint={
            spendChange === null ? undefined : `${spendChange > 0 ? '+' : ''}${spendChange}% now`
          }
        />
        <Tile label="Income now" value={<Money minor={d.current.incomeMinor} trimZero />} />
        <Tile label="Income before" value={<Money minor={d.previous.incomeMinor} trimZero />} />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm tabular">
          <caption className="sr-only">Spending per category in both periods</caption>
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Category</th>
              <th className="px-4 py-2 text-right font-medium">Before</th>
              <th className="px-4 py-2 text-right font-medium">Now</th>
              <th className="px-4 py-2 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {d.categories.map((c) => {
              const cat = c.categoryId ? categories.get(c.categoryId) : undefined;
              const diff = c.currentMinor - c.previousMinor;
              const p = pct(c.currentMinor, c.previousMinor);
              return (
                <tr key={c.categoryId ?? 'none'}>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <CategoryIcon icon={cat?.icon} color={cat?.color} size="sm" />
                      <span className="truncate">{cat?.name ?? 'Uncategorized'}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {f.money(c.previousMinor, undefined, { trimZeroFraction: true })}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {f.money(c.currentMinor, undefined, { trimZeroFraction: true })}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2 text-right whitespace-nowrap',
                      diff > 0 ? 'text-destructive' : diff < 0 ? 'text-positive' : '',
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {diff > 0 ? (
                        <ArrowUp className="size-3" role="img" aria-label="up" />
                      ) : diff < 0 ? (
                        <ArrowDown className="size-3" role="img" aria-label="down" />
                      ) : null}
                      {f.money(Math.abs(diff), undefined, { trimZeroFraction: true })}
                      {p !== null && (
                        <span className="text-xs text-muted-foreground">({Math.abs(p)}%)</span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {d.categories.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No spending in either period.
          </p>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Spending calendar (heatmap)
// ---------------------------------------------------------------------------------------------

function monthLabel(date: IsoDate, calendar: 'bs' | 'ad') {
  if (calendar === 'bs' && isBsSupported(date)) {
    const { month, day } = adToBs(date);
    return { key: month, first: day === 1, name: BS_MONTH_NAMES[month - 1]!.slice(0, 3) };
  }
  const { month, day } = parseIsoDate(date);
  return { key: month, first: day === 1, name: AD_MONTH_NAMES[month - 1]!.slice(0, 3) };
}

const LEVELS = ['0%', '22%', '42%', '66%', '100%'];

export function CalendarReport({ range }: { range: ReportRange }) {
  const f = useFormat();
  const ws = useWorkspace();
  // At most a year, ending with the range.
  const from = diffDays(range.from, range.to) > 364 ? addDays(range.to, -364) : range.from;
  const report = useDailySpending({ ...range, from });
  const grid = useMemo(
    () => buildGrid(from, range.to, ws.weekStart),
    [from, range.to, ws.weekStart],
  );

  if (report.error) return <ErrorState error={report.error} retry={() => report.refetch()} />;
  if (!report.data) return <Skeleton className="h-72" />;
  const byDate = new Map(report.data.days.map((d) => [d.date, d]));
  const spends = report.data.days
    .map((d) => d.expenseMinor)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const q = (p: number) => spends[Math.min(spends.length - 1, Math.floor(p * spends.length))] ?? 0;
  const thresholds = [q(0.25), q(0.5), q(0.8)];
  const level = (v: number) =>
    v <= 0 ? 0 : v <= thresholds[0]! ? 1 : v <= thresholds[1]! ? 2 : v <= thresholds[2]! ? 3 : 4;

  const totalDays = rangeLength({ start: from, end: range.to });
  const spendDays = spends.length;
  const total = spends.reduce((s, v) => s + v, 0);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  for (const d of report.data.days)
    byWeekday[new Date(`${d.date}T00:00:00Z`).getUTCDay()]! += Math.max(0, d.expenseMinor);
  const busiest = byWeekday.indexOf(Math.max(...byWeekday));
  const top = [...report.data.days].sort((a, b) => b.expenseMinor - a.expenseMinor).slice(0, 5);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="No-spend days" value={`${totalDays - spendDays}`} hint={`of ${totalDays}`} />
        <Tile
          label="Average a day"
          value={<Money minor={Math.round(total / Math.max(1, totalDays))} trimZero />}
        />
        <Tile label="Busiest weekday" value={total > 0 ? WEEKDAY_NAMES[busiest] : '—'} />
        <Tile label="Total spent" value={<Money minor={total} trimZero />} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Spending by day</CardTitle>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Less
            {LEVELS.map((l) => (
              <span key={l} className="size-3 rounded-sm border" style={cellStyle(l)} />
            ))}
            More
          </span>
        </CardHeader>
        <CardContent
          className="overflow-x-auto"
          // Start at the most recent weeks when the year doesn't fit (phones).
          ref={(el) => {
            if (el) el.scrollLeft = el.scrollWidth;
          }}
        >
          <div
            role="img"
            aria-label={`Spending per day from ${f.date(from)} to ${f.date(range.to)}`}
            className="inline-grid gap-[3px]"
            style={{
              gridTemplateColumns: `1.75rem repeat(${grid.weeks.length}, 0.8rem)`,
              gridTemplateRows: 'auto repeat(7, 0.8rem)',
            }}
          >
            <span className="sticky left-0 z-10 bg-card" />
            {grid.weeks.map((week) => {
              const firstOfMonth = week.find((d) => d && monthLabel(d, ws.calendar).first);
              return (
                <span
                  key={`m${weekKey(week)}`}
                  className="relative h-4 text-2xs text-muted-foreground"
                >
                  {firstOfMonth && (
                    <span className="absolute left-0 whitespace-nowrap">
                      {monthLabel(firstOfMonth, ws.calendar).name}
                    </span>
                  )}
                </span>
              );
            })}
            {ROWS.map((row) => (
              <DayRow key={`row${row}`} row={row} grid={grid} weekStart={ws.weekStart}>
                {(date) => {
                  const d = byDate.get(date);
                  const v = d?.expenseMinor ?? 0;
                  return (
                    <span
                      title={`${f.date(date)}: ${f.money(Math.max(0, v))}${d ? ` · ${d.count} transaction${d.count === 1 ? '' : 's'}` : ''}`}
                      className="size-[0.8rem] rounded-[3px] border border-border/60"
                      style={cellStyle(LEVELS[level(v)]!)}
                    />
                  );
                }}
              </DayRow>
            ))}
          </div>
        </CardContent>
      </Card>
      {top[0] && top[0].expenseMinor > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Biggest days</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-1">
            {top
              .filter((d) => d.expenseMinor > 0)
              .map((d) => (
                <Link
                  key={d.date}
                  to="/transactions"
                  search={{ from: d.date, to: d.date }}
                  className="-mx-2 flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted/60"
                >
                  <span>{f.date(d.date)}</span>
                  <span className="text-muted-foreground">
                    {d.count} ·{' '}
                    <Money minor={d.expenseMinor} className="text-foreground" trimZero />
                  </span>
                </Link>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function cellStyle(level: string) {
  return level === '0%'
    ? { backgroundColor: 'var(--muted)' }
    : { backgroundColor: `color-mix(in oklch, var(--series-2) ${level}, var(--card))` };
}

const ROWS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Every week column contains at least one real day; its first one names the column. */
const weekKey = (week: Array<IsoDate | null>) => week.find((d) => d !== null) ?? '';

interface Grid {
  weeks: Array<Array<IsoDate | null>>;
}

/** Columns of 7 days, the first column starting on the workspace's week start. */
function buildGrid(from: IsoDate, to: IsoDate, weekStart: number): Grid {
  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() - weekStart + 7) % 7;
  const weeks: Grid['weeks'] = [];
  let week: Array<IsoDate | null> = Array.from({ length: lead }, () => null);
  for (let d = from; d <= to; d = addDays(d, 1)) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push([...week, ...Array.from({ length: 7 - week.length }, () => null)]);
  return { weeks };
}

function DayRow({
  row,
  grid,
  weekStart,
  children,
}: {
  row: number;
  grid: Grid;
  weekStart: number;
  children: (date: IsoDate) => React.ReactNode;
}) {
  const weekday = (weekStart + row) % 7;
  return (
    <>
      <span className="sticky left-0 z-10 bg-card pr-1 text-right text-2xs leading-[0.8rem] text-muted-foreground">
        {row % 2 === 0 ? WEEKDAY_NAMES[weekday]!.slice(0, 3) : ''}
      </span>
      {grid.weeks.map((week) => {
        const date = week[row];
        return date ? (
          <span key={date} className="contents">
            {children(date)}
          </span>
        ) : (
          <span key={`${weekKey(week)}-${row}`} aria-hidden />
        );
      })}
    </>
  );
}
