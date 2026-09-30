import {
  type CategoryKind,
  type IsoDate,
  parseAmountInput,
  type Transaction,
  toDecimalString,
  uuidv7,
} from '@et/shared';
import { Loader2, Plus, Split, Trash2, X } from 'lucide-react';
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { DatePicker } from '@/components/date-picker';
import { CategoryIcon } from '@/components/icons';
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useConfirm,
} from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/menu';
import { ApiError, errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useAccountMap,
  useAccounts,
  useCategories,
  useCategoryMap,
  useCreateTransaction,
  useCreateTransfer,
  useDeleteTransaction,
  useRestoreTransaction,
  useTransaction,
  useUpdateTransaction,
  useUpdateTransfer,
} from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { cn, storage } from '@/lib/utils';

type Mode = 'expense' | 'income' | 'transfer';

export interface NewTransactionDefaults {
  mode?: Mode;
  accountId?: string;
  date?: IsoDate;
  categoryId?: string | null;
}

interface DialogState {
  open: boolean;
  transactionId: string | null;
  defaults: NewTransactionDefaults;
  key: number;
}

const TransactionDialogContext = createContext<{
  openNew: (defaults?: NewTransactionDefaults) => void;
  openEdit: (id: string) => void;
} | null>(null);

export function useTransactionDialog() {
  const ctx = useContext(TransactionDialogContext);
  if (!ctx) throw new Error('useTransactionDialog must be used inside TransactionDialogProvider');
  return ctx;
}

/** One transaction dialog for the whole app, opened from buttons, shortcuts and lists. */
export function TransactionDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>({
    open: false,
    transactionId: null,
    defaults: {},
    key: 0,
  });
  const openNew = useCallback(
    (defaults: NewTransactionDefaults = {}) =>
      setState((s) => ({ open: true, transactionId: null, defaults, key: s.key + 1 })),
    [],
  );
  const openEdit = useCallback(
    (id: string) =>
      setState((s) => ({ open: true, transactionId: id, defaults: {}, key: s.key + 1 })),
    [],
  );
  const value = useMemo(() => ({ openNew, openEdit }), [openNew, openEdit]);
  return (
    <TransactionDialogContext.Provider value={value}>
      {children}
      <Dialog open={state.open} onOpenChange={(open) => setState((s) => ({ ...s, open }))}>
        {state.open && (
          <TransactionEditor
            key={state.key}
            transactionId={state.transactionId}
            defaults={state.defaults}
            onDone={() => setState((s) => ({ ...s, open: false }))}
            onAnother={(defaults) => openNew(defaults)}
          />
        )}
      </Dialog>
    </TransactionDialogContext.Provider>
  );
}

const LAST_ACCOUNT_KEY = 'et.lastAccount';

interface SplitLine {
  key: string;
  categoryId: string | null;
  amount: string;
  memo: string;
}

function TransactionEditor({
  transactionId,
  defaults,
  onDone,
  onAnother,
}: {
  transactionId: string | null;
  defaults: NewTransactionDefaults;
  onDone: () => void;
  onAnother: (defaults: NewTransactionDefaults) => void;
}) {
  const existing = useTransaction(transactionId);
  if (transactionId && !existing.data) {
    return (
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>Transaction</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 place-items-center">
          {existing.error ? (
            <p className="text-sm text-destructive">{errorMessage(existing.error)}</p>
          ) : (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          )}
        </DialogBody>
      </DialogContent>
    );
  }
  return (
    <EditorForm
      existing={existing.data ?? null}
      defaults={defaults}
      onDone={onDone}
      onAnother={onAnother}
    />
  );
}

