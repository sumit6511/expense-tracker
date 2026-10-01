import {
  AD_MONTH_NAMES,
  adToBs,
  BS_MONTH_NAMES,
  diffDays,
  type Frequency,
  type IsoDate,
  isBsSupported,
  occurrenceAt,
  parseAmountInput,
  parseIsoDate,
  type Recurring,
  RecurringBodySchema,
  type RecurringInput,
  type RecurringKind,
  type Transaction,
  toDecimalString,
  toDevanagariDigits,
  WEEKDAY_NAMES,
} from '@et/shared';
import { Loader2, Trash2 } from 'lucide-react';
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { toast } from 'sonner';
import { DatePicker } from '@/components/date-picker';
import {
  AccountSelect,
  AmountInput,
  CategoryPicker,
  PayeeInput,
  TagPicker,
} from '@/components/pickers';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useConfirm,
} from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Checkbox, Segmented } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { type Formatters, useFormat } from '@/lib/format';
import {
  useAccountMap,
  useCreateRecurring,
  useDeleteRecurring,
  useRecordRecurring,
  useUpdateRecurring,
} from '@/lib/queries';
import { useWorkspace } from '@/lib/session';

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

function ordinal(n: number) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

const UNIT: Record<Frequency, [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};

/** "Monthly on the 1st (BS)", "Every 2 weeks on Friday", "Yearly on 20 Asoj". */
export function describeSchedule(
  r: Pick<Recurring, 'frequency' | 'interval' | 'calendar' | 'lastDayOfMonth'> & {
    anchor: IsoDate;
  },
) {
  const every =
    r.interval === 1
      ? { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[r.frequency]
      : `Every ${r.interval} ${UNIT[r.frequency][1]}`;
  if (r.frequency === 'daily') return every;
  if (r.frequency === 'weekly')
    return `${every} on ${WEEKDAY_NAMES[new Date(`${r.anchor}T00:00:00Z`).getUTCDay()]}`;
  const bs = r.calendar === 'bs' && isBsSupported(r.anchor);
  const parts = bs ? adToBs(r.anchor) : parseIsoDate(r.anchor);
  const suffix = bs ? ' (BS)' : '';
  if (r.frequency === 'monthly')
    return `${every} on the ${r.lastDayOfMonth ? 'last day' : ordinal(parts.day)}${suffix}`;
  const month = (bs ? BS_MONTH_NAMES : AD_MONTH_NAMES)[parts.month - 1];
  return `${every} on ${r.lastDayOfMonth ? 'the last day of' : parts.day} ${month}`;
}

/** "Today", "Tomorrow", "In 5 days", "3 days overdue", or the date ("today" mid-sentence). */
export function dueLabel(date: IsoDate, f: Formatters, midSentence = false) {
  const days = diffDays(f.today, date);
  if (f.locale === 'ne') {
    const n = toDevanagariDigits(Math.abs(days));
    if (days === 0) return 'आज';
    if (days === 1) return 'भोलि';
    if (days < 0) return `${n} दिन ढिला`;
    if (days <= 7) return `${n} दिनमा`;
    return f.date(date, 'short');
  }
  const word = (w: string) => (midSentence ? w.toLowerCase() : w);
  if (days === 0) return word('Today');
  if (days === 1) return word('Tomorrow');
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days <= 7) return word(`In ${days} days`);
  return f.date(date, 'short');
}

// ---------------------------------------------------------------------------------------------
// Opening the editor from anywhere
// ---------------------------------------------------------------------------------------------

export type RecurringStart = Partial<RecurringInput> & { id?: string };

const RecurringDialogContext = createContext<{
  openRecurring: (start?: RecurringStart) => void;
  openRecord: (recurring: Recurring) => void;
} | null>(null);

export function useRecurringDialog() {
  const ctx = useContext(RecurringDialogContext);
  if (!ctx) throw new Error('useRecurringDialog must be used inside RecurringDialogProvider');
  return ctx;
}

