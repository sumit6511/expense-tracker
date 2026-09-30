import { addDays, type Recurring, type UpcomingItem } from '@et/shared';
import { Link } from '@tanstack/react-router';
import {
  ArrowLeftRight,
  CalendarClock,
  Ellipsis,
  History,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  SkipForward,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { CategoryIcon } from '@/components/icons';
import { Money } from '@/components/money';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useAccountMap,
  useCategoryMap,
  useDeleteRecurring,
  useDismissInsight,
  useRecordRecurring,
  useRecurring,
  useRecurringSuggestions,
  useSkipRecurring,
  useUpcoming,
  useUpdateRecurring,
} from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { cn } from '@/lib/utils';
import { describeSchedule, dueLabel, recurringStart, useRecurringDialog } from './recurring-dialog';

export function RecurringPage() {
  const f = useFormat();
  const list = useRecurring();
  const upcoming = useUpcoming(30);
  const { openRecurring } = useRecurringDialog();
  const canWrite = useCanWrite();

  const series = list.data ?? [];
  const byId = useMemo(() => new Map(series.map((r) => [r.id, r])), [series]);
  const active = series.filter((r) => r.active && r.nextDate);
  const monthlyOut = active.reduce(
    (s, r) => s + (r.monthlyBaseMinor !== null && r.monthlyBaseMinor < 0 ? r.monthlyBaseMinor : 0),
    0,
  );
  const monthlyIn = active.reduce(
    (s, r) => s + (r.monthlyBaseMinor !== null && r.monthlyBaseMinor > 0 ? r.monthlyBaseMinor : 0),
    0,
  );
  const items = upcoming.data ?? [];
  const due = items.filter((i) => i.isNext && i.mode === 'remind' && i.date <= f.today);
  const later = items.filter((i) => !(i.isNext && i.mode === 'remind' && i.date <= f.today));
  const weekOut = items
    .filter((i) => i.date >= f.today && i.date <= addDays(f.today, 7) && i.amountMinor < 0)
    .filter((i) => i.currency === f.base && i.kind !== 'transfer')
    .reduce((s, i) => s + i.amountMinor, 0);

  return (
    <div className="grid grid-cols-1 gap-4 pb-10">
      <PageHeader
        title="Recurring"
        className="mb-0"
        description="Bills, subscriptions, salary and regular transfers."
        actions={
          canWrite && (
            <Button onClick={() => openRecurring()}>
              <Plus /> New recurring
            </Button>
          )
        }
      />
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : list.isPending ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <Card className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <Summary label="Bills per month" hint="Recurring expenses, averaged">
              <Money minor={monthlyOut} trimZero />
            </Summary>
            <Summary label="Income per month" hint="Salary and other regular income">
              <Money minor={monthlyIn} trimZero />
            </Summary>
            <Summary label="Due in the next 7 days" hint={`${f.base} bills`}>
              <Money minor={weekOut} trimZero />
            </Summary>
          </Card>

          {due.length > 0 && (
            <Card className="border-warning/50">
              <CardHeader>
                <CardTitle>Due now</CardTitle>
                <span className="text-xs text-muted-foreground">
                  Record them when paid, or skip
                </span>
              </CardHeader>
              <div className="divide-y border-t">
                {due.map((item) => (
                  <UpcomingRow
                    key={`${item.recurringId}-${item.date}`}
                    item={item}
                    series={byId.get(item.recurringId)}
                    actions={canWrite}
                  />
                ))}
              </div>
            </Card>
          )}

          <Suggestions />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Next 30 days</CardTitle>
              </CardHeader>
              {later.length === 0 ? (
                <p className="px-5 pb-6 text-sm text-muted-foreground">Nothing coming up.</p>
              ) : (
                <div className="divide-y border-t">
                  {later.slice(0, 40).map((item) => (
                    <UpcomingRow
                      key={`${item.recurringId}-${item.date}`}
                      item={item}
                      series={byId.get(item.recurringId)}
                      actions={false}
                    />
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>All recurring</CardTitle>
                <span className="text-xs text-muted-foreground">{series.length}</span>
              </CardHeader>
              {series.length === 0 ? (
                <EmptyState
                  icon={Repeat}
                  title="Nothing recurring yet"
                  description="Add rent, internet, school fees, EMIs or your salary to see what’s coming and get reminded."
                  action={
                    canWrite && (
                      <Button onClick={() => openRecurring()}>
                        <Plus /> New recurring
                      </Button>
                    )
                  }
                />
              ) : (
                <div className="divide-y border-t">
                  {series.map((r) => (
                    <SeriesRow key={r.id} r={r} canWrite={canWrite} />
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Summary({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  // A row on phones, a column on wider screens.
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 sm:block sm:px-5 sm:py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular sm:mt-1 sm:text-xl">{children}</p>
      <p className="hidden text-xs text-muted-foreground sm:mt-0.5 sm:block">{hint}</p>
    </div>
  );
}

function SeriesIcon({ kind, categoryId }: { kind: Recurring['kind']; categoryId: string | null }) {
  const categories = useCategoryMap();
  const cat = categoryId ? categories.get(categoryId) : undefined;
  if (kind === 'transfer')
    return (
      <span className="grid size-9 shrink-0 grid-cols-1 place-items-center rounded-full bg-muted text-muted-foreground">
        <ArrowLeftRight className="size-[18px]" />
      </span>
    );
  return <CategoryIcon icon={cat?.icon ?? 'repeat'} color={cat?.color} />;
}

/** One occurrence in the due/upcoming lists. */
function UpcomingRow({
  item,
  series,
  actions,
}: {
  item: UpcomingItem;
  series: Recurring | undefined;
  actions: boolean;
}) {
  const f = useFormat();
  const accounts = useAccountMap();
  const { openRecord } = useRecurringDialog();
  const record = useRecordRecurring();
  const skip = useSkipRecurring();

  // mutateAsync rather than mutate callbacks: this row unmounts as soon as the list refreshes,
  // and callbacks passed to mutate() are skipped for unmounted components.
  async function recordNow() {
    if (!series) return;
    if (series.variableAmount) {
      openRecord(series);
      return;
    }
    try {
      await record.mutateAsync({ id: series.id });
      toast.success(`${series.name} recorded`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function skipNow() {
    if (!series) return;
    try {
      await skip.mutateAsync(series.id);
      toast(`Skipped ${series.name} this time`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
      <SeriesIcon kind={item.kind} categoryId={item.categoryId} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {item.name}
          {item.mode === 'auto' && <Badge>Auto</Badge>}
        </p>
        <p
          className={cn(
            'text-xs text-muted-foreground',
            item.overdue && 'font-medium text-destructive',
          )}
        >
          {dueLabel(item.date, f)} · {accounts.get(item.accountId)?.name ?? 'Account'}
        </p>
      </div>
      <div className="text-right">
        <Money
          minor={item.amountMinor}
          currency={item.currency}
          signed={item.amountMinor > 0}
          colored={item.kind !== 'transfer'}
          className="text-sm font-medium"
        />
        {item.variableAmount && <p className="text-[11px] text-muted-foreground">usually</p>}
      </div>
      {actions && series && (
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={recordNow}
            disabled={record.isPending}
          >
            Record
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 sm:flex-none"
            disabled={skip.isPending}
            onClick={skipNow}
          >
            Skip
          </Button>
        </div>
      )}
    </div>
  );
}

function SeriesRow({ r, canWrite }: { r: Recurring; canWrite: boolean }) {
  const f = useFormat();
  const { openRecurring, openRecord } = useRecurringDialog();
  const update = useUpdateRecurring();
  const skip = useSkipRecurring();
  const remove = useDeleteRecurring();
  const confirm = useConfirm();
  const ended = r.nextDate === null;
  const signed = r.kind === 'income' ? r.amountMinor : -r.amountMinor;

  return (
    <div className={cn('flex items-center gap-3 px-4 py-3', (!r.active || ended) && 'opacity-60')}>
      <SeriesIcon kind={r.kind} categoryId={r.categoryId} />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => canWrite && openRecurring(recurringStart(r))}
      >
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{r.name}</span>
          {!r.active && <Badge>Paused</Badge>}
          {ended && <Badge>Ended</Badge>}
          {r.mode === 'auto' && r.active && !ended && <Badge>Auto</Badge>}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground sm:line-clamp-1">
          {describeSchedule({ ...r, anchor: r.nextDate ?? r.lastPostedDate ?? f.today })}
          {r.nextDate && r.active ? ` · next ${dueLabel(r.nextDate, f, true)}` : ''}
          {r.remaining !== null && r.nextDate ? ` · ${r.remaining} left` : ''}
        </span>
      </button>
      <div className="shrink-0 text-right">
        <Money
          minor={signed}
          currency={r.currency}
          signed={signed > 0}
          colored={r.kind !== 'transfer'}
          className="text-sm font-medium"
        />
        {r.variableAmount && <p className="text-[11px] text-muted-foreground">varies</p>}
      </div>
      {canWrite && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`${r.name} options`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => openRecurring(recurringStart(r))}>
              <Pencil /> Edit
            </DropdownMenuItem>
            {!ended && (
              <>
                <DropdownMenuItem onSelect={() => openRecord(r)}>
                  <CalendarClock /> Record next now
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    skip.mutate(r.id, {
                      onSuccess: (next) =>
                        toast(
                          next.nextDate
                            ? `Skipped · next ${f.date(next.nextDate)}`
                            : 'Skipped · that was the last one',
                        ),
                      onError: (e) => toast.error(errorMessage(e)),
                    })
                  }
                >
                  <SkipForward /> Skip next
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    update.mutate(
                      { id: r.id, active: !r.active },
                      { onError: (e) => toast.error(errorMessage(e)) },
                    )
                  }
                >
                  {r.active ? <Pause /> : <Play />} {r.active ? 'Pause' : 'Resume'}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem asChild>
              <Link to="/transactions" search={{ recurringId: r.id }}>
                <History /> History
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onSelect={async () => {
                const ok = await confirm({
                  title: `Delete “${r.name}”?`,
                  description: 'Transactions already recorded from it are kept.',
                  confirmLabel: 'Delete',
                  destructive: true,
                });
                if (ok) remove.mutate(r.id, { onError: (e) => toast.error(errorMessage(e)) });
              }}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

const CADENCE_LABEL = {
  weekly: 'weekly',
  monthly: 'monthly',
  quarterly: 'every 3 months',
  yearly: 'yearly',
} as const;

function Suggestions() {
  const f = useFormat();
  const canWrite = useCanWrite();
  const { data = [] } = useRecurringSuggestions();
  const dismiss = useDismissInsight();
  const { openRecurring } = useRecurringDialog();
  if (!canWrite || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> Looks recurring
        </CardTitle>
        <span className="text-xs text-muted-foreground">Found in your history</span>
      </CardHeader>
      <div className="divide-y border-t">
        {data.slice(0, 5).map((s) => (
          <div key={s.dismissKey} className="flex items-center gap-3 px-4 py-3">
            <SeriesIcon kind={s.kind} categoryId={s.categoryId} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.payeeName}</p>
              <p className="text-xs text-muted-foreground">
                <Money
                  minor={s.kind === 'income' ? s.amountMinor : -s.amountMinor}
                  currency={s.currency}
                  className="font-medium text-foreground sm:hidden"
                />
                <span className="sm:hidden"> · </span>
                {CADENCE_LABEL[s.cadence]}
                {s.fixed ? '' : ', amount varies'} · seen {s.count} times
                <span className="hidden sm:inline"> · last {f.date(s.lastDate, 'short')}</span>
              </p>
            </div>
            <Money
              minor={s.kind === 'income' ? s.amountMinor : -s.amountMinor}
              currency={s.currency}
              className="hidden text-sm font-medium sm:block"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                openRecurring({
                  name: s.payeeName,
                  kind: s.kind,
                  accountId: s.accountId,
                  amountMinor: s.amountMinor,
                  variableAmount: !s.fixed,
                  payee: s.payeeName,
                  categoryId: s.categoryId,
                  frequency: s.frequency,
                  interval: s.interval,
                  calendar: s.frequency === 'weekly' ? 'ad' : f.calendar,
                  nextDate: s.nextDate,
                })
              }
            >
              Track
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Not recurring: ${s.payeeName}`}
              onClick={() =>
                dismiss.mutate(s.dismissKey, { onError: (err) => toast.error(errorMessage(err)) })
              }
            >
              <X />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
