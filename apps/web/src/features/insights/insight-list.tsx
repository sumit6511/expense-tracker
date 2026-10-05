import { type Cadence, getMonthPeriod, type Insight, type PeriodSettings } from '@et/shared';
import { Link } from '@tanstack/react-router';
import {
  CircleDollarSign,
  type LucideIcon,
  PiggyBank,
  Repeat,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Trophy,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useRecurringDialog } from '@/features/recurring/recurring-dialog';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useAccountMap,
  useCategoryMap,
  useDismissInsight,
  useUpdateRecurring,
} from '@/lib/queries';
import { useCanWrite, useWorkspace } from '@/lib/session';
import { cn } from '@/lib/utils';

const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: 'weekly',
  monthly: 'monthly',
  quarterly: 'every 3 months',
  yearly: 'yearly',
};

const TONE_CLASS = {
  warning: 'bg-warning/15 text-warning',
  positive: 'bg-positive/10 text-positive',
  info: 'bg-primary/10 text-primary',
} as const;

const percent = (fraction: number) => `${Math.round(Math.abs(fraction) * 100)}%`;

interface Worded {
  icon: LucideIcon;
  title: string;
  body: string;
}

/** Turns the facts from the API into a sentence, in the reader's calendar and number format. */
function useWording() {
  const f = useFormat();
  const ws = useWorkspace();
  const categories = useCategoryMap();
  const accounts = useAccountMap();
  const settings: PeriodSettings = { calendar: ws.calendar, monthStartDay: ws.monthStartDay };
  const month = (start: string) => f.month(getMonthPeriod(start, settings));
  const category = (id: string | null) => (id && categories.get(id)?.name) || 'Uncategorized';
  const money = (minor: number, currency?: string) =>
    f.money(minor, currency, { trimZeroFraction: true });
  return (i: Insight): Worded => {
    switch (i.kind) {
      case 'unusual_spending':
        return {
          icon: TrendingUp,
          title: i.current
            ? `${category(i.categoryId)} is running high this month`
            : `${category(i.categoryId)} was high in ${month(i.periodStart)}`,
          body:
            i.usualMinor > 0
              ? `${money(i.amountMinor)}${i.current ? ' so far' : ''}, against a usual ${money(i.usualMinor)} a month.`
              : `${money(i.amountMinor)}${i.current ? ' so far' : ''}, where you usually spend little or nothing.`,
        };
      case 'spending_down':
        return {
          icon: TrendingDown,
          title: `${category(i.categoryId)} was down in ${month(i.periodStart)}`,
          body: `${money(i.amountMinor)}: ${percent(1 - i.amountMinor / i.usualMinor)} under your usual ${money(i.usualMinor)}.`,
        };
      case 'price_change': {
        const up = i.toMinor > i.fromMinor;
        const change = percent(i.toMinor / i.fromMinor - 1);
        return {
          icon: CircleDollarSign,
          title:
            i.flow === 'expense'
              ? `${i.payeeName} ${up ? 'went up' : 'went down'} to ${money(i.toMinor, i.currency)}`
              : `${i.payeeName} now pays ${money(i.toMinor, i.currency)}`,
          body: `It was ${money(i.fromMinor, i.currency)} (${change} ${up ? 'more' : 'less'}), ${CADENCE_LABEL[i.cadence]}. Changed on ${f.date(i.date, 'short')}.`,
        };
      }
      case 'low_balance': {
        const name = accounts.get(i.accountId)?.name ?? 'An account';
        return {
          icon: TriangleAlert,
          title: `${name} may run short`,
          body: `Scheduled bills would take it to ${money(i.lowestMinor, i.currency)} by ${f.date(i.lowestDate, 'short')}; it has ${money(i.balanceMinor, i.currency)} now.`,
        };
      }
      case 'saved': {
        const rate = (i.incomeMinor - i.expenseMinor) / i.incomeMinor;
        return {
          icon: PiggyBank,
          title: `You kept ${percent(rate)} of your income in ${month(i.periodStart)}`,
          body: `${money(i.incomeMinor)} in, ${money(i.expenseMinor)} out.${i.streak > 1 ? ` That’s ${i.streak} months in a row with more in than out.` : ''}`,
        };
      }
      case 'budget_streak':
        return {
          icon: Trophy,
          title: `${i.months} months within budget on ${category(i.categoryId)}`,
          body: 'Every month since you set it. Keep it going this month.',
        };
      case 'new_recurring': {
        const s = i.suggestion;
        return {
          icon: Repeat,
          title: `${s.payeeName} looks ${CADENCE_LABEL[s.cadence]}`,
          body: `${money(s.amountMinor, s.currency)}${s.fixed ? ' each time' : ' or so'}, seen ${s.count} times, last on ${f.date(s.lastDate, 'short')}. Track it to see it coming.`,
        };
      }
    }
  };
}

function useAction() {
  const f = useFormat();
  const canWrite = useCanWrite();
  const { openRecurring } = useRecurringDialog();
  const updateRecurring = useUpdateRecurring();
  const dismiss = useDismissInsight();
  const link = (label: string, to: string, search?: Record<string, string>) => (
    <Button size="sm" variant="outline" asChild>
      <Link to={to} search={search}>
        {label}
      </Link>
    </Button>
  );
  return (i: Insight): ReactNode => {
    switch (i.kind) {
      case 'unusual_spending':
      case 'spending_down':
        return link('See transactions', '/transactions', {
          ...(i.categoryId ? { categoryIds: i.categoryId } : {}),
          from: i.periodStart,
          to: i.periodEnd,
        });
      case 'price_change':
        if (canWrite && i.recurringId && i.recurringAmountMinor !== i.toMinor) {
          const id = i.recurringId;
          return (
            <Button
              size="sm"
              variant="outline"
              disabled={updateRecurring.isPending}
              onClick={async () => {
                try {
                  await updateRecurring.mutateAsync({ id, amountMinor: i.toMinor });
                  dismiss.mutate(i.key);
                  toast.success(`${i.payeeName} now expects ${f.money(i.toMinor, i.currency)}`);
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              Update the bill
            </Button>
          );
        }
        return link('See payments', '/transactions', { payeeIds: i.payeeId });
      case 'low_balance':
        return link('See what’s due', '/recurring');
      case 'new_recurring': {
        if (!canWrite) return null;
        const s = i.suggestion;
        return (
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
            Track it
          </Button>
        );
      }
      default:
        return null;
    }
  };
}

export function InsightList({ items, className }: { items: Insight[]; className?: string }) {
  const word = useWording();
  const action = useAction();
  const dismiss = useDismissInsight();
  return (
    <ul className={cn('divide-y', className)}>
      {items.map((i) => {
        const w = word(i);
        const act = action(i);
        return (
          <li key={i.key} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
            <span
              className={cn(
                'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full [&_svg]:size-4',
                TONE_CLASS[i.tone],
              )}
              aria-hidden
            >
              <w.icon />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{w.title}</p>
              <p className="mt-0.5 text-compact text-muted-foreground">{w.body}</p>
              {act && <div className="mt-2 flex flex-wrap gap-2">{act}</div>}
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              className="-mr-1 text-muted-foreground"
              aria-label={`Dismiss: ${w.title}`}
              onClick={() =>
                dismiss.mutate(i.key, { onError: (err) => toast.error(errorMessage(err)) })
              }
            >
              <X />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
