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
  ChevronDown,
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
import { useMemo, useState } from 'react';
import { ChartLegend, PaceChart, type PacePoint } from '@/components/charts';
import { CategoryIcon } from '@/components/icons';
import { Money } from '@/components/money';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ListSkeleton,
  Progress,
  Skeleton,
} from '@/components/ui/card';
import { InsightList } from '@/features/insights/insight-list';
import { dueLabel, isDue, useRecordNow } from '@/features/recurring/recurring-dialog';
import { useTransactionDialog } from '@/features/transactions/transaction-dialog';
import { TransactionRow } from '@/features/transactions/transaction-row';
import { useFormat } from '@/lib/format';
import { useT } from '@/lib/i18n';
import {
  useAccounts,
  useCategoryMap,
  useDashboard,
  useGoals,
  useInsights,
  useRecurring,
  useTransactions,
  useUpcoming,
} from '@/lib/queries';
import { useCanWrite, useWorkspace } from '@/lib/session';
import { cn, storage, useMediaQuery } from '@/lib/utils';

export function DashboardPage() {
  const t = useT();
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
      <PageHeader
        className="mb-0"
        documentTitle={t('Home')}
        title={f.month(current)}
        description={`${f.date(current.start, 'short')} – ${f.date(current.end, 'medium')}${
          isCurrent && dashboard.data
            ? ` · ${t('{days} days left', { days: dashboard.data.daysLeft })}`
            : ''
        }`}
        leading={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => go(-1)}
            aria-label={t('Previous month')}
          >
            <ChevronLeft />
          </Button>
        }
        trailing={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => go(1)}
            aria-label={t('Next month')}
            disabled={isCurrent}
          >
            <ChevronRight />
          </Button>
        }
        actions={
          !isCurrent && (
            <Button variant="outline" size="sm" onClick={() => navigate({ to: '/', search: {} })}>
              {t('Back to this month')}
            </Button>
          )
        }
      />

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

/** The headline, the month's numbers and a list, roughly where they'll appear. */
function DashboardSkeleton() {
  return (
    <div role="status" className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <span className="sr-only">Loading…</span>
      <Card className="lg:col-span-2">
        <CardContent className="grid grid-cols-1 gap-3 pt-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-11 w-56 sm:h-12" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="mt-2 h-2 w-full" />
          <Skeleton className="mt-2 h-[200px] w-full lg:h-[240px]" />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-28" />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <div className="px-5 pt-4 pb-1">
          <Skeleton className="h-4 w-20" />
        </div>
        <ListSkeleton rows={4} className="divide-y-0" />
      </Card>
    </div>
  );
}