/** Turns a saved series back into editor input. */
export function recurringStart(r: Recurring): RecurringStart {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    accountId: r.accountId,
    toAccountId: r.toAccountId,
    amountMinor: r.amountMinor,
    toAmountMinor: r.toAmountMinor,
    variableAmount: r.variableAmount,
    payee: r.payeeName,
    categoryId: r.categoryId,
    notes: r.notes,
    tagIds: r.tagIds,
    frequency: r.frequency,
    interval: r.interval,
    calendar: r.calendar,
    nextDate: r.nextDate ?? undefined,
    lastDayOfMonth: r.lastDayOfMonth,
    endDate: r.endDate,
    remaining: r.remaining,
    mode: r.mode,
    remindDaysBefore: r.remindDaysBefore,
    active: r.active,
  };
}

/** A monthly series that continues from an existing transaction. */
export function recurringFromTransaction(
  tx: Transaction,
  calendar: 'bs' | 'ad',
  names: { category?: string },
): RecurringStart {
  const next =
    occurrenceAt(
      { frequency: 'monthly', interval: 1, calendar, startDate: tx.date, lastDayOfMonth: false },
      1,
    ) ?? tx.date;
  if (tx.transfer) {
    const out = tx.amountMinor < 0;
    return {
      name: 'Transfer',
      kind: 'transfer',
      accountId: out ? tx.accountId : tx.transfer.peerAccountId,
      toAccountId: out ? tx.transfer.peerAccountId : tx.accountId,
      amountMinor: Math.abs(out ? tx.amountMinor : tx.transfer.peerAmountMinor),
      frequency: 'monthly',
      calendar,
      nextDate: next,
    };
  }
  return {
    name: tx.payeeName ?? names.category ?? '',
    kind: tx.amountMinor < 0 ? 'expense' : 'income',
    accountId: tx.accountId,
    amountMinor: Math.abs(tx.amountMinor),
    payee: tx.payeeName,
    categoryId: tx.splits.length === 1 ? (tx.splits[0]!.categoryId ?? null) : null,
    notes: tx.notes,
    tagIds: tx.tagIds,
    frequency: 'monthly',
    calendar,
    nextDate: next,
  };
}

