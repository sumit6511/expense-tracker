import {
  addDays,
  type Dashboard,
  getMonthPeriod,
  LIABILITY_ACCOUNT_TYPES,
  rangeLength,
  shiftMonthPeriod,
} from '@et/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Inbox,
  Plus,
  Tags,
  TriangleAlert,
  Upload,
  Wallet,
} from 'lucide-react';
import { useMemo } from 'react';
import { ChartLegend, PaceChart, type PacePoint } from '@/components/charts';
import { CategoryIcon } from '@/components/icons';
import { Money } from '@/components/money';
import { EmptyState, ErrorState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Progress, Skeleton } from '@/components/ui/card';
import { useTransactionDialog } from '@/features/transactions/transaction-dialog';
import { TransactionRow } from '@/features/transactions/transaction-row';
import { useFormat } from '@/lib/format';
import { useAccounts, useCategoryMap, useDashboard, useTransactions } from '@/lib/queries';
import { useCanWrite, useWorkspace } from '@/lib/session';
import { cn } from '@/lib/utils';

export function DashboardPage() {
  const search = useSearch({ from: '/app/' });
  const navigate = useNavigate();
  const ws = useWorkspace();
  const f = useFormat();
  const settings = { calendar: ws.calendar, monthStartDay: ws.monthStartDay };
  const date = search.date ?? f.today;
  const dashboard = useDashboard(search.date);
  const current = getMonthPeriod(date, settings);
  const isCurrent = f.today >= current.start && f.today <= current.end;

  const go = (delta: number) => {
    const next = shiftMonthPeriod(current, delta, settings);
    const containsToday = f.today >= next.start && f.today <= next.end;
    navigate({ to: '/', search: containsToday ? {} : { date: next.start } });
  };

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => go(-1)} aria-label="Previous month">
            <ChevronLeft />
          </Button>
          <div className="px-1">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {dashboard.data?.period.label ?? '…'}
            </h1>
            <p className="text-xs text-muted-foreground">
              {f.date(current.start, 'short')} – {f.date(current.end, 'medium')}
              {isCurrent && dashboard.data ? ` · ${dashboard.data.daysLeft} days left` : ''}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => go(1)}
            aria-label="Next month"
            disabled={isCurrent}
          >
            <ChevronRight />
          </Button>
        </div>
        {!isCurrent && (
          <Button variant="outline" size="sm" onClick={() => navigate({ to: '/', search: {} })}>
            Back to this month
          </Button>
        )}
      </div>

      {dashboard.error && <ErrorState error={dashboard.error} retry={() => dashboard.refetch()} />}
      {dashboard.data ? (
        <DashboardBody data={dashboard.data} isCurrent={isCurrent} />
      ) : (
        !dashboard.error && <DashboardSkeleton />
      )}
    </div>
  );
}

/** Rounds down to whole rupees (or dollars): a daily allowance doesn't need paisa. */
function wholeUnits(minor: number, digits: number) {
  const unit = 10 ** digits;
  return Math.floor(minor / unit) * unit;
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Skeleton className="h-72 lg:col-span-2" />
      <Skeleton className="h-72" />
      <Skeleton className="h-56" />
      <Skeleton className="h-56" />
      <Skeleton className="h-56" />
    </div>
  );
}

