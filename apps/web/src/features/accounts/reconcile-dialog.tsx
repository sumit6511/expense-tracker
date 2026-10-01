import {
  type Account,
  amountInputError,
  type IsoDate,
  parseAmountInput,
  type Transaction,
  toDecimalString,
} from '@et/shared';
import { CheckCheck, Loader2 } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DatePicker } from '@/components/date-picker';
import { Money } from '@/components/money';
import { AmountInput } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import {
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useConfirm,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useFinishReconcile, useReconcileState } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * Reconcile an account with a bank statement: enter the statement's closing date and balance,
 * tick the transactions that appear on it until the difference is zero, and lock them in.
 */
export function ReconcileDialog({ account, onDone }: { account: Account; onDone: () => void }) {
  const f = useFormat();
  const digits = f.digits(account.currency);
  const [step, setStep] = useState<'statement' | 'match'>('statement');
  const [statementDate, setStatementDate] = useState<IsoDate>(f.today);
  const [balance, setBalance] = useState(
    toDecimalString(account.clearedBalanceMinor, digits).replace(/\.0+$/, ''),
  );
  const statementBalance = parseAmountInput(balance, digits);

  function next(e: FormEvent) {
    e.preventDefault();
    if (statementBalance === null) return;
    setStep('match');
  }

  return (
    <DialogContent variant="sheet" onOpenAutoFocus={(e) => e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Reconcile {account.name}</DialogTitle>
        <DialogDescription>
          {step === 'statement'
            ? 'Use the closing date and balance printed on your bank or wallet statement.'
            : `Tick what appears on the statement ending ${f.date(statementDate)}.`}
        </DialogDescription>
      </DialogHeader>
      {step === 'statement' ? (
        <form onSubmit={next} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="grid grid-cols-1 content-start gap-4">
            <Field label="Statement closing date" htmlFor="rec-date">
              <DatePicker
                id="rec-date"
                value={statementDate}
                onChange={setStatementDate}
                max={f.today}
              />
            </Field>
            <Field
              label="Closing balance on the statement"
              htmlFor="rec-balance"
              error={
                balance.trim() && statementBalance === null
                  ? amountInputError(balance, digits, { allowNegative: true, allowZero: true })
                  : undefined
              }
              hint={
                account.type === 'credit_card' || account.type === 'loan'
                  ? 'Enter what you owe as a negative number, e.g. -12,500.'
                  : undefined
              }
            >
              <AmountInput
                id="rec-balance"
                currency={account.currency}
                value={balance}
                onChange={setBalance}
                negative
                large
              />
            </Field>
            {account.reconciledThrough && (
              <p className="text-xs text-muted-foreground">
                Last reconciled through {f.date(account.reconciledThrough)}.
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={statementBalance === null}>
              Next
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <MatchStep
          account={account}
          statementDate={statementDate}
          statementBalance={statementBalance ?? 0}
          onBack={() => setStep('statement')}
          onDone={onDone}
        />
      )}
    </DialogContent>
  );
}

function MatchStep({
  account,
  statementDate,
  statementBalance,
  onBack,
  onDone,
}: {
  account: Account;
  statementDate: IsoDate;
  statementBalance: number;
  onBack: () => void;
  onDone: () => void;
}) {
  const f = useFormat();
  const state = useReconcileState(account.id, statementDate);
  const finish = useFinishReconcile();
  const confirm = useConfirm();
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const candidates = state.data?.candidates ?? [];

  // Cleared transactions are usually on the statement; pending ones usually aren't.
  useEffect(() => {
    if (state.data && ticked === null)
      setTicked(
        new Set(state.data.candidates.filter((t) => t.status === 'cleared').map((t) => t.id)),
      );
  }, [state.data, ticked]);

  const selected = ticked ?? new Set<string>();
  const clearedTotal = useMemo(
    () =>
      (state.data?.reconciledBalanceMinor ?? 0) +
      candidates.filter((t) => selected.has(t.id)).reduce((s, t) => s + t.amountMinor, 0),
    [state.data, candidates, selected],
  );
  const difference = statementBalance - clearedTotal;

  const toggle = (t: Transaction, on: boolean) =>
    setTicked((cur) => {
      const nextSet = new Set(cur ?? []);
      if (on) nextSet.add(t.id);
      else nextSet.delete(t.id);
      return nextSet;
    });

  async function done(adjust: boolean) {
    if (adjust) {
      const ok = await confirm({
        title: 'Add an adjustment?',
        description: `A transaction of ${f.money(difference, account.currency)} dated ${f.date(statementDate)} will be added so your records match the statement. Check for missing or duplicate transactions first if you can.`,
        confirmLabel: 'Add adjustment',
      });
      if (!ok) return;
    }
    try {
      await finish.mutateAsync({
        accountId: account.id,
        statementDate,
        statementBalanceMinor: statementBalance,
        transactionIds: [...selected],
        adjust,
      });
      toast.success(`${account.name} reconciled through ${f.date(statementDate)}`);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2 border-y bg-muted/40 px-5 py-3 text-center">
        <Figure label="Statement" minor={statementBalance} currency={account.currency} />
        <Figure label="Cleared" minor={clearedTotal} currency={account.currency} />
        <Figure
          label="Difference"
          minor={difference}
          currency={account.currency}
          className={difference === 0 ? 'text-positive' : 'text-destructive'}
        />
      </div>
      <DialogBody className="px-0 pb-0">
        {state.isPending ? (
          <div className="grid place-items-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : candidates.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Nothing left to reconcile up to {f.date(statementDate)}.
          </p>
        ) : (
          <ul className="divide-y">
            <li className="flex items-center gap-3 px-5 py-2 text-xs text-muted-foreground">
              <Checkbox
                aria-label="Tick all"
                checked={
                  selected.size === candidates.length
                    ? true
                    : selected.size > 0
                      ? 'indeterminate'
                      : false
                }
                onCheckedChange={(v) =>
                  setTicked(v === true ? new Set(candidates.map((t) => t.id)) : new Set())
                }
              />
              {selected.size} of {candidates.length} ticked
            </li>
            {candidates.map((t) => (
              <li key={t.id}>
                <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-muted/50">
                  <Checkbox
                    checked={selected.has(t.id)}
                    onCheckedChange={(v) => toggle(t, v === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {t.payeeName || t.rawDescription || t.notes || 'Transaction'}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {f.date(t.date, 'short')}
                      {t.status === 'pending' && <Badge tone="warning">Pending</Badge>}
                    </span>
                  </span>
                  <Money
                    minor={t.amountMinor}
                    currency={t.currency}
                    signed={t.amountMinor > 0}
                    colored
                    className="text-sm"
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="ghost" className="sm:mr-auto" onClick={onBack}>
          Back
        </Button>
        {difference !== 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => done(true)}
            disabled={finish.isPending || state.isPending}
          >
            Adjust by {f.money(difference, account.currency)}
          </Button>
        )}
        <Button
          type="button"
          onClick={() => done(false)}
          disabled={difference !== 0 || finish.isPending || state.isPending}
        >
          {finish.isPending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Finish
        </Button>
      </DialogFooter>
    </>
  );
}

function Figure({
  label,
  minor,
  currency,
  className,
}: {
  label: string;
  minor: number;
  currency: string;
  className?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('truncate text-sm font-semibold tabular', className)}>
        <Money minor={minor} currency={currency} />
      </p>
    </div>
  );
}
