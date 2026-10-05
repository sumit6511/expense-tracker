import { getMonthPeriod, shiftMonthPeriod } from '@et/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import {
  CalendarDays,
  ChartColumn,
  ChartPie,
  FileText,
  GitCompareArrows,
  Hash,
  Landmark,
  Target,
  TrendingUp,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import { BudgetVsActualChart, CashFlowChart, ChartLegend, MiniColumns } from '@/components/charts';
import { DateRangePicker } from '@/components/date-range';
import { CategoryIcon } from '@/components/icons';
import { Money } from '@/components/money';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { AccountSelect } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Progress, Skeleton } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/menu';
import { AddOrImport } from '@/features/transactions/add-or-import';
import { useFormat } from '@/lib/format';
import {
  type ReportRange,
  useBudgetVsActual,
  useCashFlow,
  useCategoryMap,
  useCategoryTrends,
  useSpendingByCategory,
  useTransactions,
} from '@/lib/queries';
import { useWorkspace } from '@/lib/session';
import { cn, edgeFade, revealActive } from '@/lib/utils';
import { CalendarReport, CompareReport, GroupReport, NetWorthReport } from './more-reports';

type Tab =
  | 'spending'
  | 'cashflow'
  | 'trends'
  | 'budget'
  | 'networth'
  | 'payees'
  | 'tags'
  | 'compare'
  | 'calendar';

