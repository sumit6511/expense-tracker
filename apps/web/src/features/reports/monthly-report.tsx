import {
  formatMonthPeriod,
  getMonthPeriod,
  type MonthPeriod,
  shiftMonthPeriod,
  type Transaction,
} from '@et/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowLeft, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { CategoryIcon } from '@/components/icons';
import { ErrorState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/card';
import { useFormat } from '@/lib/format';
import {
  useBudgetMonth,
  useCashFlow,
  useCategoryMap,
  useSpendingByCategory,
  useTransactions,
} from '@/lib/queries';
import { useWorkspace } from '@/lib/session';
import { cn } from '@/lib/utils';

/**
 * A one-month report laid out for paper: income and spending, where the money went against the
 * budget, and the largest expenses. "Download PDF" prints it; the browser saves it as a PDF.
 */
export function MonthlyReport() {
  const search = useSearch({ from: '/app/reports/monthly' });
  const navigate = useNavigate({ from: '/reports/monthly' });
  const f = useFormat();
  const ws = useWorkspace();
  const settings = { calendar: ws.calendar, monthStartDay: ws.monthStartDay };
  const period = getMonthPeriod(search.date ?? f.today, settings);
  const previous = shiftMonthPeriod(period, -1, settings);
  const title = formatMonthPeriod(period);

  // The file name browsers suggest when saving as PDF.
  useEffect(() => {
    const before = document.title;
    document.title = `${ws.name} – ${title}`;
    return () => {
      document.title = before;
    };
  }, [ws.name, title]);

  const go = (months: number) =>
    navigate({
      search: { date: shiftMonthPeriod(period, months, settings).start },
      replace: true,
    });

  return (
    <div className="mx-auto max-w-3xl pb-10 print:max-w-none print:pb-0">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/reports">
            <ArrowLeft /> Reports
          </Link>
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => go(-1)} aria-label="Previous month">
            <ChevronLeft />
          </Button>
          <span className="min-w-28 text-center text-sm font-medium">{title}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => go(1)}
            aria-label="Next month"
            disabled={period.start > f.today}
          >
            <ChevronRight />
          </Button>
        </div>
        <Button onClick={() => window.print()}>
          <Download /> Download PDF
        </Button>
      </div>
      <article className="rounded-2xl border bg-card p-6 shadow-xs sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <ReportBody period={period} previous={previous} />
      </article>
      <p className="mt-3 text-center text-xs text-muted-foreground print:hidden">
        “Download PDF” opens your browser’s print window: choose “Save as PDF”.
      </p>
    </div>
  );
}