function EditorForm({
  existing,
  defaults,
  onDone,
  onAnother,
}: {
  existing: Transaction | null;
  defaults: NewTransactionDefaults;
  onDone: () => void;
  onAnother: (defaults: NewTransactionDefaults) => void;
}) {
  const f = useFormat();
  const canWrite = useCanWrite();
  const confirm = useConfirm();
  const { data: accounts = [] } = useAccounts();
  const accountMap = useAccountMap();
  const categoryMap = useCategoryMap();
  const { data: groups = [] } = useCategories();

  const isEdit = existing !== null;
  const isTransfer = existing?.transfer != null;
  const initialMode: Mode = existing
    ? isTransfer
      ? 'transfer'
      : existing.amountMinor < 0
        ? 'expense'
        : 'income'
    : (defaults.mode ?? 'expense');

  const defaultAccount =
    defaults.accountId ??
    [storage.get(LAST_ACCOUNT_KEY), accounts.find((a) => !a.archived)?.id].find(
      (id) => id && accounts.some((a) => a.id === id && !a.archived),
    ) ??
    '';

  // For transfers, `accountId` is the source and `toAccountId` the destination.
  const [mode, setMode] = useState<Mode>(initialMode);
  const [accountId, setAccountId] = useState(
    existing
      ? isTransfer && existing.amountMinor > 0
        ? existing.transfer!.peerAccountId
        : existing.accountId
      : defaultAccount,
  );
  const [toAccountId, setToAccountId] = useState(
    existing && isTransfer
      ? existing.amountMinor > 0
        ? existing.accountId
        : existing.transfer!.peerAccountId
      : '',
  );
  const account = accountMap.get(accountId);
  const toAccount = accountMap.get(toAccountId);
  const currency = account?.currency ?? f.base;

  const amountText = (minor: number, cur: string) =>
    toDecimalString(Math.abs(minor), f.digits(cur));
  const [amount, setAmount] = useState(() => {
    if (!existing) return '';
    if (isTransfer) {
      const out =
        existing.amountMinor < 0 ? existing.amountMinor : existing.transfer!.peerAmountMinor;
      return amountText(out, currency);
    }
    return amountText(existing.amountMinor, existing.currency);
  });
  const [toAmount, setToAmount] = useState(() => {
    if (!existing || !isTransfer) return '';
    const incoming =
      existing.amountMinor > 0 ? existing.amountMinor : existing.transfer!.peerAmountMinor;
    return amountText(incoming, toAccount?.currency ?? f.base);
  });
  const [date, setDate] = useState<IsoDate>(existing?.date ?? defaults.date ?? f.today);
  const [payee, setPayee] = useState(existing?.payeeName ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(
    existing
      ? existing.splits.length === 1
        ? existing.splits[0]!.categoryId
        : null
      : (defaults.categoryId ?? null),
  );
  const categoryTouched = useRef(existing !== null || defaults.categoryId !== undefined);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [tagIds, setTagIds] = useState<string[]>(existing?.tagIds ?? []);
  const [splitMode, setSplitMode] = useState(existing ? existing.splits.length > 1 : false);
  const [lines, setLines] = useState<SplitLine[]>(() =>
    existing && existing.splits.length > 1
      ? existing.splits.map((s) => ({
          key: s.id,
          categoryId: s.categoryId,
          amount: amountText(s.amountMinor, existing.currency),
          memo: s.memo,
        }))
      : [],
  );
  const [error, setError] = useState<string | null>(null);

  const createTx = useCreateTransaction();
  const updateTx = useUpdateTransaction();
  const createTransfer = useCreateTransfer();
  const updateTransfer = useUpdateTransfer();
  const deleteTx = useDeleteTransaction();
  const restoreTx = useRestoreTransaction();
  const saving =
    createTx.isPending ||
    updateTx.isPending ||
    createTransfer.isPending ||
    updateTransfer.isPending;

  const digits = f.digits(currency);
  const parsed = amount.trim() ? parseAmountInput(amount, digits) : null;
  const kind: CategoryKind = mode === 'income' ? 'income' : 'expense';
  const sign = mode === 'expense' ? -1 : 1;

  // Most-used categories of this kind, for one-tap picking.
  const frequent = useMemo(
    () =>
      groups
        .filter((g) => g.kind === kind && !g.archived)
        .flatMap((g) => g.categories.filter((c) => !c.archived))
        .sort((a, b) => b.transactionCount - a.transactionCount)
        .slice(0, 8),
    [groups, kind],
  );

  const lineTotal = lines.reduce((s, l) => s + (parseAmountInput(l.amount, digits) ?? 0), 0);
  const remaining = (parsed ?? 0) - lineTotal;

  useEffect(() => {
    if (splitMode && lines.length === 0) {
      setLines([
        { key: uuidv7(), categoryId, amount: amount, memo: '' },
        { key: uuidv7(), categoryId: null, amount: '', memo: '' },
      ]);
    }
  }, [splitMode, lines.length, categoryId, amount]);

  async function submit(event: FormEvent, another = false) {
    event.preventDefault();
    setError(null);
    if (!canWrite) return;
    if (parsed === null || parsed <= 0) {
      setError('Enter an amount greater than zero');
      return;
    }
    if (!accountId) {
      setError('Choose an account');
      return;
    }
    try {
      if (mode === 'transfer') {
        if (!toAccountId || toAccountId === accountId) {
          setError('Choose two different accounts');
          return;
        }
        const crossCurrency = toAccount && account && toAccount.currency !== account.currency;
        const toParsed = crossCurrency
          ? parseAmountInput(toAmount, f.digits(toAccount.currency))
          : null;
        if (crossCurrency && (toParsed === null || toParsed <= 0)) {
          setError(`Enter the amount received in ${toAccount.currency}`);
          return;
        }
        const body = {
          fromAccountId: accountId,
          toAccountId,
          date,
          amountMinor: parsed,
          ...(crossCurrency ? { toAmountMinor: toParsed! } : {}),
          notes: notes.trim() || null,
        };
        if (existing?.transfer)
          await updateTransfer.mutateAsync({ groupId: existing.transfer.groupId, ...body });
        else await createTransfer.mutateAsync(body);
        toast.success(isEdit ? 'Transfer updated' : 'Transfer saved');
      } else {
        let splits:
          | Array<{ categoryId: string | null; amountMinor: number; memo: string }>
          | undefined;
        if (splitMode) {
          const valid = lines.filter((l) => l.amount.trim() !== '');
          if (valid.length < 2) {
            setError('A split needs at least two lines');
            return;
          }
          if (remaining !== 0) {
            setError(
              `Split lines must add up to the total (${f.money(Math.abs(remaining), currency)} off)`,
            );
            return;
          }
          splits = valid.map((l) => ({
            categoryId: l.categoryId,
            amountMinor: sign * (parseAmountInput(l.amount, digits) ?? 0),
            memo: l.memo.trim(),
          }));
        }
        const common = {
          accountId,
          date,
          amountMinor: sign * parsed,
          payee: payee.trim() || null,
          notes: notes.trim() || null,
          tagIds,
          ...(splits ? { splits } : { categoryId }),
        };
        if (existing) {
          await updateTx.mutateAsync({ id: existing.id, version: existing.version, ...common });
          toast.success('Saved');
        } else {
          const created = await createTx.mutateAsync({ id: uuidv7(), ...common });
          toast.success(mode === 'expense' ? 'Expense added' : 'Income added', {
            description: `${f.money(sign * parsed, currency)}${payee.trim() ? ` · ${payee.trim()}` : ''}`,
            action: {
              label: 'Undo',
              onClick: () => deleteTx.mutate(created.id),
            },
          });
        }
      }
      storage.set(LAST_ACCOUNT_KEY, accountId);
      if (another && !isEdit) onAnother({ mode, accountId, date });
      else onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(
          'This transaction was changed somewhere else. Close and reopen it to see the latest version.',
        );
      } else {
        setError(errorMessage(err));
      }
    }
  }

  async function remove() {
    if (!existing) return;
    const ok = await confirm({
      title: isTransfer ? 'Delete this transfer?' : 'Delete this transaction?',
      description: isTransfer
        ? 'Both sides of the transfer will be moved to the trash.'
        : 'You can undo this for 30 days.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTx.mutateAsync(existing.id);
      toast('Moved to trash', {
        action: { label: 'Undo', onClick: () => restoreTx.mutate(existing.id) },
      });
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const title = isEdit
    ? isTransfer
      ? 'Edit transfer'
      : 'Edit transaction'
    : mode === 'transfer'
      ? 'New transfer'
      : mode === 'income'
        ? 'New income'
        : 'New expense';

  return (
    <DialogContent variant={isEdit ? 'sheet' : 'modal'} aria-describedby={undefined}>
      <form onSubmit={(e) => submit(e)} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {existing?.rawDescription && (
            <DialogDescription className="line-clamp-2 text-xs">
              Bank: {existing.rawDescription}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 content-start gap-4">
          {!isEdit && (
            <Segmented
              label="Transaction type"
              value={mode}
              onChange={(m) => {
                setMode(m);
                if (!categoryTouched.current) setCategoryId(null);
              }}
              className="w-full"
              options={[
                { value: 'expense', label: 'Expense' },
                { value: 'income', label: 'Income' },
                { value: 'transfer', label: 'Transfer' },
              ]}
            />
          )}

          <Field label={mode === 'transfer' ? 'Amount sent' : 'Amount'} htmlFor="tx-amount">
            <AmountInput
              id="tx-amount"
              value={amount}
              onChange={setAmount}
              currency={currency}
              large
              autoFocus={!isEdit}
              placeholder="0"
              disabled={!canWrite}
            />
          </Field>

          {mode === 'transfer' ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="From" htmlFor="tx-from">
                  <AccountSelect
                    id="tx-from"
                    value={accountId}
                    onChange={setAccountId}
                    disabled={!canWrite}
                  />
                </Field>
                <Field label="To" htmlFor="tx-to">
                  <AccountSelect
                    id="tx-to"
                    value={toAccountId}
                    onChange={setToAccountId}
                    exclude={accountId}
                    disabled={!canWrite}
                  />
                </Field>
              </div>
              {toAccount && account && toAccount.currency !== account.currency && (
                <Field
                  label={`Amount received (${toAccount.currency})`}
                  htmlFor="tx-to-amount"
                  hint="What arrived in the other account, after conversion."
                >
                  <AmountInput
                    id="tx-to-amount"
                    value={toAmount}
                    onChange={setToAmount}
                    currency={toAccount.currency}
                  />
                </Field>
              )}
            </>
          ) : (
            <>
              {!splitMode && (
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium">Category</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      onClick={() => setSplitMode(true)}
                      disabled={!canWrite}
                    >
                      <Split className="size-3.5" /> Split
                    </button>
                  </div>
                  {frequent.length > 0 && (
                    <div className="grid grid-cols-4 gap-1.5">
                      {frequent.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            categoryTouched.current = true;
                            setCategoryId(c.id === categoryId ? null : c.id);
                          }}
                          aria-pressed={c.id === categoryId}
                          className={cn(
                            'flex flex-col items-center gap-1 rounded-lg border border-transparent px-1 py-2 text-center text-[11px] leading-tight transition-colors hover:bg-muted',
                            c.id === categoryId && 'border-primary bg-accent',
                          )}
                        >
                          <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                          <span className="line-clamp-2">{c.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <CategoryPicker
                    value={categoryId}
                    onChange={(id) => {
                      categoryTouched.current = true;
                      setCategoryId(id);
                    }}
                    // Money in can also be a refund, which goes back to a spending category.
                    kind={mode === 'expense' ? 'expense' : undefined}
                    placeholder="All categories…"
                  />
                  {mode === 'income' && (
                    <p className="text-xs text-muted-foreground">
                      Got a refund? Choose the spending category it belongs to, and it reduces that
                      category’s spending.
                    </p>
                  )}
                </div>
              )}

              {splitMode && (
                <div className="grid grid-cols-1 gap-2 rounded-xl border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium">Split between categories</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSplitMode(false);
                        setLines([]);
                      }}
                    >
                      <X /> Undo split
                    </Button>
                  </div>
                  {lines.map((line, i) => (
                    <div
                      key={line.key}
                      className="grid grid-cols-[1fr_7.5rem_auto] items-center gap-2"
                    >
                      <CategoryPicker
                        value={line.categoryId}
                        kind={kind}
                        onChange={(id) =>
                          setLines((ls) =>
                            ls.map((l) => (l.key === line.key ? { ...l, categoryId: id } : l)),
                          )
                        }
                      />
                      <Input
                        inputMode="decimal"
                        className="tabular"
                        aria-label={`Amount for line ${i + 1}`}
                        value={line.amount}
                        placeholder="0"
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((l) =>
                              l.key === line.key ? { ...l, amount: e.target.value } : l,
                            ),
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove line"
                        disabled={lines.length <= 2}
                        onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setLines((ls) => [
                          ...ls,
                          {
                            key: uuidv7(),
                            categoryId: null,
                            amount: remaining > 0 ? toDecimalString(remaining, digits) : '',
                            memo: '',
                          },
                        ])
                      }
                    >
                      <Plus /> Add line
                    </Button>
                    <span
                      className={cn(
                        'text-xs tabular',
                        remaining === 0 ? 'text-positive' : 'text-muted-foreground',
                      )}
                    >
                      {remaining === 0
                        ? 'All assigned'
                        : remaining > 0
                          ? `${f.money(remaining, currency)} left to assign`
                          : `${f.money(-remaining, currency)} too much`}
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={mode === 'income' ? 'From (payer)' : 'Payee'} htmlFor="tx-payee">
                  <PayeeInput
                    id="tx-payee"
                    value={payee}
                    onChange={setPayee}
                    placeholder={mode === 'income' ? 'Who paid you?' : 'Who did you pay?'}
                    onMatch={(p) => {
                      if (!categoryTouched.current && p.suggestedCategoryId) {
                        const suggestion = categoryMap.get(p.suggestedCategoryId);
                        if (suggestion?.group.kind === kind) setCategoryId(p.suggestedCategoryId);
                      }
                    }}
                    disabled={!canWrite}
                  />
                </Field>
                <Field label="Account" htmlFor="tx-account">
                  <AccountSelect
                    id="tx-account"
                    value={accountId}
                    onChange={setAccountId}
                    disabled={!canWrite}
                  />
                </Field>
              </div>
            </>
          )}

          <Field label="Date" htmlFor="tx-date">
            <DatePicker id="tx-date" value={date} onChange={setDate} />
          </Field>

          {mode !== 'transfer' && (
            <Field label="Tags">
              <TagPicker value={tagIds} onChange={setTagIds} />
            </Field>
          )}

          <Field label="Notes" htmlFor="tx-notes">
            <Textarea
              id="tx-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              rows={2}
              className="min-h-0"
              disabled={!canWrite}
            />
          </Field>

          {error && (
            <p
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
        </DialogBody>
        {canWrite && (
          <DialogFooter>
            {isEdit && (
              <Button variant="ghost" className="text-destructive sm:mr-auto" onClick={remove}>
                <Trash2 /> Delete
              </Button>
            )}
            {!isEdit && (
              <Button
                variant="outline"
                onClick={(e) => submit(e as unknown as FormEvent, true)}
                disabled={saving}
              >
                Save & add another
              </Button>
            )}
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {isEdit ? 'Save changes' : 'Save'}
            </Button>
          </DialogFooter>
        )}
      </form>
    </DialogContent>
  );
}

export type { Mode as TransactionMode };
