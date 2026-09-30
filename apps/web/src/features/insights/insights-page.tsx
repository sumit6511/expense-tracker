import type { Forecast } from '@et/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Lightbulb, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { ChartLegend, ForecastChart, type ForecastChartPoint } from '@/components/charts';
import { Money } from '@/components/money';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { AccountSelect } from '@/components/pickers';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import { Segmented } from '@/components/ui/menu';
import { useFormat } from '@/lib/format';
import { useForecast, useInsights } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { InsightList } from './insight-list';

const HORIZONS = [30, 60, 90] as const;
type Horizon = (typeof HORIZONS)[number];

export function InsightsPage() {
  const search = useSearch({ from: '/app/insights' });
  const navigate = useNavigate({ from: '/insights' });
  const days: Horizon = search.days ?? 30;
  const insights = useInsights();

  return (
    <div className="grid grid-cols-1 gap-4 pb-10">
      <PageHeader
        title="Insights"
        description="Where your balance is heading, and what stands out in your own numbers."
      />
      <ForecastCard
        days={days}
        accountIds={search.accountIds}
        onDays={(d) => navigate({ search: (s) => ({ ...s, days: d }), replace: true })}
        onAccount={(id) =>
          navigate({ search: (s) => ({ ...s, accountIds: id || undefined }), replace: true })
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>Worth knowing</CardTitle>
          <span className="text-xs text-muted-foreground">Found in your history, no AI</span>
        </CardHeader>
        {insights.error ? (
          <ErrorState error={insights.error} retry={() => insights.refetch()} />
        ) : insights.isPending ? (
          <div className="grid grid-cols-1 gap-3 px-5 pb-5">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : insights.data.items.length === 0 ? (
          <EmptyState
            icon={Lightbulb}
            title="Nothing stands out right now"
            description="As your history grows, this is where unusual spending, price changes, subscriptions to track and good months show up."
          />
        ) : (
          <InsightList items={insights.data.items} className="border-t" />
        )}
      </Card>
    </div>
  );
}

function ForecastCard({
  days,
  accountIds,
  onDays,
  onAccount,
}: {
  days: Horizon;
  accountIds: string | undefined;
  onDays: (days: Horizon) => void;
  onAccount: (id: string) => void;
}) {
  const forecast = useForecast(days, accountIds);
  const data = forecast.data;

  return (
    <Card>
      <CardHeader className="flex-wrap gap-y-2">
        <CardTitle>Cash flow ahead</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-44">
            <AccountSelect
              value={accountIds ?? ''}
              onChange={onAccount}
              emptyLabel="Cash, bank & wallets"
              className="h-8 text-[13px]"
              aria-label="Accounts"
            />
          </div>
          <Segmented
            size="sm"
            label="How far ahead"
            value={String(days) as `${Horizon}`}
            onChange={(v) => onDays(Number(v) as Horizon)}
            options={HORIZONS.map((d) => ({ value: `${d}` as const, label: `${d} days` }))}
          />
        </div>
      </CardHeader>
      <CardContent>
        {forecast.error ? (
          <ErrorState error={forecast.error} retry={() => forecast.refetch()} />
        ) : !data ? (
          <Skeleton className="h-72" />
        ) : (
          <ForecastBody data={data} />
        )}
      </CardContent>
    </Card>
  );
}

function ForecastBody({ data: raw }: { data: Forecast }) {
  const f = useFormat();
  // Estimates: whole rupees are precise enough.
  const data = useMemo(() => {
    const unit = 10 ** f.digits();
    const whole = (minor: number) => Math.round(minor / unit) * unit;
    return {
      ...raw,
      everydayPerDayMinor: whole(raw.everydayPerDayMinor),
      points: raw.points.map((p) => ({
        ...p,
        expectedMinor: whole(p.expectedMinor),
        lowMinor: whole(p.lowMinor),
        highMinor: whole(p.highMinor),
      })),
      lowest: { ...raw.lowest, expectedMinor: whole(raw.lowest.expectedMinor) },
    };
  }, [raw, f]);
  const end = data.points.at(-1)!;
  const points = useMemo<ForecastChartPoint[]>(() => {
    const byDate = Map.groupBy(data.events, (e) => e.date);
    return data.points.map((p) => ({
      date: p.date,
      label: f.date(p.date, 'short'),
      expected: p.expectedMinor,
      low: p.lowMinor,
      high: p.highMinor,
      items: (byDate.get(p.date) ?? []).map(
        (e) =>
          `${e.name} ${f.money(e.amountMinor, undefined, { trimZeroFraction: true, sign: 'always' })}${e.variableAmount ? ' (about)' : ''}`,
      ),
    }));
  }, [data, f]);
  const dips = data.lowest.expectedMinor < 0;
  const perDay = data.everydayPerDayMinor;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Figure label="Now">
          <Money minor={data.startMinor} trimZero />
        </Figure>
        <Figure label={`Expected on ${f.date(end.date, 'short')}`}>
          <Money minor={end.expectedMinor} trimZero />
          {end.highMinor !== end.lowMinor && (
            <span className="block text-xs font-normal text-muted-foreground">
              likely {f.compact(end.lowMinor)} – {f.compact(end.highMinor)}
            </span>
          )}
        </Figure>
        <Figure label={`Lowest, around ${f.date(data.lowest.date, 'short')}`}>
          <span className={cn(dips && 'text-destructive')}>
            <Money minor={data.lowest.expectedMinor} trimZero />
          </span>
        </Figure>
      </div>
      {dips && (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          At this rate the balance drops below zero around {f.date(data.lowest.date, 'short')}.
        </p>
      )}
      <ForecastChart data={points} />
      <ChartLegend
        items={[
          { label: 'Expected balance', color: 'var(--series-1)', kind: 'line' },
          {
            label: 'Likely range (80%)',
            color: 'color-mix(in oklab, var(--series-1) 25%, transparent)',
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        From {data.events.length === 0 ? 'no' : data.events.length} scheduled{' '}
        {data.events.length === 1 ? 'item' : 'items'}
        {data.historyDays >= 7
          ? `, plus about ${f.money(Math.abs(perDay), undefined, { trimZeroFraction: true })} a day ${perDay <= 0 ? 'of everyday spending' : 'of everyday money in'} (the last ${data.historyDays} days, leaving out scheduled items).`
          : '. Everyday spending is left out until there’s a week of history.'}
        {data.missingRates.length > 0 &&
          ` Missing exchange rates for ${data.missingRates.join(', ')}: those amounts are left out.`}
      </p>
      {data.events.length > 0 && (
        <details className="group rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
            Scheduled in the next {data.points.length - 1} days ({data.events.length})
          </summary>
          <ul className="divide-y border-t text-sm">
            {data.events.map((e) => (
              <li
                key={`${e.recurringId}-${e.date}`}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span className="min-w-0 truncate">
                  {e.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {e.overdue ? 'overdue' : f.relativeDate(e.date)}
                    {e.variableAmount ? ' · amount varies' : ''}
                  </span>
                </span>
                <Money minor={e.amountMinor} trimZero className="shrink-0 font-medium" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tracking-tight tabular">{children}</p>
    </div>
  );
}