function ReportBody({ period, previous }: { period: MonthPeriod; previous: MonthPeriod }) {
  const f = useFormat();
  const ws = useWorkspace();
  const categories = useCategoryMap();
  const range = { from: period.start, to: period.end };
  const spending = useSpendingByCategory(range);
  const flow = useCashFlow({ from: previous.start, to: period.end });
  const budget = useBudgetMonth(period.start);
  const expenses = useTransactions({ ...range, type: 'expense' }, 500);

  const error = spending.error ?? flow.error ?? budget.error;
  if (error) return <ErrorState error={error} />;
  if (!spending.data || !flow.data || !budget.data) return <Skeleton className="h-[40rem]" />;

  const money = (minor: number) => f.money(minor, undefined, { trimZeroFraction: true });
  const s = spending.data;
  const [before, now] = [flow.data.periods.at(-2), flow.data.periods.at(-1)];
  const income = s.totalIncomeMinor;
  const spent = s.totalExpenseMinor;
  const net = income - spent;
  const savedRate = income > 0 ? Math.round((net / income) * 100) : null;
  const change =
    before && before.expenseMinor > 0 && now
      ? Math.round((now.expenseMinor / before.expenseMinor - 1) * 100)
      : null;
  const nameOf = (id: string | null) => (id ? categories.get(id)?.name : null) ?? 'Uncategorized';
  const budgetOf = new Map(budget.data.lines.map((l) => [l.categoryId, l]));
  const top = s.expense.slice(0, 12);
  const rest = s.expense.slice(12).reduce((sum, e) => sum + e.amountMinor, 0);
  const budgeted = budget.data.lines.filter((l) => l.budgetedMinor > 0);
  const over = budgeted.filter((l) => l.remainingMinor < 0);

  const largest = (expenses.data?.pages.flatMap((p) => p.items) ?? [])
    .filter((t) => t.currency === f.base && !t.transfer)
    .sort((a, b) => a.amountMinor - b.amountMinor)
    .slice(0, 8);

  return (
    <div className="grid grid-cols-1 gap-8 text-sm">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b pb-5">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Monthly report · {ws.name}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {formatMonthPeriod(period)}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {f.date(period.start, 'long')} – {f.date(period.end, 'long')} · amounts in {f.base}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Prepared {f.date(f.today, 'medium')}</p>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4 print:grid-cols-4">
        <Tile label="Money in" value={money(income)} />
        <Tile label="Spent" value={money(spent)} />
        <Tile
          label={net >= 0 ? 'Kept' : 'Overspent'}
          value={money(Math.abs(net))}
          note={savedRate !== null && net > 0 ? `${savedRate}% of income` : undefined}
          tone={net >= 0 ? 'positive' : 'negative'}
        />
        <Tile
          label={`Spending vs ${formatMonthPeriod(previous, 'short')}`}
          value={change === null ? '–' : `${change > 0 ? '+' : ''}${change}%`}
          note={before ? money(before.expenseMinor) : undefined}
        />
      </section>

      <Section title="Where the money went">
        {top.length === 0 ? (
          <p className="text-muted-foreground">No spending this month.</p>
        ) : (
          <table className="w-full">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Category</th>
                <th className="py-2 text-right font-medium">Spent</th>
                <th className="hidden py-2 text-right font-medium sm:table-cell print:table-cell">
                  Share
                </th>
                <th className="hidden py-2 text-right font-medium sm:table-cell print:table-cell">
                  Budget
                </th>
                <th className="py-2 text-right font-medium">Left</th>
              </tr>
            </thead>
            <tbody>
              {top.map((e) => {
                const line = e.categoryId ? budgetOf.get(e.categoryId) : undefined;
                const share = spent > 0 ? e.amountMinor / spent : 0;
                const c = e.categoryId ? categories.get(e.categoryId) : undefined;
                return (
                  <tr
                    key={e.categoryId ?? 'none'}
                    className="break-inside-avoid border-b last:border-0"
                  >
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <CategoryIcon icon={c?.icon} color={c?.color} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate">{nameOf(e.categoryId)}</span>
                          <span className="mt-1 block h-1 rounded-full bg-muted">
                            <span
                              className="block h-1 rounded-full bg-[var(--series-1)]"
                              style={{ width: `${Math.max(2, share * 100)}%` }}
                            />
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pl-2 text-right whitespace-nowrap tabular">
                      {money(e.amountMinor)}
                    </td>
                    <td className="hidden py-2 text-right text-muted-foreground tabular sm:table-cell print:table-cell">
                      {Math.round(share * 100)}%
                    </td>
                    <td className="hidden py-2 text-right whitespace-nowrap text-muted-foreground tabular sm:table-cell print:table-cell">
                      {line && line.budgetedMinor > 0 ? money(line.budgetedMinor) : '–'}
                    </td>
                    <td
                      className={cn(
                        'py-2 pl-2 text-right whitespace-nowrap tabular',
                        line && line.remainingMinor < 0 && 'text-destructive',
                      )}
                    >
                      {line && line.budgetedMinor > 0 ? money(line.remainingMinor) : ''}
                    </td>
                  </tr>
                );
              })}
              {rest > 0 && (
                <tr className="border-b last:border-0">
                  <td className="py-2 text-muted-foreground">
                    {s.expense.length - 12} more categories
                  </td>
                  <td className="py-2 text-right tabular">{money(rest)}</td>
                  <td colSpan={3} />
                </tr>
              )}
            </tbody>
          </table>
        )}
        {budgeted.length > 0 && (
          <p className="mt-3 text-muted-foreground">
            {over.length === 0
              ? `Every budgeted category stayed within its budget (${budgeted.length}).`
              : `${budgeted.length - over.length} of ${budgeted.length} budgeted categories stayed within budget; over: ${over
                  .map((l) => `${nameOf(l.categoryId)} (${money(-l.remainingMinor)})`)
                  .join(', ')}.`}
          </p>
        )}
      </Section>

      {s.income.length > 0 && (
        <Section title="Money in">
          <table className="w-full">
            <tbody>
              {s.income.slice(0, 8).map((e) => (
                <tr key={e.categoryId ?? 'none'} className="border-b last:border-0">
                  <td className="py-2">{nameOf(e.categoryId)}</td>
                  <td className="py-2 text-right tabular">{money(e.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {largest.length > 0 && (
        <Section title="Largest expenses">
          <table className="w-full">
            <tbody>
              {largest.map((t) => (
                <LargestRow key={t.id} tx={t} category={nameOf(t.splits[0]?.categoryId ?? null)} />
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Transfers between your own accounts aren’t counted as spending or income
        {s.missingRates.length > 0
          ? `. Amounts in ${s.missingRates.join(', ')} are left out: there’s no exchange rate for them yet`
          : ''}
        .
      </footer>
    </div>
  );
}

function LargestRow({ tx, category }: { tx: Transaction; category: string }) {
  const f = useFormat();
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 whitespace-nowrap text-muted-foreground">{f.date(tx.date, 'short')}</td>
      <td className="px-3 py-2">
        <span className="block truncate">{tx.payeeName ?? (tx.rawDescription || 'No payee')}</span>
        <span className="text-xs text-muted-foreground">{category}</span>
      </td>
      <td className="py-2 text-right whitespace-nowrap tabular">
        {f.money(-tx.amountMinor, tx.currency, { trimZeroFraction: true })}
      </td>
    </tr>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string | undefined;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className="rounded-xl bg-muted/60 px-4 py-3 print:border print:bg-transparent">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-lg font-semibold tabular',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-destructive',
        )}
      >
        {value}
      </p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