function DashboardBody({ data, isCurrent }: { data: Dashboard; isCurrent: boolean }) {
  const t = useT();
  const f = useFormat();
  const { openNew } = useTransactionDialog();
  const canWrite = useCanWrite();
  const categories = useCategoryMap();
  const { data: accounts = [] } = useAccounts();
  const recent = useTransactions({}, 6);
  const recentItems = recent.data?.pages[0]?.items ?? [];
  // Desktop: a grid of columns. Phones: one column in order of use (rendered in that order, so
  // keyboard and screen-reader order match what's on screen).
  const wide = useMediaQuery('(min-width: 1024px)');
  // Tablets: two columns under a full-width headline.
  const medium = useMediaQuery('(min-width: 768px)');
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
          title={t('Let’s record your first expense')}
          description={t(
            'Add what you spent today, or import a bank or wallet statement to fill in the past.',
          )}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {canWrite && (
                <Button onClick={() => openNew()}>
                  <Plus /> {t('Add expense')}
                </Button>
              )}
              <Button variant="outline" asChild>
                <Link to="/import">
                  <Upload /> {t('Import statement')}
                </Link>
              </Button>
            </div>
          }
        />
      </Card>
    );
  }

  const rates = data.missingRates.length > 0 && (
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
  );
  const headline = (
    <Card>
      <CardContent className="grid grid-cols-1 gap-4 pt-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">
              {hasBudget ? t('Left to spend') : t('Spent this month')}
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
                  ? t('Over budget by {amount}', {
                      amount: f.money(-data.budget.remainingMinor, undefined, {
                        trimZeroFraction: true,
                      }),
                    })
                  : isCurrent && data.budget.safePerDayMinor !== null
                    ? t('About {amount} a day for the next {days} days', {
                        amount: f.money(
                          wholeUnits(data.budget.safePerDayMinor, f.digits()),
                          undefined,
                          { trimZeroFraction: true },
                        ),
                        days: data.daysLeft,
                      })
                    : t(
                        data.budget.source === 'cap'
                          ? 'of {amount} monthly limit'
                          : 'of {amount} budgeted',
                        {
                          amount: f.money(data.budget.budgetedMinor, undefined, {
                            trimZeroFraction: true,
                          }),
                        },
                      )}
              </p>
            )}
          </div>
          {!hasBudget && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/budgets">{t('Set a budget')}</Link>
            </Button>
          )}
          {data.budget.readyToAssignMinor !== null && data.budget.readyToAssignMinor !== 0 && (
            <Link
              to="/budgets"
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium',
                data.budget.readyToAssignMinor > 0
                  ? 'border-positive/30 bg-positive/10 text-positive'
                  : 'border-destructive/30 bg-destructive/10 text-destructive',
              )}
            >
              {data.budget.readyToAssignMinor > 0
                ? t('{amount} ready to assign', {
                    amount: f.money(data.budget.readyToAssignMinor, undefined, {
                      trimZeroFraction: true,
                    }),
                  })
                : t('{amount} more assigned than you have', {
                    amount: f.money(-data.budget.readyToAssignMinor, undefined, {
                      trimZeroFraction: true,
                    }),
                  })}
            </Link>
          )}
        </div>
        {hasBudget && (
          <div className="grid grid-cols-1 gap-1.5">
            <Progress value={spentRatio} tone={tone} label={t('Share of budget spent')} />
            <div className="flex justify-between text-xs text-muted-foreground tabular">
              <span>
                {t('Spent {amount}', {
                  amount: f.money(data.budget.spentMinor, undefined, { trimZeroFraction: true }),
                })}
              </span>
              <span>
                {data.budget.source === 'cap' ? t('Limit') : t('Budget')}{' '}
                {f.money(data.budget.budgetedMinor, undefined, { trimZeroFraction: true })}
              </span>
            </div>
          </div>
        )}
        <div>
          {hasBudget && (
            <ChartLegend
              className="mb-1"
              items={[
                { label: t('Spent so far'), color: 'var(--series-1)' },
                {
                  label: t('Even pace to budget'),
                  color: 'var(--chart-reference)',
                  kind: 'line',
                },
              ]}
            />
          )}
          <PaceChart data={pace} paceLabel={t('Even pace')} height={wide ? 240 : 200} />
        </div>
      </CardContent>
    </Card>
  );
  const stats = (
    <Card>
      <CardContent className="grid grid-cols-1 gap-3 pt-5">
        <Stat label={t('Income')} value={<Money minor={data.cashFlow.incomeMinor} trimZero />} />
        <Stat
          label={t('Spending')}
          value={<Money minor={data.cashFlow.expenseMinor} trimZero />}
          note={
            change === null ? undefined : (
              <span className={cn(change <= 0 ? 'text-positive' : 'text-muted-foreground')}>
                {change <= 0 ? '▼' : '▲'}{' '}
                {t('{pct}% vs last month at this point', { pct: Math.abs(Math.round(change)) })}
              </span>
            )
          }
        />
        <Stat
          label={t('Net')}
          value={<Money minor={data.cashFlow.netMinor} signed colored trimZero />}
        />
      </CardContent>
    </Card>
  );
  const attention = <AttentionCard data={data} />;
  const insights = isCurrent && <InsightsCard collapsible={!wide} />;
  const where = (
    <Card>
      <CardHeader>
        <CardTitle>{t('Where it went')}</CardTitle>
        <Link to="/reports" className="hit-area text-xs font-medium text-primary hover:underline">
          {t('Reports')}
        </Link>
      </CardHeader>
      <CardContent>
        {data.topCategories.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('No spending yet this month.')}
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
                        {cat?.name ?? t('Uncategorized')}
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
  );
  const accountsCard = (
    <Card>
      <CardHeader>
        <CardTitle>{t('Accounts')}</CardTitle>
        <Link to="/accounts" className="hit-area text-xs font-medium text-primary hover:underline">
          {t('Manage')}
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
  );
  const goals = <GoalsCard />;
  const upcoming = isCurrent && <UpcomingCard />;
  const recentCard = (
    <Card>
      <CardHeader>
        <CardTitle>{t('Recent')}</CardTitle>
        <Link
          to="/transactions"
          className="hit-area text-xs font-medium text-primary hover:underline"
        >
          {t('See all')}
        </Link>
      </CardHeader>
      <div className="-mt-1 divide-y pb-2">
        {recentItems.length === 0 && (
          <p className="px-5 py-6 text-sm text-muted-foreground">{t('Nothing yet.')}</p>
        )}
        {recentItems.slice(0, wide ? 6 : 5).map((tx) => (
          <RecentRow key={tx.id} tx={tx} />
        ))}
      </div>
    </Card>
  );

  if (medium && !wide) {
    return (
      <div className="grid grid-cols-2 items-start gap-4">
        {rates && <div className="col-span-2">{rates}</div>}
        <div className="col-span-2">{headline}</div>
        <div className="grid grid-cols-1 gap-4">
          {attention}
          {recentCard}
          {where}
          {goals}
        </div>
        <div className="grid grid-cols-1 gap-4">
          {upcoming}
          {stats}
          {insights}
          {accountsCard}
        </div>
      </div>
    );
  }

  if (!wide) {
    // What people check most first: where they stand, what needs them, what just happened.
    return (
      <div className="grid grid-cols-1 gap-4">
        {rates}
        {headline}
        {attention}
        {recentCard}
        {upcoming}
        {stats}
        {insights}
        {where}
        {accountsCard}
        {goals}
      </div>
    );
  }

  // Two stacks that don't share row heights, so a tall card in one doesn't leave a gap in the
  // other: the month and where the money went on the left, numbers and what's next on the right.
  return (
    <div className="grid grid-cols-3 items-start gap-4">
      {rates}
      <div className="col-span-2 grid grid-cols-1 gap-4">
        {headline}
        <div className="grid grid-cols-2 items-start gap-4">
          {where}
          <div className="grid grid-cols-1 gap-4">
            {accountsCard}
            {goals}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {stats}
        {attention}
        {insights}
        {upcoming}
      </div>
      <div className="col-span-3">{recentCard}</div>
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
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
      </div>
      {note && <p className="mt-0.5 text-right text-xs">{note}</p>}
    </div>
  );
}

