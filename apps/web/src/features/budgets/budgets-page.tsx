import {
  type BudgetMonth,
  getMonthPeriod,
  parseAmountInput,
  type RolloverMode,
  shiftMonthPeriod,
  toDecimalString,
} from '@et/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Check, ChevronLeft, ChevronRight, Copy, Repeat, Sigma, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CategoryIcon } from '@/components/icons';
import { Money } from '@/components/money';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { AmountInput } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, Progress, Skeleton } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Segmented,
  Switch,
  Tooltip,
} from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useBudgetMonth,
  useCategories,
  useCopyBudgets,
  useFillAverageBudgets,
  useSetBudgetCap,
  useSetBudgets,
  useSetRollover,
} from '@/lib/queries';
import { useCanWrite, useWorkspace } from '@/lib/session';
import { cn, storage } from '@/lib/utils';
import { GoalsView } from './goals-view';

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

  const view = search.view ?? 'budget';
  const viewSwitch = (
    <Segmented
      size="sm"
      label="Show"
      value={view}
      onChange={(v) =>
        navigate({ search: (s) => ({ ...s, view: v === 'budget' ? undefined : v }) })
      }
      options={[
        { value: 'budget', label: 'Budget' },
        { value: 'goals', label: 'Goals' },
      ]}
    />
  );

  if (view === 'goals') {
    return (
      <div className="pb-10">
        <PageHeader title="Goals" actions={viewSwitch} />
        <GoalsView />
      </div>
    );
  }

  return (
    <div className="pb-10">
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
          <>
            {viewSwitch}
            {canWrite && (
              <>
                <Button variant="outline" size="sm" onClick={copyLast} disabled={copy.isPending}>
                  <Copy /> Copy last month
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fillAverages}
                  disabled={fill.isPending}
                >
                  <Sigma /> Use 3-month averages
                </Button>
              </>
            )}
          </>
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
  const available = t.budgetedMinor + t.carryInMinor;
  const ratio = available > 0 ? (t.spentMinor / available) * 100 : 0;
  const lines = useMemo(() => new Map(data.lines.map((l) => [l.categoryId, l])), [data.lines]);
  const anyBudget = available > 0;

  const expenseGroups = groups
    .filter((g) => g.kind === 'expense')
    .map((g) => ({
      ...g,
      categories: g.categories.filter((c) => {
        const line = lines.get(c.id);
        if (!line) return false;
        if (c.archived && line.budgetedMinor === 0 && line.spentMinor === 0) return false;
        return (
          showAll ||
          line.budgetedMinor > 0 ||
          line.carryInMinor !== 0 ||
          line.rollover !== 'none' ||
          line.spentMinor !== 0 ||
          line.averageMinor > 0
        );
      }),
    }))
    .filter((g) => g.categories.length > 0);

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid grid-cols-1 gap-3">
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-3 sm:gap-4">
              <Figure label="Budgeted" minor={available} />
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
              {t.carryInMinor !== 0 && (
                <>
                  Includes {f.money(t.carryInMinor, undefined, { trimZeroFraction: true })}{' '}
                  {t.carryInMinor > 0 ? 'rolled over from' : 'of overspending carried from'} last
                  month.{' '}
                </>
              )}
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

      <MonthlyLimit data={data} />

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
          (s, c) => s + (lines.get(c.id)?.availableMinor ?? 0),
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

/** Label and amount: side by side on phones, stacked on wider screens. */
function Figure({ label, minor, className }: { label: string; minor: number; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 sm:block">
      <p className="text-sm text-muted-foreground sm:text-xs">{label}</p>
      <p className={cn('text-lg font-semibold sm:mt-0.5 sm:text-2xl', className)}>
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

  const available = line.availableMinor;
  const ratio = available > 0 ? (line.spentMinor / available) * 100 : line.spentMinor > 0 ? 101 : 0;
  // Amber while close to the limit; exactly on budget (a fixed bill fully paid) is fine.
  const tone =
    available === 0 && line.budgetedMinor === 0
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
          <RolloverMenu
            categoryName={category.name}
            categoryId={category.id}
            line={line}
            periodStart={periodStart}
          />
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
          value={available !== 0 || line.budgetedMinor > 0 ? ratio : 0}
          tone={tone}
          className="h-1.5 flex-1"
          label={`${category.name} budget used`}
        />
        <span
          className={cn(
            'w-28 text-right text-xs tabular',
            line.remainingMinor < 0 && (available !== 0 || line.budgetedMinor > 0)
              ? 'text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {available !== 0 || line.budgetedMinor > 0
            ? line.remainingMinor >= 0
              ? `${f.money(line.remainingMinor, undefined, { trimZeroFraction: true })} left`
              : `${f.money(-line.remainingMinor, undefined, { trimZeroFraction: true })} over`
            : `${f.money(line.spentMinor, undefined, { trimZeroFraction: true })} spent`}
        </span>
      </div>
      {line.carryInMinor !== 0 && (
        <p
          className={cn(
            'pl-10 text-xs',
            line.carryInMinor > 0 ? 'text-positive' : 'text-destructive',
          )}
        >
          {line.carryInMinor > 0
            ? `+${f.money(line.carryInMinor, undefined, { trimZeroFraction: true })} rolled over from last month`
            : `${f.money(-line.carryInMinor, undefined, { trimZeroFraction: true })} overspent last month comes out of this one`}
        </p>
      )}
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
          Use 3-month average (
          {f.money(Math.ceil(line.averageMinor / 10 ** digits) * 10 ** digits, undefined, {
            trimZeroFraction: true,
          })}
          )
        </button>
      )}
    </li>
  );
}

