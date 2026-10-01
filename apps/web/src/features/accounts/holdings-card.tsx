import {
  type Account,
  amountInputError,
  filterDecimalInput,
  type Holding,
  parseAmountInput,
  parsePriceList,
  toDecimalString,
} from '@et/shared';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Money } from '@/components/money';
import { AmountInput } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useConfirm,
} from '@/components/ui/dialog';
import { Field, FilteredInput, Input, Textarea } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useCreateHolding,
  useDeleteHolding,
  useHoldings,
  useUpdateHolding,
  useUpdatePrices,
} from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { cn } from '@/lib/utils';

const DECIMAL = /^\d{1,15}(\.\d{1,8})?$/;
/** "1,234.5" → "1234.5"; null when it isn't a plain positive number. */
const decimal = (text: string) => {
  const clean = text.trim().replace(/,/g, '');
  return DECIMAL.test(clean) ? clean : null;
};

/** Investments in an account: what's held, at the latest prices, and the gain on what it cost. */
export function HoldingsCard({ account }: { account: Account }) {
  const f = useFormat();
  const canWrite = useCanWrite();
  const holdings = useHoldings(account.id);
  const [editing, setEditing] = useState<Holding | 'new' | null>(null);
  const [pricing, setPricing] = useState(false);
  const data = holdings.data;
  const gain = data ? data.valueMinor - data.costMinor : 0;

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Investments</CardTitle>
        {canWrite && !account.archived && (
          <div className="flex gap-2">
            {data && data.holdings.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setPricing(true)}>
                <RefreshCw /> Update prices
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
              <Plus /> Add
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        {!data ? (
          <Skeleton className="h-16" />
        ) : data.holdings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add the shares, fund units or gold held here, with the latest prices, and their value
            counts in this account and your net worth.
          </p>
        ) : (
          <>
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-1 py-1 font-medium">Holding</th>
                    <th className="px-1 py-1 text-right font-medium">Quantity</th>
                    <th className="px-1 py-1 text-right font-medium">Price</th>
                    <th className="px-1 py-1 text-right font-medium">Value</th>
                    <th className="px-1 py-1 text-right font-medium">Gain</th>
                    {canWrite && <th className="w-16" />}
                  </tr>
                </thead>
                <tbody className="divide-y tabular">
                  {data.holdings.map((h) => (
                    <tr key={h.id}>
                      <td className="px-1 py-2">
                        <p className="font-medium">{h.symbol}</p>
                        {h.name && <p className="text-xs text-muted-foreground">{h.name}</p>}
                      </td>
                      <td className="px-1 py-2 text-right">{h.quantity}</td>
                      <td className="px-1 py-2 text-right">
                        {h.price ?? '—'}
                        {h.priceDate && (
                          <span className="block text-xs text-muted-foreground">
                            {f.date(h.priceDate, 'short')}
                          </span>
                        )}
                      </td>
                      <td className="px-1 py-2 text-right font-medium">
                        {h.valueMinor === null ? (
                          <span className="text-muted-foreground">No price</span>
                        ) : (
                          <Money minor={h.valueMinor} currency={data.currency} trimZero />
                        )}
                      </td>
                      <td className="px-1 py-2 text-right">
                        <Gain gain={h.gainMinor} cost={h.costMinor} currency={data.currency} />
                      </td>
                      {canWrite && (
                        <td className="px-1 py-2 text-right">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Change ${h.symbol}`}
                            onClick={() => setEditing(h)}
                          >
                            <Pencil />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t font-medium tabular">
                  <tr>
                    <td className="px-1 py-2">Total</td>
                    <td />
                    <td />
                    <td className="px-1 py-2 text-right">
                      <Money minor={data.valueMinor} currency={data.currency} trimZero />
                    </td>
                    <td className="px-1 py-2 text-right">
                      <Gain gain={gain} cost={data.costMinor} currency={data.currency} />
                    </td>
                    {canWrite && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Gains compare today’s value with what you entered as the cost.
            </p>
          </>
        )}
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing !== null && (
          <HoldingDialog
            account={account}
            holding={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Dialog>
      <Dialog open={pricing} onOpenChange={setPricing}>
        {pricing && data && (
          <PricesDialog
            account={account}
            holdings={data.holdings}
            onDone={() => setPricing(false)}
          />
        )}
      </Dialog>
    </Card>
  );
}

function Gain({ gain, cost, currency }: { gain: number | null; cost: number; currency: string }) {
  const f = useFormat();
  if (gain === null) return <span className="text-muted-foreground">—</span>;
  const pct = cost > 0 ? (gain / cost) * 100 : null;
  return (
    <span className={cn(gain > 0 && 'text-positive', gain < 0 && 'text-destructive')}>
      {f.money(gain, currency, { sign: 'always', trimZeroFraction: true })}
      {pct !== null && (
        <span className="block text-xs">
          {pct > 0 ? '+' : ''}
          {pct.toFixed(1)}%
        </span>
      )}
    </span>
  );
}

function HoldingDialog({
  account,
  holding,
  onDone,
}: {
  account: Account;
  holding: Holding | null;
  onDone: () => void;
}) {
  const f = useFormat();
  const digits = f.digits(account.currency);
  const create = useCreateHolding();
  const update = useUpdateHolding();
  const remove = useDeleteHolding();
  const confirm = useConfirm();
  const [symbol, setSymbol] = useState(holding?.symbol ?? '');
  const [name, setName] = useState(holding?.name ?? '');
  const [quantity, setQuantity] = useState(holding?.quantity ?? '');
  const [cost, setCost] = useState(holding ? toDecimalString(holding.costMinor, digits) : '');
  const [price, setPrice] = useState(holding?.price ?? '');
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    const qty = decimal(quantity);
    const unitPrice = price.trim() ? decimal(price) : null;
    const costMinor = cost.trim() ? parseAmountInput(cost, digits) : 0;
    if (!qty) return setError('Enter the quantity as a number, like 10 or 2.5');
    if (price.trim() && !unitPrice) return setError('Enter the price as a number, like 512.30');
    if (costMinor === null || costMinor < 0) {
      return setError(
        `Total cost: ${amountInputError(cost, digits, { allowZero: true }) ?? 'Enter what it cost in total'}`,
      );
    }
    const body = { symbol, name, quantity: qty, costMinor, price: unitPrice };
    const done = {
      onSuccess: () => {
        toast.success(holding ? 'Holding updated' : 'Holding added');
        onDone();
      },
      onError: (err: unknown) => setError(errorMessage(err)),
    };
    if (holding) update.mutate({ id: holding.id, ...body }, done);
    else create.mutate({ accountId: account.id, ...body }, done);
  }

  return (
    <DialogContent className="sm:max-w-md">
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>{holding ? `Change ${holding.symbol}` : 'Add a holding'}</DialogTitle>
          <DialogDescription>
            Bought or sold some? Change the quantity and the total cost.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-2 gap-3">
          <Field label="Symbol" htmlFor="h-symbol">
            <Input
              id="h-symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="NABIL"
              maxLength={20}
              required
              autoFocus
            />
          </Field>
          <Field label="Quantity" htmlFor="h-quantity">
            <FilteredInput
              id="h-quantity"
              inputMode="decimal"
              autoComplete="off"
              value={quantity}
              filter={(text) => filterDecimalInput(text)}
              onValueChange={setQuantity}
              placeholder="10"
              required
            />
          </Field>
          <Field label="Name" htmlFor="h-name" className="col-span-2">
            <Input
              id="h-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nabil Bank"
              maxLength={120}
            />
          </Field>
          <Field label="Total cost" htmlFor="h-cost" hint="What you paid, fees included.">
            <AmountInput id="h-cost" value={cost} onChange={setCost} currency={account.currency} />
          </Field>
          <Field label="Price now" htmlFor="h-price" hint="Per share or unit.">
            <FilteredInput
              id="h-price"
              inputMode="decimal"
              autoComplete="off"
              value={price}
              filter={(text) => filterDecimalInput(text)}
              onValueChange={setPrice}
              placeholder="512.30"
            />
          </Field>
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          {holding && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={async () => {
                const ok = await confirm({
                  title: `Remove ${holding.symbol}?`,
                  description: 'Sold everything? Its value leaves this account from today.',
                  confirmLabel: 'Remove',
                  destructive: true,
                });
                if (ok)
                  remove.mutate(holding.id, {
                    onSuccess: onDone,
                    onError: (e) => setError(errorMessage(e)),
                  });
              }}
            >
              <Trash2 /> Remove
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {holding ? 'Save' : 'Add'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/** Today's prices, typed or pasted from a market website ("NABIL 512.30" per line). */
function PricesDialog({
  account,
  holdings,
  onDone,
}: {
  account: Account;
  holdings: Holding[];
  onDone: () => void;
}) {
  const save = useUpdatePrices();
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(holdings.map((h) => [h.id, h.price ?? ''])),
  );
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(null);

  function applyPaste(text: string) {
    setPasted(text);
    const found = parsePriceList(text);
    setPrices((current) => {
      const next = { ...current };
      for (const h of holdings) if (found[h.symbol]) next[h.id] = found[h.symbol]!;
      return next;
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const changed = holdings.flatMap((h) => {
      const value = decimal(prices[h.id] ?? '');
      return value && value !== h.price ? [{ holdingId: h.id, price: value }] : [];
    });
    if (changed.length === 0) return onDone();
    save.mutate(
      { accountId: account.id, prices: changed },
      {
        onSuccess: () => {
          toast.success(
            changed.length === 1 ? 'Price updated' : `${changed.length} prices updated`,
          );
          onDone();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  }

  return (
    <DialogContent className="sm:max-w-md">
      <form onSubmit={submit}>
        <DialogHeader>
          <DialogTitle>Update prices</DialogTitle>
          <DialogDescription>
            Type today’s prices, or paste them from a market website (one “SYMBOL price” per line).
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-3">
          <Textarea
            aria-label="Paste prices"
            value={pasted}
            onChange={(e) => applyPaste(e.target.value)}
            rows={3}
            placeholder={'NABIL 512.30\nNICA 845'}
            className="font-mono text-xs"
          />
          <div className="grid grid-cols-[1fr_8rem] items-center gap-2">
            {holdings.map((h) => (
              <div key={h.id} className="contents text-sm">
                <span className="font-medium">{h.symbol}</span>
                <FilteredInput
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`Price of ${h.symbol}`}
                  value={prices[h.id] ?? ''}
                  filter={(text) => filterDecimalInput(text)}
                  onValueChange={(value) => setPrices((p) => ({ ...p, [h.id]: value }))}
                  className="h-9 text-right"
                />
              </div>
            ))}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Save prices
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