/** Progress on the nearest goals. */
function GoalsCard() {
  const t = useT();
  const { data: goals = [] } = useGoals();
  const active = goals.filter((g) => !g.archived).slice(0, 3);
  if (active.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Goals')}</CardTitle>
        <Link
          to="/budgets"
          search={{ view: 'goals' }}
          className="hit-area text-xs font-medium text-primary hover:underline"
        >
          {t('All goals')}
        </Link>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        {active.map((g) => (
          <div key={g.id} className="grid grid-cols-1 gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{g.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular">
                {Math.round(g.progress * 100)}%
              </span>
            </div>
            <Progress
              value={g.progress * 100}
              tone={g.reached ? 'positive' : 'primary'}
              className="h-1.5"
              label={`${g.name} progress`}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Bills and income due in the next three weeks, overdue reminders first. */
const INSIGHTS_OPEN_KEY = 'et.dashboard.insightsOpen';

/** On phones it can be folded away (and stays that way), since it sits above other cards. */
function InsightsCard({ collapsible }: { collapsible: boolean }) {
  const t = useT();
  const { data } = useInsights();
  const [open, setOpen] = useState(() => storage.get(INSIGHTS_OPEN_KEY) !== 'false');
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  const shown = !collapsible || open;
  const toggle = () => {
    setOpen(!open);
    storage.set(INSIGHTS_OPEN_KEY, open ? 'false' : null);
  };
  return (
    <Card>
      <CardHeader className={cn(!shown && 'pb-4')}>
        {collapsible ? (
          <CardTitle>
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              className="hit-area -my-1 inline-flex items-center gap-1.5"
            >
              {t('Worth knowing')}
              {!open && (
                <span className="rounded-full bg-muted px-1.5 text-2xs font-medium text-muted-foreground">
                  {items.length}
                </span>
              )}
              <ChevronDown
                className={cn(
                  'size-4 text-muted-foreground transition-transform',
                  open && 'rotate-180',
                )}
              />
            </button>
          </CardTitle>
        ) : (
          <CardTitle>{t('Worth knowing')}</CardTitle>
        )}
        <Link to="/insights" className="hit-area text-xs font-medium text-primary hover:underline">
          {items.length > 2 ? t('See all {count}', { count: items.length }) : t('Insights')}
        </Link>
      </CardHeader>
      {shown && <InsightList items={items.slice(0, 2)} className="-mt-1 border-t" />}
    </Card>
  );
}

function UpcomingCard() {
  const t = useT();
  const f = useFormat();
  const canWrite = useCanWrite();
  const { data: items = [] } = useUpcoming(21);
  const { data: series = [] } = useRecurring();
  const record = useRecordNow();
  const next = items.filter((i) => i.isNext || i.date >= f.today).slice(0, 5);
  if (next.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Coming up')}</CardTitle>
        <Link to="/recurring" className="hit-area text-xs font-medium text-primary hover:underline">
          {t('Recurring')}
        </Link>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-1">
        {next.map((i) => {
          // Bills due today or overdue can be recorded right here.
          const due = canWrite && isDue(i, f.today);
          const s = due ? series.find((r) => r.id === i.recurringId) : undefined;
          return (
            <div key={`${i.recurringId}-${i.date}`} className="flex items-center gap-2">
              <Link
                to="/recurring"
                className="-mx-2 flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{i.name}</span>
                  <span
                    className={cn(
                      'block text-xs text-muted-foreground',
                      i.overdue && 'font-medium text-destructive',
                    )}
                  >
                    {dueLabel(i.date, f)}
                  </span>
                </span>
                <Money
                  minor={i.amountMinor}
                  currency={i.currency}
                  signed={i.amountMinor > 0}
                  colored={i.kind !== 'transfer'}
                  className="text-sm"
                />
              </Link>
              {s && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={record.pending}
                  onClick={() => record.recordNow(s)}
                  aria-label={`${t('Record')} ${i.name}`}
                >
                  {t('Record')}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function AttentionCard({ data }: { data: Dashboard }) {
  const t = useT();
  const items: Array<{
    icon: typeof Inbox;
    label: string;
    hint: string;
    search: { tab: 'review' | 'uncategorized' };
  }> = [];
  if (data.needsReviewCount > 0) {
    items.push({
      icon: Inbox,
      label: t('{count} to review', { count: data.needsReviewCount }),
      hint: t('Imported transactions waiting for a quick check'),
      search: { tab: 'review' },
    });
  }
  if (data.uncategorizedCount > 0) {
    items.push({
      icon: Tags,
      label: t('{count} uncategorized', { count: data.uncategorizedCount }),
      hint: t('Give them a category for accurate reports'),
      search: { tab: 'uncategorized' },
    });
  }

  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-2 pt-4">
        {items.length === 0 ? (
          <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-positive" /> {t('All caught up')}
          </p>
        ) : (
          items.map((item) => (
            <Link
              key={item.label}
              to="/inbox"
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