function DashboardBody({ data, isCurrent }: { data: Dashboard; isCurrent: boolean }) {
  const f = useFormat();
  const { openNew } = useTransactionDialog();
  const canWrite = useCanWrite();
  const categories = useCategoryMap();
  const { data: accounts = [] } = useAccounts();
  const recent = useTransactions({}, 6);
  const recentItems = recent.data?.pages[0]?.items ?? [];
  const hasBudget = data.budget.budgetedMinor > 0;
  const noActivity =
    data.cashFlow.expenseMinor === 0 && data.cashFlow.incomeMinor === 0 && recentItems.length === 0;

  const pace = useMemo<PacePoint[]>(() => {
    const total = rangeLength(data.period);
    const points: PacePoint[] = [];
    let running = 0;
    const byDate = new Map(data.dailyExpense.map((d) => [d.date, d.amountMinor]));
    for (let i = 0; i < total; i++) {
      const d = addDays(data.period.start, i);
      const known = byDate.has(d);
      running += byDate.get(d) ?? 0;
      points.push({
        date: d,
        label: f.date(d, 'short').split(' ')[0]!,
        spent: known ? running : null,
        pace: hasBudget ? Math.round((data.budget.budgetedMinor * (i + 1)) / total) : null,
      });
    }
    return points;
  }, [data, hasBudget, f]);

  const spentRatio = hasBudget ? (data.budget.spentMinor / data.budget.budgetedMinor) * 100 : 0;
  const tone = spentRatio > 100 ? 'destructive' : spentRatio > 85 ? 'warning' : 'primary';
  const compare = data.previousPeriodToDateExpenseMinor;
  const change = compare > 0 ? ((data.cashFlow.expenseMinor - compare) / compare) * 100 : null;

  if (noActivity && isCurrent) {
    return (
      <Card>
        <EmptyState
          icon={Wallet}
          title="Let’s record your first expense"
          description="Add what you spent today, or import a bank or wallet statement to fill in the past."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {canWrite && (
                <Button onClick={() => openNew()}>
                  <Plus /> Add expense
                </Button>
              )}
              <Button variant="outline" asChild>
                <Link to="/import">
                  <Upload /> Import statement
                </Link>
              </Button>
            </div>
          }
        />
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {data.missingRates.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm lg:col-span-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            No exchange rate for {data.missingRates.join(', ')}, so those amounts are left out of
            totals.{' '}
            <Link
              to="/settings"
              search={{ tab: 'rates' }}
              className="font-medium text-primary hover:underline"
            >
              Add a rate
            </Link>
          </p>
        </div>
      )}

      {/* Headline */}
      <Card className="lg:col-span-2">
        <CardContent className="grid grid-cols-1 gap-4 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">
                {hasBudget ? 'Left to spend' : 'Spent this month'}
              </p>
              <p
                className={cn(
                  'mt-1 text-4xl font-semibold tracking-tight sm:text-5xl',
                  hasBudget && data.budget.remainingMinor < 0 && 'text-destructive',
                )}
              >
                {f.money(
                  hasBudget ? data.budget.remainingMinor : data.cashFlow.expenseMinor,
                  undefined,
                  {
                    trimZeroFraction: true,
                  },
                )}
              </p>
              {hasBudget && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {data.budget.remainingMinor < 0
                    ? `Over budget by ${f.money(-data.budget.remainingMinor, undefined, { trimZeroFraction: true })}`
                    : isCurrent && data.budget.safePerDayMinor !== null
                      ? `About ${f.money(wholeUnits(data.budget.safePerDayMinor, f.digits()), undefined, { trimZeroFraction: true })} a day for the next ${data.daysLeft} days`
                      : `of ${f.money(data.budget.budgetedMinor, undefined, { trimZeroFraction: true })} budgeted`}
                </p>
              )}
            </div>
            {!hasBudget && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/budgets">Set a budget</Link>
              </Button>
            )}
          </div>
          {hasBudget && (
            <div className="grid grid-cols-1 gap-1.5">
              <Progress value={spentRatio} tone={tone} label="Share of budget spent" />
              <div className="flex justify-between text-xs text-muted-foreground tabular">
                <span>
                  Spent {f.money(data.budget.spentMinor, undefined, { trimZeroFraction: true })}
                </span>
                <span>
                  Budget {f.money(data.budget.budgetedMinor, undefined, { trimZeroFraction: true })}
                </span>
              </div>
            </div>
          )}
          <div>
            {hasBudget && (
              <ChartLegend
                className="mb-1"
                items={[
                  { label: 'Spent so far', color: 'var(--series-1)' },
                  { label: 'Even pace to budget', color: 'var(--chart-reference)', kind: 'line' },
                ]}
              />
            )}
            <PaceChart data={pace} paceLabel="Even pace" />
          </div>
        </CardContent>
      </Card>

      {/* This month in numbers */}
      <div className="grid grid-cols-1 content-start gap-4">
        <Card>
          <CardContent className="grid grid-cols-1 gap-3 pt-5">
            <Stat label="Income" value={<Money minor={data.cashFlow.incomeMinor} trimZero />} />
            <Stat
              label="Spending"
              value={<Money minor={data.cashFlow.expenseMinor} trimZero />}
              note={
                change === null ? undefined : (
                  <span className={cn(change <= 0 ? 'text-positive' : 'text-muted-foreground')}>
                    {change <= 0 ? '▼' : '▲'} {Math.abs(Math.round(change))}% vs last month at this
                    point
                  </span>
                )
              }
            />
            <Stat
              label="Net"
              value={<Money minor={data.cashFlow.netMinor} signed colored trimZero />}
            />
          </CardContent>
        </Card>
        <AttentionCard data={data} />
      </div>

      {/* Top categories */}
      <Card>
        <CardHeader>
          <CardTitle>Where it went</CardTitle>
          <Link to="/reports" className="text-xs font-medium text-primary hover:underline">
            Reports
          </Link>
        </CardHeader>
        <CardContent>
          {data.topCategories.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No spending yet this month.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3">
              {data.topCategories.map((c) => {
                const cat = c.categoryId ? categories.get(c.categoryId) : undefined;
                const share =
                  data.cashFlow.expenseMinor > 0
                    ? (c.amountMinor / data.cashFlow.expenseMinor) * 100
                    : 0;
                return (
                  <li key={c.categoryId ?? 'none'}>
                    <Link
                      to="/transactions"
                      search={{
                        categoryIds: c.categoryId ?? 'none',
                        from: data.period.start,
                        to: data.period.end,
                      }}
                      className="grid grid-cols-1 gap-1.5 rounded-lg hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2.5">
                        <CategoryIcon icon={cat?.icon} color={cat?.color} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {cat?.name ?? 'Uncategorized'}
                        </span>
                        <Money minor={c.amountMinor} className="text-sm font-medium" trimZero />
                      </div>
                      <Progress
                        value={share}
                        className="h-1.5"
                        label={`${Math.round(share)}% of spending`}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Accounts */}
      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <Link to="/accounts" className="text-xs font-medium text-primary hover:underline">
            Manage
          </Link>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-1">
          {accounts
            .filter((a) => !a.archived)
            .slice(0, 6)
            .map((a) => (
              <Link
                key={a.id}
                to="/accounts/$accountId"
                params={{ accountId: a.id }}
                className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/60"
              >
                <CategoryIcon icon={a.icon} color={a.color} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
                <Money
                  minor={a.balanceMinor}
                  currency={a.currency}
                  className={cn(
                    'text-sm',
                    LIABILITY_ACCOUNT_TYPES.includes(a.type) &&
                      a.balanceMinor < 0 &&
                      'text-muted-foreground',
                  )}
                  trimZero
                />
              </Link>
            ))}
          <div className="mt-2 flex items-center justify-between border-t pt-3 text-sm">
            <span className="text-muted-foreground">Net worth</span>
            <Money minor={data.netWorthMinor} className="font-semibold" trimZero />
          </div>
        </CardContent>
      </Card>

      {/* Recent */}
      <Card>
        <CardHeader>
          <CardTitle>Recent</CardTitle>
          <Link to="/transactions" className="text-xs font-medium text-primary hover:underline">
            See all
          </Link>
        </CardHeader>
        <div className="-mt-1 divide-y pb-2">
          {recentItems.length === 0 && (
            <p className="px-5 py-6 text-sm text-muted-foreground">Nothing yet.</p>
          )}
          {recentItems.map((tx) => (
            <RecentRow key={tx.id} tx={tx} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function RecentRow({ tx }: { tx: Parameters<typeof TransactionRow>[0]['tx'] }) {
  const { openEdit } = useTransactionDialog();
  return <TransactionRow tx={tx} onOpen={(t) => openEdit(t.id)} showAccount={false} showDate />;
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        {note && <p className="mt-0.5 text-xs">{note}</p>}
      </div>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function AttentionCard({ data }: { data: Dashboard }) {
  const items: Array<{
    icon: typeof Inbox;
    label: string;
    hint: string;
    search: { needsReview?: 'true'; categoryIds?: string };
  }> = [];
  if (data.needsReviewCount > 0) {
    items.push({
      icon: Inbox,
      label: `${data.needsReviewCount} to review`,
      hint: 'Imported transactions waiting for a quick check',
      search: { needsReview: 'true' },
    });
  }
  if (data.uncategorizedCount > 0) {
    items.push({
      icon: Tags,
      label: `${data.uncategorizedCount} uncategorized`,
      hint: 'Give them a category for accurate reports',
      search: { categoryIds: 'none' },
    });
  }

  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-2 pt-4">
        {items.length === 0 ? (
          <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-positive" /> All caught up
          </p>
        ) : (
          items.map((item) => (
            <Link
              key={item.label}
              to="/transactions"
              search={item.search}
              className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60"
            >
              <span className="grid grid-cols-1 size-8 place-items-center rounded-full bg-accent text-accent-foreground">
                <item.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{item.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
