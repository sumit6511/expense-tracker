import {
  type BudgetMonth,
  getMonthPeriod,
  parseAmountInput,
  shiftMonthPeriod,
  toDecimalString,
} from '@et/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Copy, Sigma, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CategoryIcon } from '@/components/icons';
import { Money } from '@/components/money';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, Progress, Skeleton } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useBudgetMonth,
  useCategories,
  useCopyBudgets,
  useFillAverageBudgets,
  useSetBudgets,
} from '@/lib/queries';
import { useCanWrite, useWorkspace } from '@/lib/session';
import { cn, storage } from '@/lib/utils';

export function BudgetsPage() {
  const search = useSearch({ from: '/app/budgets' });
  const navigate = useNavigate({ from: '/budgets' });
  const ws = useWorkspace();
  const f = useFormat();
  const settings = { calendar: ws.calendar, monthStartDay: ws.monthStartDay };
  const period = getMonthPeriod(search.date ?? f.today, settings);
  const month = useBudgetMonth(period.start);
  const canWrite = useCanWrite();
  const copy = useCopyBudgets();
  const fill = useFillAverageBudgets();
  const [showAll, setShowAll] = useState(() => storage.get('et.budgets.showAll') === '1');

  const go = (delta: number) =>
    navigate({ search: { date: shiftMonthPeriod(period, delta, settings).start } });
  const previous = shiftMonthPeriod(period, -1, settings);

  async function copyLast() {
    try {
      const { count } = await copy.mutateAsync({
        fromPeriodStart: previous.start,
        toPeriodStart: period.start,
      });
      toast.success(
        count
          ? `Copied ${count} budget${count === 1 ? '' : 's'} from last month`
          : 'Nothing new to copy',
      );
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function fillAverages() {
    try {
      const { count } = await fill.mutateAsync({ periodStart: period.start, months: 3 });
      toast.success(
        count
          ? `Set ${count} budget${count === 1 ? '' : 's'} from your 3-month averages`
          : 'Every category with spending already has a budget',
      );
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => go(-1)}
              aria-label="Previous month"
            >
              <ChevronLeft />
            </Button>
            <span>{month.data?.period.label ?? '…'}</span>
            <Button variant="ghost" size="icon-sm" onClick={() => go(1)} aria-label="Next month">
              <ChevronRight />
            </Button>
          </span>
        }
        description={`Budget month: ${f.date(period.start, 'short')} – ${f.date(period.end, 'medium')}`}
        actions={
          canWrite && (
            <>
              <Button variant="outline" size="sm" onClick={copyLast} disabled={copy.isPending}>
                <Copy /> Copy last month
              </Button>
              <Button variant="outline" size="sm" onClick={fillAverages} disabled={fill.isPending}>
                <Sigma /> Use 3-month averages
              </Button>
            </>
          )
        }
      />
      {month.error && <ErrorState error={month.error} retry={() => month.refetch()} />}
      {month.data ? (
        <BudgetBody
          data={month.data}
          showAll={showAll}
          onShowAll={(v) => {
            setShowAll(v);
            storage.set('et.budgets.showAll', v ? '1' : null);
          }}
        />
      ) : (
        !month.error && (
          <div className="grid grid-cols-1 gap-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-80" />
          </div>
        )
      )}
    </div>
  );
}

function BudgetBody({
  data,
  showAll,
  onShowAll,
}: {
  data: BudgetMonth;
  showAll: boolean;
  onShowAll: (v: boolean) => void;
}) {
  const f = useFormat();
  const { data: groups = [] } = useCategories();
  const t = data.totals;
  const ratio = t.budgetedMinor > 0 ? (t.spentMinor / t.budgetedMinor) * 100 : 0;
  const lines = useMemo(() => new Map(data.lines.map((l) => [l.categoryId, l])), [data.lines]);
  const anyBudget = t.budgetedMinor > 0;

  const expenseGroups = groups
    .filter((g) => g.kind === 'expense')
    .map((g) => ({
      ...g,
      categories: g.categories.filter((c) => {
        const line = lines.get(c.id);
        if (!line) return false;
        if (c.archived && line.budgetedMinor === 0 && line.spentMinor === 0) return false;
        return showAll || line.budgetedMinor > 0 || line.spentMinor !== 0 || line.averageMinor > 0;
      }),
    }))
    .filter((g) => g.categories.length > 0);

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid grid-cols-1 gap-3">
            <div className="grid grid-cols-3 gap-4">
              <Figure label="Budgeted" minor={t.budgetedMinor} />
              <Figure label="Spent" minor={t.spentMinor} />
              <Figure
                label={t.remainingMinor < 0 ? 'Over budget' : 'Left'}
                minor={Math.abs(t.remainingMinor)}
                className={cn(t.remainingMinor < 0 && 'text-destructive')}
              />
            </div>
            {anyBudget && (
              <Progress
                value={ratio}
                tone={ratio > 100 ? 'destructive' : ratio > 85 ? 'warning' : 'primary'}
                label="Share of budget spent"
              />
            )}
            <p className="text-xs text-muted-foreground">
              {t.unbudgetedSpentMinor > 0 && (
                <>
                  {f.money(t.unbudgetedSpentMinor, undefined, { trimZeroFraction: true })} spent in
                  categories without a budget.{' '}
                </>
              )}
              Income this month: {f.money(t.incomeMinor, undefined, { trimZeroFraction: true })}.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={showAll}
              onCheckedChange={onShowAll}
              aria-label="Show all categories"
            />{' '}
            Show all categories
          </label>
        </CardContent>
      </Card>

      {!anyBudget && expenseGroups.length === 0 && (
        <Card>
          <EmptyState
            icon={Target}
            title="No budgets yet"
            description="Turn on “Show all categories” and type an amount next to any category, or use your 3-month averages once you’ve tracked a little."
          />
        </Card>
      )}

      {expenseGroups.map((g) => {
        const budgeted = g.categories.reduce(
          (s, c) => s + (lines.get(c.id)?.budgetedMinor ?? 0),
          0,
        );
        const spent = g.categories.reduce((s, c) => s + (lines.get(c.id)?.spentMinor ?? 0), 0);
        return (
          <Card key={g.id} className="overflow-hidden">
            <header className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
              <h2 className="text-sm font-semibold">{g.name}</h2>
              <span className="text-xs text-muted-foreground tabular">
                {f.money(spent, undefined, { trimZeroFraction: true })} of{' '}
                {f.money(budgeted, undefined, { trimZeroFraction: true })}
              </span>
            </header>
            <ul className="divide-y">
              {g.categories.map((c) => (
                <BudgetRow
                  key={`${data.period.start}:${c.id}:${lines.get(c.id)?.budgetedMinor}`}
                  category={c}
                  line={lines.get(c.id)!}
                  periodStart={data.period.start}
                  periodEnd={data.period.end}
                />
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function Figure({ label, minor, className }: { label: string; minor: number; className?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold sm:text-2xl', className)}>
        <Money minor={minor} trimZero />
      </p>
    </div>
  );
}

function BudgetRow({
  category,
  line,
  periodStart,
  periodEnd,
}: {
  category: { id: string; name: string; icon: string; color: string };
  line: BudgetMonth['lines'][number];
  periodStart: string;
  periodEnd: string;
}) {
  const f = useFormat();
  const canWrite = useCanWrite();
  const setBudgets = useSetBudgets();
  const digits = f.digits();
  const initial = line.budgetedMinor
    ? toDecimalString(line.budgetedMinor, digits).replace(/\.0+$/, '')
    : '';
  const [value, setValue] = useState(initial);
  const [editing, setEditing] = useState(false);

  const ratio = line.budgetedMinor > 0 ? (line.spentMinor / line.budgetedMinor) * 100 : 0;
  // Amber while close to the limit; exactly on budget (a fixed bill fully paid) is fine.
  const tone =
    line.budgetedMinor === 0
      ? 'muted'
      : ratio > 100
        ? 'destructive'
        : ratio >= 85 && ratio < 100
          ? 'warning'
          : 'primary';

  async function save(text: string) {
    setEditing(false);
    const parsed = text.trim() === '' ? 0 : parseAmountInput(text, digits);
    if (parsed === null || parsed < 0) {
      toast.error('Enter a positive amount');
      setValue(initial);
      return;
    }
    if (parsed === line.budgetedMinor) return;
    try {
      await setBudgets.mutateAsync({
        periodStart,
        items: [{ categoryId: category.id, amountMinor: parsed }],
      });
    } catch (err) {
      toast.error(errorMessage(err));
      setValue(initial);
    }
  }

  return (
    <li className="grid grid-cols-1 gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <CategoryIcon icon={category.icon} color={category.color} size="sm" />
        <Link
          to="/transactions"
          search={{ categoryIds: category.id, from: periodStart, to: periodEnd }}
          className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
        >
          {category.name}
        </Link>
        <div className="flex items-center gap-2">
          <span className="hidden text-right text-xs text-muted-foreground sm:block">
            <Money minor={line.spentMinor} trimZero /> spent
          </span>
          <Input
            value={
              editing
                ? value
                : value
                  ? f.money(parseAmountInput(value, digits) ?? 0, undefined, {
                      display: 'none',
                      trimZeroFraction: true,
                    })
                  : ''
            }
            onFocus={() => setEditing(true)}
            onChange={(e) => setValue(e.target.value)}
            onBlur={(e) => save(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setValue(initial);
                setEditing(false);
              }
            }}
            inputMode="decimal"
            placeholder="Budget"
            disabled={!canWrite}
            aria-label={`Budget for ${category.name}`}
            className="h-8 w-28 text-right tabular"
          />
        </div>
      </div>
      <div className="flex items-center gap-3 pl-10">
        <Progress
          value={line.budgetedMinor > 0 ? ratio : 0}
          tone={tone}
          className="h-1.5 flex-1"
          label={`${category.name} budget used`}
        />
        <span
          className={cn(
            'w-28 text-right text-xs tabular',
            line.remainingMinor < 0 && line.budgetedMinor > 0
              ? 'text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {line.budgetedMinor > 0
            ? line.remainingMinor >= 0
              ? `${f.money(line.remainingMinor, undefined, { trimZeroFraction: true })} left`
              : `${f.money(-line.remainingMinor, undefined, { trimZeroFraction: true })} over`
            : `${f.money(line.spentMinor, undefined, { trimZeroFraction: true })} spent`}
        </span>
      </div>
      {line.averageMinor > 0 && line.budgetedMinor === 0 && canWrite && (
        <button
          type="button"
          className="justify-self-start pl-10 text-xs text-primary hover:underline"
          onClick={() => {
            const avg = Math.ceil(line.averageMinor / 10 ** digits) * 10 ** digits;
            const text = toDecimalString(avg, digits).replace(/\.0+$/, '');
            setValue(text);
            save(text);
          }}
        >
          Use 3-month average ({f.money(line.averageMinor, undefined, { trimZeroFraction: true })})
        </button>
      )}
    </li>
  );
}
