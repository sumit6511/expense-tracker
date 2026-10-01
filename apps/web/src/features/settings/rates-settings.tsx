import { FEATURED_CURRENCIES, filterDecimalInput, RateStringSchema } from '@et/shared';
import { Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { DatePicker } from '@/components/date-picker';
import { CurrencySelect } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import { Field, FilteredInput } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useDeleteManualRate, useRates, useSetManualRate } from '@/lib/queries';
import { useCanWrite } from '@/lib/session';

const SOURCE_LABELS = { nrb: 'Nepal Rastra Bank', peg: 'Fixed peg', manual: 'Your rate' } as const;

export function RatesSettings() {
  const f = useFormat();
  const canWrite = useCanWrite();
  const { data: rates, isPending } = useRates();
  const setRate = useSetManualRate();
  const deleteRate = useDeleteManualRate();
  const [base, setBase] = useState('USD');
  const [quote, setQuote] = useState('NPR');
  const [date, setDate] = useState(f.today);
  const [rate, setRateValue] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = RateStringSchema.safeParse(rate.trim());
    if (!parsed.success) {
      toast.error('Enter the rate as a positive number, e.g. 133.25');
      return;
    }
    try {
      await setRate.mutateAsync({ base, quote, date, rate: parsed.data });
      toast.success('Rate saved');
      setRateValue('');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader>
          <CardTitle>Current rates</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Foreign-currency amounts are converted to {f.base} using the rate on each transaction’s
            date. Daily rates come from Nepal Rastra Bank (the mid-point of buying and selling). INR
            is pegged at 1.60.
          </p>
          {isPending ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left font-medium">Currency</th>
                    <th className="py-2 text-right font-medium">Rate</th>
                    <th className="py-2 text-left font-medium pl-4">Source</th>
                    <th className="py-2 text-left font-medium">Date</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(rates ?? [])
                    .sort((a, b) => {
                      const rank = (c: string) => {
                        const i = (FEATURED_CURRENCIES as readonly string[]).indexOf(c);
                        return i === -1 ? 99 : i;
                      };
                      return rank(a.base) - rank(b.base) || a.base.localeCompare(b.base);
                    })
                    .map((r) => (
                      <tr key={`${r.base}-${r.quote}-${r.source}-${r.date}`}>
                        <td className="py-2">
                          1 {r.base} = <span className="text-muted-foreground">{r.quote}</span>
                        </td>
                        <td className="py-2 text-right font-medium">{r.rate}</td>
                        <td className="py-2 pl-4">
                          <Badge tone={r.source === 'manual' ? 'primary' : 'neutral'}>
                            {SOURCE_LABELS[r.source]}
                          </Badge>
                        </td>
                        <td className="py-2 text-muted-foreground">{f.date(r.date, 'short')}</td>
                        <td className="py-2 text-right">
                          {r.source === 'manual' && canWrite && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Remove rate"
                              onClick={() =>
                                deleteRate.mutate(
                                  { base: r.base, quote: r.quote, date: r.date },
                                  { onError: (e) => toast.error(errorMessage(e)) },
                                )
                              }
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {(rates ?? []).filter((r) => r.source === 'nrb').length === 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  No Nepal Rastra Bank rates yet. They’re fetched automatically a few times a day
                  when the server can reach nrb.org.np; you can add your own below meanwhile.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      {canWrite && (
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Add your own rate</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid grid-cols-1 gap-3">
              <p className="text-xs text-muted-foreground">
                Use this for the rate your bank or remittance service actually gave you. It applies
                from the chosen date until a newer rate.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="1 unit of" htmlFor="rate-base">
                  <CurrencySelect id="rate-base" value={base} onChange={setBase} />
                </Field>
                <Field label="equals, in" htmlFor="rate-quote">
                  <CurrencySelect id="rate-quote" value={quote} onChange={setQuote} />
                </Field>
              </div>
              <Field label="Rate" htmlFor="rate-value">
                <FilteredInput
                  id="rate-value"
                  inputMode="decimal"
                  autoComplete="off"
                  value={rate}
                  filter={(text) => filterDecimalInput(text, { maxDecimals: 10 })}
                  onValueChange={setRateValue}
                  placeholder="e.g. 133.25"
                />
              </Field>
              <Field label="From date" htmlFor="rate-date">
                <DatePicker id="rate-date" value={date} onChange={setDate} />
              </Field>
              <Button type="submit" disabled={setRate.isPending || base === quote}>
                Save rate
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