export function ReportsPage() {
  const search = useSearch({ from: '/app/reports' });
  const navigate = useNavigate({ from: '/reports' });
  const ws = useWorkspace();
  const f = useFormat();
  const settings = { calendar: ws.calendar, monthStartDay: ws.monthStartDay };
  const current = getMonthPeriod(f.today, settings);
  const defaultFrom = shiftMonthPeriod(current, -5, settings).start;
  const range: ReportRange = {
    from: search.from ?? defaultFrom,
    to: search.to ?? current.end,
    ...(search.accountIds ? { accountIds: search.accountIds.split(',') } : {}),
  };
  const tab: Tab = search.tab ?? 'spending';
  // Before anything is recorded, most tabs are empty: say so once, with a way forward.
  const any = useTransactions({}, 1);
  const nothingYet = any.data?.pages[0]?.items.length === 0;

  return (
    <div>
      <PageHeader
        title="Reports"
        description={`${f.date(range.from, 'medium')} – ${f.date(range.to, 'medium')} · amounts in ${f.base}`}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link
                to="/reports/monthly"
                search={{ date: range.to > f.today ? f.today : range.to }}
              >
                <FileText /> Monthly report
              </Link>
            </Button>
            <DateRangePicker
              value={{ from: range.from, to: range.to }}
              allowAllTime={false}
              onChange={(r) =>
                navigate({ search: (s) => ({ ...s, from: r.from, to: r.to }), replace: true })
              }
            />
            <div className="w-40">
              <AccountSelect
                value={search.accountIds ?? ''}
                onChange={(id) =>
                  navigate({
                    search: (s) => ({ ...s, accountIds: id || undefined }),
                    replace: true,
                  })
                }
                emptyLabel="All accounts"
                includeArchived
                className="h-8 text-compact"
                aria-label="Account"
              />
            </div>
          </>
        }
      />
      {nothingYet && (
        <Card className="mb-4">
          <EmptyState
            icon={ChartPie}
            title="No reports yet"
            description="Reports fill in as you record spending and income: where the money goes, how it changes month to month, and how budgets are holding up."
            action={<AddOrImport />}
            className="py-8"
          />
        </Card>
      )}
      <Tabs
        value={tab}
        onValueChange={(v) => navigate({ search: (s) => ({ ...s, tab: v as Tab }), replace: true })}
      >
        <TabsList
          className="edge-fade mb-4 flex max-w-full justify-start overflow-x-auto"
          // Keep the chosen tab in view when the row scrolls (phones).
          ref={(el) => {
            revealActive(el);
            return edgeFade(el);
          }}
        >
          <TabsTrigger value="spending">
            <ChartPie /> Spending
          </TabsTrigger>
          <TabsTrigger value="cashflow">
            <ChartColumn /> Cash flow
          </TabsTrigger>
          <TabsTrigger value="trends">
            <TrendingUp /> Trends
          </TabsTrigger>
          <TabsTrigger value="budget">
            <Target /> Budget
          </TabsTrigger>
          <TabsTrigger value="networth">
            <Landmark /> Net worth
          </TabsTrigger>
          <TabsTrigger value="payees">
            <Users /> Payees
          </TabsTrigger>
          <TabsTrigger value="tags">
            <Hash /> Tags
          </TabsTrigger>
          <TabsTrigger value="compare">
            <GitCompareArrows /> Compare
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <CalendarDays /> Calendar
          </TabsTrigger>
        </TabsList>
        <TabsContent value="spending">
          <SpendingReport range={range} />
        </TabsContent>
        <TabsContent value="cashflow">
          <CashFlowReport range={range} />
        </TabsContent>
        <TabsContent value="trends">
          <TrendsReport range={range} />
        </TabsContent>
        <TabsContent value="budget">
          <BudgetReport to={range.to} />
        </TabsContent>
        <TabsContent value="networth">
          <NetWorthReport range={range} />
        </TabsContent>
        <TabsContent value="payees">
          <GroupReport range={range} by="payee" />
        </TabsContent>
        <TabsContent value="tags">
          <GroupReport range={range} by="tag" />
        </TabsContent>
        <TabsContent value="compare">
          <CompareReport range={range} />
        </TabsContent>
        <TabsContent value="calendar">
          <CalendarReport range={range} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MissingRates({ currencies }: { currencies: string[] }) {
  if (currencies.length === 0) return null;
  return (
    <p className="mb-3 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm">
      <TriangleAlert className="size-4 text-warning" /> No exchange rate for {currencies.join(', ')}
      ; those amounts are left out.{' '}
      <Link
        to="/settings"
        search={{ tab: 'rates' }}
        className="font-medium text-primary hover:underline"
      >
        Add a rate
      </Link>
    </p>
  );
}

function SpendingReport({ range }: { range: ReportRange }) {
  const report = useSpendingByCategory(range);
  const categories = useCategoryMap();
  if (report.error) return <ErrorState error={report.error} retry={() => report.refetch()} />;
  if (!report.data) return <Skeleton className="h-96" />;
  const d = report.data;

  const list = (items: typeof d.expense, total: number, kind: 'expense' | 'income') =>
    items.length === 0 ? (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {kind === 'expense' ? 'No spending in this period.' : 'No income in this period.'}
      </p>
    ) : (
      <ul className="grid grid-cols-1 gap-1">
        {items.map((item) => {
          const cat = item.categoryId ? categories.get(item.categoryId) : undefined;
          const share = total > 0 ? (item.amountMinor / total) * 100 : 0;
          return (
            <li key={item.categoryId ?? 'none'}>
              <Link
                to="/transactions"
                search={{
                  categoryIds: item.categoryId ?? 'none',
                  from: range.from,
                  to: range.to,
                  accountIds: range.accountIds?.join(','),
                }}
                className="-mx-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2 hover:bg-muted/60"
              >
                <CategoryIcon
                  icon={cat?.icon}
                  color={cat?.color}
                  size="sm"
                  className="row-span-2"
                />
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-sm font-medium">
                    {cat?.name ?? 'Uncategorized'}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {item.count} · {share.toFixed(share < 10 ? 1 : 0)}%
                  </span>
                </span>
                <Money minor={item.amountMinor} className="text-sm font-medium" trimZero />
                <Progress
                  value={share}
                  className="col-span-2 h-1.5"
                  label={`${Math.round(share)}% of total`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_17rem] lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader>
          <CardTitle>Spending by category</CardTitle>
          <Money minor={d.totalExpenseMinor} className="text-lg font-semibold" trimZero />
        </CardHeader>
        <CardContent>
          <MissingRates currencies={d.missingRates} />
          {list(d.expense, d.totalExpenseMinor, 'expense')}
        </CardContent>
      </Card>
      <Card className="self-start">
        <CardHeader>
          <CardTitle>Income</CardTitle>
          <Money minor={d.totalIncomeMinor} className="text-lg font-semibold" trimZero />
        </CardHeader>
        <CardContent>{list(d.income, d.totalIncomeMinor, 'income')}</CardContent>
      </Card>
    </div>
  );
}

function CashFlowReport({ range }: { range: ReportRange }) {
  const f = useFormat();
  const report = useCashFlow(range);
  if (report.error) return <ErrorState error={report.error} retry={() => report.refetch()} />;
  if (!report.data) return <Skeleton className="h-96" />;
  const periods = report.data.periods;
  const data = periods.map((p) => ({
    label: f.month(p),
    shortLabel: f.month(p, 'short'),
    income: p.incomeMinor,
    expense: p.expenseMinor,
  }));
  const income = periods.reduce((s, p) => s + p.incomeMinor, 0);
  const expense = periods.reduce((s, p) => s + p.expenseMinor, 0);
  const savingsRate = income > 0 ? ((income - expense) / income) * 100 : null;

  return (
    <div className="grid grid-cols-1 gap-4">
      <MissingRates currencies={report.data.missingRates} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryTile label="Income" value={<Money minor={income} trimZero />} />
        <SummaryTile label="Spending" value={<Money minor={expense} trimZero />} />
        <SummaryTile
          label="Net"
          value={<Money minor={income - expense} signed colored trimZero />}
        />
        <SummaryTile
          label="Saved"
          value={savingsRate === null ? '—' : `${Math.round(savingsRate)}%`}
          hint="of income"
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Income and spending per month</CardTitle>
          <ChartLegend
            items={[
              { label: 'Income', color: 'var(--series-1)' },
              { label: 'Spending', color: 'var(--series-2)' },
            ]}
          />
        </CardHeader>
        <CardContent>
          <CashFlowChart data={data} />
        </CardContent>
      </Card>
      <Card className="overflow-x-auto" tabIndex={0} role="region" aria-label="Cash flow per month">
        <table className="w-full text-sm tabular">
          <caption className="sr-only">Cash flow per month</caption>
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Month</th>
              <th className="px-4 py-2 text-right font-medium">Income</th>
              <th className="px-4 py-2 text-right font-medium">Spending</th>
              <th className="px-4 py-2 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {periods.map((p) => (
              <tr key={p.start}>
                <td className="px-4 py-2">{f.month(p)}</td>
                <td className="px-4 py-2 text-right">
                  {f.money(p.incomeMinor, undefined, { trimZeroFraction: true })}
                </td>
                <td className="px-4 py-2 text-right">
                  {f.money(p.expenseMinor, undefined, { trimZeroFraction: true })}
                </td>
                <td
                  className={cn(
                    'px-4 py-2 text-right font-medium',
                    p.netMinor > 0 && 'text-positive',
                  )}
                >
                  {f.money(p.netMinor, undefined, { sign: 'always', trimZeroFraction: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function TrendsReport({ range }: { range: ReportRange }) {
  const f = useFormat();
  const report = useCategoryTrends(range);
  const categories = useCategoryMap();
  const view = useMemo(() => {
    if (!report.data) return null;
    const top = report.data.series.slice(0, 9);
    const max = Math.max(1, ...top.flatMap((s) => s.valuesMinor));
    return { top, max, labels: report.data.periods.map((p) => f.month(p)) };
  }, [report.data, f]);

  if (report.error) return <ErrorState error={report.error} retry={() => report.refetch()} />;
  if (!report.data || !view) return <Skeleton className="h-96" />;
  if (view.top.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={TrendingUp}
          title="No spending in this range"
          description="Pick a longer range to see trends."
        />
      </Card>
    );
  }
  const months = view.labels.length;

  return (
    <div>
      <MissingRates currencies={report.data.missingRates} />
      <p className="mb-3 text-sm text-muted-foreground">
        Monthly spending in your top categories. All small charts share one scale, so bar heights
        compare across categories.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {view.top.map((s) => {
          const cat = s.categoryId ? categories.get(s.categoryId) : undefined;
          const total = s.valuesMinor.reduce((a, b) => a + b, 0);
          const last = s.valuesMinor.at(-1) ?? 0;
          return (
            <Card key={s.categoryId ?? 'none'}>
              <CardContent className="grid grid-cols-1 gap-2 pt-4">
                <div className="flex items-center gap-2.5">
                  <CategoryIcon icon={cat?.icon} color={cat?.color} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {cat?.name ?? 'Uncategorized'}
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                  <span>
                    Avg{' '}
                    <Money
                      minor={Math.round(total / months / 10 ** f.digits()) * 10 ** f.digits()}
                      className="font-medium text-foreground"
                      trimZero
                    />{' '}
                    / month
                  </span>
                  <span>
                    Latest <Money minor={last} className="font-medium text-foreground" trimZero />
                  </span>
                </div>
                <MiniColumns
                  values={s.valuesMinor}
                  labels={view.labels}
                  max={view.max}
                  ariaLabel={`${cat?.name ?? 'Uncategorized'} spending per month: ${s.valuesMinor
                    .map((v, i) => `${view.labels[i]} ${f.money(v)}`)
                    .join(', ')}`}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function BudgetReport({ to }: { to: string }) {
  const f = useFormat();
  const report = useBudgetVsActual(to, 6);
  if (report.error) return <ErrorState error={report.error} retry={() => report.refetch()} />;
  if (!report.data) return <Skeleton className="h-96" />;
  const data = report.data.periods.map((p) => ({
    label: f.month(p),
    shortLabel: f.month(p, 'short'),
    spent: p.spentMinor,
    budgeted: p.budgetedMinor || null,
  }));
  const anyBudget = data.some((d) => d.budgeted);
  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Spending against budget</CardTitle>
          <ChartLegend
            items={[
              { label: 'Spent', color: 'var(--series-1)' },
              { label: 'Budget', color: 'var(--chart-reference)', kind: 'line' },
            ]}
          />
        </CardHeader>
        <CardContent>
          {!anyBudget && (
            <p className="mb-2 text-sm text-muted-foreground">
              No budgets in these months yet.{' '}
              <Link to="/budgets" className="font-medium text-primary hover:underline">
                Set one up
              </Link>
            </p>
          )}
          <BudgetVsActualChart data={data} />
        </CardContent>
      </Card>
      <Card
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Budget and spending per month"
      >
        <table className="w-full text-sm tabular">
          <caption className="sr-only">Budget and spending per month</caption>
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Month</th>
              <th className="px-4 py-2 text-right font-medium">Budget</th>
              <th className="px-4 py-2 text-right font-medium">Spent</th>
              <th className="px-4 py-2 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {report.data.periods.map((p) => {
              const diff = p.budgetedMinor - p.spentMinor;
              return (
                <tr key={p.start}>
                  <td className="px-4 py-2">{f.month(p)}</td>
                  <td className="px-4 py-2 text-right">
                    {p.budgetedMinor
                      ? f.money(p.budgetedMinor, undefined, { trimZeroFraction: true })
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {f.money(p.spentMinor, undefined, { trimZeroFraction: true })}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2 text-right',
                      p.budgetedMinor > 0 && (diff >= 0 ? 'text-positive' : 'text-destructive'),
                    )}
                  >
                    {p.budgetedMinor
                      ? diff >= 0
                        ? `${f.money(diff, undefined, { trimZeroFraction: true })} under`
                        : `${f.money(-diff, undefined, { trimZeroFraction: true })} over`
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