export function RecurringDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    open: boolean;
    start?: RecurringStart;
    record?: Recurring;
    key: number;
  }>({ open: false, key: 0 });
  const openRecurring = useCallback(
    (start?: RecurringStart) => setState((s) => ({ open: true, start, key: s.key + 1 })),
    [],
  );
  const openRecord = useCallback(
    (record: Recurring) => setState((s) => ({ open: true, record, key: s.key + 1 })),
    [],
  );
  const value = useMemo(() => ({ openRecurring, openRecord }), [openRecurring, openRecord]);
  const close = () => setState((s) => ({ ...s, open: false }));
  return (
    <RecurringDialogContext.Provider value={value}>
      {children}
      <Dialog open={state.open} onOpenChange={(open) => setState((s) => ({ ...s, open }))}>
        {state.open &&
          (state.record ? (
            <RecordDialog key={state.key} recurring={state.record} onDone={close} />
          ) : (
            <RecurringEditor key={state.key} start={state.start} onDone={close} />
          ))}
      </Dialog>
    </RecurringDialogContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------------------------

type Ends = 'never' | 'date' | 'count';

function RecurringEditor({ start, onDone }: { start?: RecurringStart; onDone: () => void }) {
  const f = useFormat();
  const ws = useWorkspace();
  const accounts = useAccountMap();
  const create = useCreateRecurring();
  const update = useUpdateRecurring();
  const remove = useDeleteRecurring();
  const confirm = useConfirm();
  const editingId = start?.id;

  const firstAccount = [...accounts.values()].find((a) => !a.archived)?.id ?? '';
  const [kind, setKind] = useState<RecurringKind>(start?.kind ?? 'expense');
  const [name, setName] = useState(start?.name ?? '');
  const [accountId, setAccountId] = useState(start?.accountId ?? firstAccount);
  const [toAccountId, setToAccountId] = useState(start?.toAccountId ?? '');
  const account = accounts.get(accountId);
  const toAccount = accounts.get(toAccountId);
  const currency = account?.currency ?? f.base;
  const amountText = (minor: number | null | undefined, cur: string) =>
    minor ? toDecimalString(minor, f.digits(cur)) : '';
  const [amount, setAmount] = useState(amountText(start?.amountMinor, currency));
  const [toAmount, setToAmount] = useState(
    amountText(start?.toAmountMinor, toAccount?.currency ?? f.base),
  );
  const [variableAmount, setVariableAmount] = useState(start?.variableAmount ?? false);
  const [payee, setPayee] = useState(start?.payee ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(start?.categoryId ?? null);
  const [notes, setNotes] = useState(start?.notes ?? '');
  const [tagIds, setTagIds] = useState<string[]>(start?.tagIds ?? []);
  const [frequency, setFrequency] = useState<Frequency>(start?.frequency ?? 'monthly');
  const [interval, setInterval] = useState(String(start?.interval ?? 1));
  const [calendar, setCalendar] = useState<'bs' | 'ad'>(start?.calendar ?? ws.calendar);
  const [nextDate, setNextDate] = useState<IsoDate>(start?.nextDate ?? f.today);
  const [lastDay, setLastDay] = useState(start?.lastDayOfMonth ?? false);
  const [ends, setEnds] = useState<Ends>(
    start?.endDate ? 'date' : start?.remaining ? 'count' : 'never',
  );
  const [endDate, setEndDate] = useState<IsoDate>(start?.endDate ?? nextDate);
  const [remaining, setRemaining] = useState(String(start?.remaining ?? 12));
  const [mode, setMode] = useState<'auto' | 'remind'>(start?.mode ?? 'remind');
  const [remindDays, setRemindDays] = useState(String(start?.remindDaysBefore ?? 3));
  const [error, setError] = useState<string | null>(null);

  const crossCurrency = kind === 'transfer' && toAccount && toAccount.currency !== currency;
  const monthlyish = frequency === 'monthly' || frequency === 'yearly';
  const saving = create.isPending || update.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseAmountInput(amount, f.digits(currency));
    if (!parsed) {
      setError(variableAmount ? 'Enter a usual (estimated) amount' : 'Enter the amount');
      return;
    }
    const parsedTo = crossCurrency
      ? parseAmountInput(toAmount, f.digits(toAccount!.currency))
      : null;
    const body: RecurringInput = {
      name: name.trim() || payee.trim() || (kind === 'transfer' ? 'Transfer' : ''),
      kind,
      accountId,
      toAccountId: kind === 'transfer' ? toAccountId || null : null,
      amountMinor: Math.abs(parsed),
      toAmountMinor: parsedTo ? Math.abs(parsedTo) : null,
      variableAmount,
      payee: kind === 'transfer' ? null : payee.trim() || null,
      categoryId: kind === 'transfer' ? null : categoryId,
      notes: notes.trim(),
      tagIds: kind === 'transfer' ? [] : tagIds,
      frequency,
      interval: Math.max(1, Number.parseInt(interval, 10) || 1),
      calendar,
      nextDate,
      lastDayOfMonth: monthlyish && lastDay,
      endDate: ends === 'date' ? endDate : null,
      remaining: ends === 'count' ? Math.max(1, Number.parseInt(remaining, 10) || 1) : null,
      mode: variableAmount ? 'remind' : mode,
      remindDaysBefore: Number(remindDays),
    };
    const check = RecurringBodySchema.safeParse(body);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    setError(null);
    try {
      if (editingId) await update.mutateAsync({ id: editingId, ...body });
      else await create.mutateAsync(body);
      toast.success(editingId ? 'Saved' : `“${body.name}” set up`, {
        description: `Next: ${f.date(nextDate)}`,
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function doDelete() {
    if (!editingId) return;
    const ok = await confirm({
      title: `Delete “${name}”?`,
      description: 'Transactions already recorded from it are kept.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(editingId, {
      onSuccess: () => {
        toast('Deleted');
        onDone();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  return (
    <DialogContent className="sm:max-w-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{editingId ? 'Edit recurring' : 'New recurring'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-4">
          <Segmented
            label="Type"
            className="w-full"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense', label: 'Bill / expense' },
              { value: 'income', label: 'Income' },
              { value: 'transfer', label: 'Transfer' },
            ]}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Amount" htmlFor="rec-amount">
              <AmountInput
                id="rec-amount"
                currency={currency}
                value={amount}
                onChange={setAmount}
                placeholder={variableAmount ? 'Usual amount' : '0'}
              />
            </Field>
            {kind === 'transfer' ? (
              <Field label="From" htmlFor="rec-account">
                <AccountSelect id="rec-account" value={accountId} onChange={setAccountId} />
              </Field>
            ) : (
              <Field label="Account" htmlFor="rec-account">
                <AccountSelect id="rec-account" value={accountId} onChange={setAccountId} />
              </Field>
            )}
          </div>
          <label className="-mt-1 flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={variableAmount}
              onCheckedChange={(v) => setVariableAmount(v === true)}
            />
            The amount changes each time (ask me when it’s due)
          </label>
          {kind === 'transfer' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="To" htmlFor="rec-to">
                <AccountSelect
                  id="rec-to"
                  value={toAccountId}
                  onChange={setToAccountId}
                  exclude={accountId}
                />
              </Field>
              {crossCurrency && (
                <Field label={`Amount received (${toAccount!.currency})`} htmlFor="rec-to-amount">
                  <AmountInput
                    id="rec-to-amount"
                    currency={toAccount!.currency}
                    value={toAmount}
                    onChange={setToAmount}
                  />
                </Field>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Payee" htmlFor="rec-payee">
                <PayeeInput
                  id="rec-payee"
                  value={payee}
                  onChange={setPayee}
                  placeholder={kind === 'income' ? 'Who pays you?' : 'e.g. WorldLink'}
                  onMatch={(p) => {
                    if (!categoryId && p.suggestedCategoryId) setCategoryId(p.suggestedCategoryId);
                  }}
                />
              </Field>
              <Field label="Category">
                <CategoryPicker
                  value={categoryId}
                  onChange={setCategoryId}
                  kind={kind === 'income' ? 'income' : 'expense'}
                />
              </Field>
            </div>
          )}
          <Field label="Name" htmlFor="rec-name" hint="Shown in reminders and the upcoming list.">
            <Input
              id="rec-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={payee.trim() || 'e.g. Internet, Rent, Salary'}
              maxLength={80}
            />
          </Field>

          <fieldset className="grid grid-cols-1 gap-3 rounded-xl border p-3.5">
            <legend className="px-1 text-sm font-semibold">Schedule</legend>
            <div className="grid grid-cols-[auto_5rem_1fr] items-center gap-2 text-sm">
              <span>Every</span>
              <Input
                aria-label="Interval"
                inputMode="numeric"
                value={interval}
                onChange={(e) => setInterval(e.target.value.replace(/\D/g, '').slice(0, 3))}
                className="text-center tabular"
              />
              <NativeSelect
                aria-label="Repeats"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
              >
                {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((fr) => (
                  <option key={fr} value={fr}>
                    {UNIT[fr][interval === '1' ? 0 : 1]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Next date" htmlFor="rec-next">
                <DatePicker id="rec-next" value={nextDate} onChange={setNextDate} />
              </Field>
              {monthlyish && (
                <Field label="Months">
                  <Segmented
                    label="Calendar"
                    className="w-full"
                    value={calendar}
                    onChange={setCalendar}
                    options={[
                      { value: 'bs', label: 'Bikram Sambat' },
                      { value: 'ad', label: 'Gregorian' },
                    ]}
                  />
                </Field>
              )}
            </div>
            {monthlyish && (
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={lastDay} onCheckedChange={(v) => setLastDay(v === true)} />
                Always on the last day of the month
              </label>
            )}
            <p className="text-xs text-muted-foreground">
              {describeSchedule({
                frequency,
                interval: Math.max(1, Number.parseInt(interval, 10) || 1),
                calendar,
                lastDayOfMonth: monthlyish && lastDay,
                anchor: nextDate,
              })}
              , starting {f.date(nextDate)}.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Ends" htmlFor="rec-ends">
                <NativeSelect
                  id="rec-ends"
                  value={ends}
                  onChange={(e) => setEnds(e.target.value as Ends)}
                >
                  <option value="never">Never</option>
                  <option value="date">On a date</option>
                  <option value="count">After a number of times</option>
                </NativeSelect>
              </Field>
              {ends === 'date' && (
                <Field label="Last date" htmlFor="rec-end">
                  <DatePicker id="rec-end" value={endDate} onChange={setEndDate} />
                </Field>
              )}
              {ends === 'count' && (
                <Field label="Times left" htmlFor="rec-count" hint="e.g. EMIs remaining">
                  <Input
                    id="rec-count"
                    inputMode="numeric"
                    value={remaining}
                    onChange={(e) => setRemaining(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                </Field>
              )}
            </div>
          </fieldset>

          <fieldset className="grid grid-cols-1 gap-3">
            <legend className="mb-2 text-sm font-semibold">When it’s due</legend>
            <Segmented
              label="When it’s due"
              className="w-full"
              value={variableAmount ? 'remind' : mode}
              onChange={setMode}
              options={[
                { value: 'remind', label: 'Remind me to record it' },
                { value: 'auto', label: 'Add it automatically' },
              ]}
            />
            {variableAmount && (
              <p className="text-xs text-muted-foreground">
                Amounts that change are always confirmed by you.
              </p>
            )}
            {(variableAmount || mode === 'remind') && (
              <Field label="Remind me" htmlFor="rec-remind">
                <NativeSelect
                  id="rec-remind"
                  value={remindDays}
                  onChange={(e) => setRemindDays(e.target.value)}
                >
                  <option value="0">On the day</option>
                  <option value="1">1 day before</option>
                  <option value="3">3 days before</option>
                  <option value="7">A week before</option>
                </NativeSelect>
              </Field>
            )}
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Notes" htmlFor="rec-notes">
              <Input
                id="rec-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
              />
            </Field>
            {kind !== 'transfer' && (
              <Field label="Tags">
                <TagPicker value={tagIds} onChange={setTagIds} />
              </Field>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          {editingId && (
            <Button type="button" variant="ghost" className="sm:mr-auto" onClick={doDelete}>
              <Trash2 /> Delete
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {editingId ? 'Save' : 'Set up'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

// ---------------------------------------------------------------------------------------------
// Recording one occurrence (amount that changes, or a different date/account)
// ---------------------------------------------------------------------------------------------

function RecordDialog({ recurring: r, onDone }: { recurring: Recurring; onDone: () => void }) {
  const f = useFormat();
  const accounts = useAccountMap();
  const record = useRecordRecurring();
  const [accountId, setAccountId] = useState(r.accountId);
  const currency = accounts.get(accountId)?.currency ?? r.currency;
  const [amount, setAmount] = useState(
    r.variableAmount ? '' : toDecimalString(r.amountMinor, f.digits(r.currency)),
  );
  const [date, setDate] = useState<IsoDate>(
    r.nextDate && r.nextDate <= f.today ? r.nextDate : f.today,
  );
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseAmountInput(amount, f.digits(currency));
    if (!parsed) {
      setError('Enter the amount');
      return;
    }
    try {
      await record.mutateAsync({
        id: r.id,
        amountMinor: Math.abs(parsed),
        date,
        ...(accountId !== r.accountId && { accountId }),
      });
      toast.success(`${r.name} recorded`, {
        description: f.money(r.kind === 'income' ? Math.abs(parsed) : -Math.abs(parsed), currency),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <DialogContent>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>Record {r.name}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Due {r.nextDate ? f.date(r.nextDate) : '—'}
            {r.variableAmount && ` · usually ${f.money(r.amountMinor, r.currency)}`}
          </p>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-4">
          <Field label="Amount" htmlFor="record-amount">
            <AmountInput
              id="record-amount"
              currency={currency}
              value={amount}
              onChange={setAmount}
              large
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="record-date">
              <DatePicker id="record-date" value={date} onChange={setDate} />
            </Field>
            <Field label={r.kind === 'transfer' ? 'From' : 'Account'} htmlFor="record-account">
              <AccountSelect id="record-account" value={accountId} onChange={setAccountId} />
            </Field>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={record.isPending}>
            {record.isPending && <Loader2 className="animate-spin" />} Record
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