const ROLLOVER_OPTIONS: Array<{ value: RolloverMode; label: string; hint: string }> = [
  { value: 'none', label: 'Start fresh each month', hint: 'Leftover money doesn’t carry over' },
  {
    value: 'surplus',
    label: 'Carry over what’s left',
    hint: 'Unspent money adds to next month; overspending is forgiven',
  },
  {
    value: 'all',
    label: 'Carry over everything',
    hint: 'Leftovers add to next month, overspending comes out of it',
  },
];

function RolloverMenu({
  categoryId,
  categoryName,
  line,
  periodStart,
}: {
  categoryId: string;
  categoryName: string;
  line: BudgetMonth['lines'][number];
  periodStart: string;
}) {
  const canWrite = useCanWrite();
  const setRollover = useSetRollover();
  const on = line.rollover !== 'none';
  return (
    <DropdownMenu>
      <Tooltip content={on ? 'Leftover carries over' : 'Rollover'}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={!canWrite}
            aria-label={`Rollover for ${categoryName}: ${ROLLOVER_OPTIONS.find((o) => o.value === line.rollover)?.label}`}
            className={cn(on ? 'text-primary' : 'text-muted-foreground/60')}
          >
            <Repeat />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>At the end of the month</DropdownMenuLabel>
        {ROLLOVER_OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() =>
              setRollover.mutate(
                {
                  categoryId,
                  mode: o.value,
                  // Switching it on starts with this month's leftover.
                  ...(line.rollover === 'none' && o.value !== 'none'
                    ? { fromPeriodStart: periodStart }
                    : {}),
                },
                { onError: (e) => toast.error(errorMessage(e)) },
              )
            }
            className="items-start"
          >
            <Check className={cn('mt-0.5', line.rollover !== o.value && 'invisible')} />
            <span>
              <span className="block">{o.label}</span>
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The overall monthly spending limit (applies from the month it's set until changed). */
function MonthlyLimit({ data }: { data: BudgetMonth }) {
  const f = useFormat();
  const canWrite = useCanWrite();
  const setCap = useSetBudgetCap();
  const digits = f.digits();
  const cap = data.cap;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  async function save() {
    const parsed = value.trim() === '' ? 0 : parseAmountInput(value, digits);
    if (parsed === null || parsed < 0) {
      toast.error('Enter a positive amount');
      return;
    }
    try {
      await setCap.mutateAsync({ periodStart: data.period.start, amountMinor: parsed });
      toast.success(parsed ? 'Monthly limit set' : 'Monthly limit removed', {
        description: parsed ? `From ${data.period.label} on` : undefined,
      });
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (editing) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="grid min-w-48 flex-1 grid-cols-1 gap-1.5">
            <label htmlFor="cap-amount" className="text-[13px] font-medium">
              Spend at most this much a month
            </label>
            <AmountInput
              id="cap-amount"
              currency={f.base}
              value={value}
              onChange={setValue}
              placeholder="No limit"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <p className="text-xs text-muted-foreground">
              Applies from {data.period.label} until you change it. Leave empty for no limit.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={setCap.isPending}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const start = () => {
    setValue(cap ? toDecimalString(cap.amountMinor, digits).replace(/\.0+$/, '') : '');
    setEditing(true);
  };

  if (!cap) {
    return canWrite ? (
      <button
        type="button"
        onClick={start}
        className="justify-self-start text-sm font-medium text-primary hover:underline"
      >
        Set an overall monthly spending limit
      </button>
    ) : null;
  }

  const ratio = cap.amountMinor > 0 ? (cap.spentMinor / cap.amountMinor) * 100 : 0;
  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-2 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">
            Monthly limit <Money minor={cap.amountMinor} trimZero />
          </p>
          <span
            className={cn(
              'text-sm tabular',
              cap.remainingMinor < 0 ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {cap.remainingMinor >= 0
              ? `${f.money(cap.remainingMinor, undefined, { trimZeroFraction: true })} left`
              : `${f.money(-cap.remainingMinor, undefined, { trimZeroFraction: true })} over`}
          </span>
        </div>
        <Progress
          value={ratio}
          tone={ratio > 100 ? 'destructive' : ratio >= 85 ? 'warning' : 'primary'}
          label="Share of monthly limit spent"
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            All spending counts, budgeted or not.
            {cap.sincePeriodStart !== data.period.start &&
              ` Set in ${f.date(cap.sincePeriodStart, 'short')}.`}
          </span>
          {canWrite && (
            <button
              type="button"
              onClick={start}
              className="font-medium text-primary hover:underline"
            >
              Change
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
