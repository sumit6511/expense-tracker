import {
  amountInputError,
  type CategoryKind,
  filterAmountInput,
  type IsoDate,
  parseAmountInput,
  type Transaction,
  type TransactionDraft,
  toDecimalString,
  uuidv7,
} from '@et/shared';
import { Loader2, Lock, Plus, Repeat, Split, Trash2, X } from 'lucide-react';
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
import { Field, FilteredInput, Input, Textarea } from '@/components/ui/input';
import { Checkbox, Segmented } from '@/components/ui/menu';
import {
  recurringFromTransaction,
  useRecurringDialog,
} from '@/features/recurring/recurring-dialog';
import { canMakeRule, ruleFromTransaction, useRuleDialog } from '@/features/rules/rule-dialog';
import { ApiError, errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { isOffline, outbox } from '@/lib/outbox';
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
  useUploadAttachment,
} from '@/lib/queries';
import { useCanWrite, useSession, useWorkspace } from '@/lib/session';
import { cn, storage } from '@/lib/utils';
import { TransactionHistory } from './history';
import { QuickDescribe } from './quick-describe';
import { ReceiptsField, uploadAll } from './receipts';

type Mode = 'expense' | 'income' | 'transfer';

export interface NewTransactionDefaults {
  mode?: Mode;
  accountId?: string;
  date?: IsoDate;
  categoryId?: string | null;
  /** Positive, in the account's currency. */
  amountMinor?: number;
  payee?: string;
  notes?: string;
  /** Receipts to attach once it's saved. */
  files?: File[];
  /** Called with the new transaction once it's saved (not for offline saves). */
  onCreated?: (tx: Transaction) => void;
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
  const t = useT();
  const canWrite = useCanWrite();
  const confirm = useConfirm();
  const { data: accounts = [] } = useAccounts();
  const accountMap = useAccountMap();
  const categoryMap = useCategoryMap();
  const { data: groups = [] } = useCategories();
  const { openRecurring } = useRecurringDialog();
  const ws = useWorkspace();
  const { me } = useSession();

  const isEdit = existing !== null;
  const isTransfer = existing?.transfer != null;
  // A transfer with someone else's private account: only they can change it.
  const lockedTransfer =
    isTransfer && accounts.length > 0 && !accountMap.has(existing!.transfer!.peerAccountId);
  const editable = canWrite && !lockedTransfer;
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
    if (!existing) {
      return defaults.amountMinor ? amountText(defaults.amountMinor, currency) : '';
    }
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
  const [payee, setPayee] = useState(existing?.payeeName ?? defaults.payee ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(
    existing
      ? existing.splits.length === 1
        ? existing.splits[0]!.categoryId
        : null
      : (defaults.categoryId ?? null),
  );
  const categoryTouched = useRef(existing !== null || defaults.categoryId !== undefined);
  const [notes, setNotes] = useState(existing?.notes ?? defaults.notes ?? '');
  const [tagIds, setTagIds] = useState<string[]>(existing?.tagIds ?? []);
  const [pending, setPending] = useState(existing?.status === 'pending');
  const [queuedFiles, setQueuedFiles] = useState<File[]>(defaults.files ?? []);
  const upload = useUploadAttachment();
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
  // The amount's problem shows under the field once they've left it or tried to save.
  const [amountShown, setAmountShown] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const createTx = useCreateTransaction();
  const updateTx = useUpdateTransaction();
  const { openRule } = useRuleDialog();
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

  /** Fills the form from a sentence or a scanned receipt; the person still checks and saves. */
  function applyDraft(draft: TransactionDraft) {
    if (mode !== draft.direction) setMode(draft.direction);
    // A receipt in another currency: use an account in that currency if there is one.
    let cur = currency;
    if (draft.accountId && accountMap.has(draft.accountId)) {
      setAccountId(draft.accountId);
      cur = accountMap.get(draft.accountId)!.currency;
    } else if (draft.currency && draft.currency !== currency) {
      const match = accounts.find((a) => !a.archived && a.currency === draft.currency);
      if (match) {
        setAccountId(match.id);
        cur = match.currency;
      } else {
        toast.warning(`This is in ${draft.currency}; pick the account it was paid from.`);
      }
    }
    if (draft.amountMinor !== null)
      setAmount(toDecimalString(draft.amountMinor, f.digits(draft.currency ?? cur)));
    if (draft.date) setDate(draft.date);
    if (draft.payee) setPayee(draft.payee);
    if (draft.categoryId) {
      setCategoryId(draft.categoryId);
      categoryTouched.current = true;
    } else if (!categoryTouched.current && draft.direction !== mode) {
      setCategoryId(null);
    }
    if (draft.notes) setNotes((n) => (n ? `${n} · ${draft.notes}` : draft.notes!));
  }
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

  async function submit(event: FormEvent, another = false, confirmReconciled = false) {
    event.preventDefault();
    setError(null);
    if (!editable) return;
    if (amountInputError(amount, digits) || parsed === null) {
      setAmountShown(true);
      document.getElementById('tx-amount')?.focus();
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
        const toError = crossCurrency
          ? amountInputError(toAmount, f.digits(toAccount.currency))
          : null;
        if (toError || (crossCurrency && toParsed === null)) {
          setError(
            toError === 'Enter an amount' || !toError
              ? `Enter the amount received in ${toAccount!.currency}`
              : `Amount received: ${toError}`,
          );
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
          const badLine = lines.findIndex(
            (l) => l.amount.trim() !== '' && amountInputError(l.amount, digits) !== null,
          );
          if (badLine !== -1) {
            setError(`Line ${badLine + 1}: ${amountInputError(lines[badLine]!.amount, digits)}`);
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
          // A reconciled transaction keeps its status; otherwise pending or cleared.
          ...(existing?.status === 'reconciled'
            ? {}
            : { status: pending ? ('pending' as const) : ('cleared' as const) }),
        };
        if (existing) {
          // Saving an edit also confirms a transaction waiting in the review inbox.
          const saved = await updateTx.mutateAsync({
            id: existing.id,
            version: existing.version,
            ...common,
            ...(existing.needsReview && { needsReview: false }),
            ...(confirmReconciled && { confirmReconciled: true }),
          });
          const recategorized =
            !splits &&
            categoryId !== null &&
            (existing.splits.length !== 1 || existing.splits[0]!.categoryId !== categoryId);
          toast.success(t('Saved'), {
            ...(recategorized &&
              canMakeRule(saved) && {
                description: t('Categorize similar transactions like this automatically?'),
                action: {
                  label: t('Always do this'),
                  onClick: () => openRule(ruleFromTransaction(saved, categoryId)),
                },
              }),
          });
        } else {
          const body = { id: uuidv7(), ...common };
          const summary = `${f.money(sign * parsed, currency)}${payee.trim() ? ` · ${payee.trim()}` : ''}`;
          let created: Transaction | null = null;
          try {
            created = navigator.onLine ? await createTx.mutateAsync(body) : null;
          } catch (err) {
            if (!isOffline(err)) throw err;
          }
          if (created) {
            const id = created.id;
            if (queuedFiles.length) await uploadAll(upload, id, queuedFiles);
            defaults.onCreated?.(created);
            toast.success(mode === 'expense' ? t('Expense added') : t('Income added'), {
              description: summary,
              action: { label: t('Undo'), onClick: () => deleteTx.mutate(id) },
            });
          } else {
            // Offline: keep it on this device and send it when the connection is back.
            outbox.add({ id: body.id, userId: me.user.id, workspaceId: ws.id, body });
            toast.success(t('Saved on this device'), {
              description: `${summary} · ${t('it syncs when you’re back online')}`,
            });
            if (queuedFiles.length)
              toast.warning(t('Receipts need a connection. Add them once it has synced.'));
          }
        }
      }
      storage.set(LAST_ACCOUNT_KEY, accountId);
      if (another && !isEdit) onAnother({ mode, accountId, date });
      else onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'reconciled' && !confirmReconciled) {
        const ok = await confirm({
          title: 'Change a reconciled transaction?',
          description: err.message,
          confirmLabel: 'Change it',
        });
        if (ok) return submit(event, another, true);
      } else if (err instanceof ApiError && err.status === 409) {
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
      title: isTransfer ? t('Delete this transfer?') : t('Delete this transaction?'),
      description: isTransfer
        ? t('Both sides of the transfer will be moved to the trash.')
        : t('You can undo this for 30 days.'),
      confirmLabel: t('Delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTx.mutateAsync(existing.id);
      toast(t('Moved to trash'), {
        action: { label: t('Undo'), onClick: () => restoreTx.mutate(existing.id) },
      });
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const title = t(
    isEdit
      ? isTransfer
        ? lockedTransfer
          ? 'Transfer'
          : 'Edit transfer'
        : 'Edit transaction'
      : mode === 'transfer'
        ? 'New transfer'
        : mode === 'income'
          ? 'New income'
          : 'New expense',
  );

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
          {lockedTransfer && (
            <p className="flex gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-4 shrink-0" />
              The other side of this transfer is someone’s private account, so only they can change
              or delete it.
            </p>
          )}
          {!isEdit && editable && (
            <QuickDescribe
              accountId={accountId}
              onDraft={applyDraft}
              onReceipt={(file) => setQueuedFiles((q) => [...q, file])}
            />
          )}
          {!isEdit && (
            <Segmented
              label={t('Transaction type')}
              value={mode}
              onChange={(m) => {
                setMode(m);
                if (!categoryTouched.current) setCategoryId(null);
              }}
              className="w-full"
              options={[
                { value: 'expense', label: t('Expense') },
                { value: 'income', label: t('Income') },
                { value: 'transfer', label: t('Transfer') },
              ]}
            />
          )}

          <Field
            label={mode === 'transfer' ? t('Amount sent') : t('Amount')}
            htmlFor="tx-amount"
            error={(amountShown && amountInputError(amount, digits)) || undefined}
          >
            <AmountInput
              id="tx-amount"
              value={amount}
              onChange={setAmount}
              onBlur={() => amount.trim() && setAmountShown(true)}
              currency={currency}
              large
              autoFocus={!isEdit}
              placeholder="0"
              disabled={!editable}
            />
          </Field>

          {mode === 'transfer' ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t('From')} htmlFor="tx-from">
                  {lockedTransfer && accountId === existing?.transfer?.peerAccountId ? (
                    <Input id="tx-from" value="Someone’s private account" disabled />
                  ) : (
                    <AccountSelect
                      id="tx-from"
                      value={accountId}
                      onChange={setAccountId}
                      disabled={!editable}
                    />
                  )}
                </Field>
                <Field label={t('To')} htmlFor="tx-to">
                  {lockedTransfer && toAccountId === existing?.transfer?.peerAccountId ? (
                    <Input id="tx-to" value="Someone’s private account" disabled />
                  ) : (
                    <AccountSelect
                      id="tx-to"
                      value={toAccountId}
                      onChange={setToAccountId}
                      exclude={accountId}
                      disabled={!editable}
                    />
                  )}
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
                    <span className="text-[13px] font-medium">{t('Category')}</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      onClick={() => setSplitMode(true)}
                      disabled={!editable}
                    >
                      <Split className="size-3.5" /> {t('Split')}
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
                    placeholder={t('All categories…')}
                  />
                  {mode === 'income' && (
                    <p className="text-xs text-muted-foreground">
                      {t(
                        'Got a refund? Choose the spending category it belongs to, and it reduces that category’s spending.',
                      )}
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
                      <FilteredInput
                        inputMode="decimal"
                        autoComplete="off"
                        className="tabular"
                        aria-label={`Amount for line ${i + 1}`}
                        value={line.amount}
                        placeholder="0"
                        filter={(text) => filterAmountInput(text)}
                        aria-invalid={
                          line.amount.trim() !== '' &&
                          amountInputError(line.amount, digits) !== null
                        }
                        onValueChange={(value) =>
                          setLines((ls) =>
                            ls.map((l) => (l.key === line.key ? { ...l, amount: value } : l)),
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
                <Field
                  label={mode === 'income' ? t('From (payer)') : t('Payee')}
                  htmlFor="tx-payee"
                >
                  <PayeeInput
                    id="tx-payee"
                    maxLength={120}
                    value={payee}
                    onChange={setPayee}
                    placeholder={mode === 'income' ? t('Who paid you?') : t('Who did you pay?')}
                    onMatch={(p) => {
                      if (!categoryTouched.current && p.suggestedCategoryId) {
                        const suggestion = categoryMap.get(p.suggestedCategoryId);
                        if (suggestion?.group.kind === kind) setCategoryId(p.suggestedCategoryId);
                      }
                    }}
                    disabled={!editable}
                  />
                </Field>
                <Field label={t('Account')} htmlFor="tx-account">
                  <AccountSelect
                    id="tx-account"
                    value={accountId}
                    onChange={setAccountId}
                    disabled={!editable}
                  />
                </Field>
              </div>
            </>
          )}

          <Field label={t('Date')} htmlFor="tx-date">
            <DatePicker id="tx-date" value={date} onChange={setDate} />
          </Field>

          {mode !== 'transfer' && (
            <Field label={t('Tags')}>
              <TagPicker value={tagIds} onChange={setTagIds} />
            </Field>
          )}

          <Field label={t('Notes')} htmlFor="tx-notes">
            <Textarea
              id="tx-notes"
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('Optional')}
              rows={2}
              className="min-h-0"
              disabled={!editable}
            />
          </Field>

          {mode !== 'transfer' &&
            (existing?.status === 'reconciled' ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="size-3.5" /> Reconciled with a bank statement
              </p>
            ) : (
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox
                  checked={pending}
                  onCheckedChange={(v) => setPending(v === true)}
                  disabled={!editable}
                />
                <span>
                  {t('Pending')}
                  <span className="text-muted-foreground">
                    {' '}
                    · {t('not on the bank statement yet')}
                  </span>
                </span>
              </label>
            ))}

          {mode !== 'transfer' && (
            <ReceiptsField
              transactionId={existing?.id ?? null}
              queued={queuedFiles}
              onQueue={setQueuedFiles}
              disabled={!editable}
            />
          )}

          {existing && <TransactionHistory tx={existing} />}

          {error && (
            <p
              ref={errorRef}
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
        </DialogBody>
        {editable && (
          <DialogFooter>
            {isEdit && (
              <Button variant="ghost" className="text-destructive sm:mr-auto" onClick={remove}>
                <Trash2 /> {t('Delete')}
              </Button>
            )}
            {existing && !existing.recurringId && (
              <Button
                variant="ghost"
                onClick={() => {
                  onDone();
                  const single =
                    existing.splits.length === 1 ? existing.splits[0]!.categoryId : null;
                  openRecurring(
                    recurringFromTransaction(existing, f.calendar, {
                      category: single ? categoryMap.get(single)?.name : undefined,
                    }),
                  );
                }}
              >
                <Repeat /> {t('Make recurring')}
              </Button>
            )}
            {!isEdit && (
              <Button
                variant="outline"
                onClick={(e) => submit(e as unknown as FormEvent, true)}
                disabled={saving}
              >
                {t('Save & add another')}
              </Button>
            )}
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {isEdit ? t('Save changes') : t('Save')}
            </Button>
          </DialogFooter>
        )}
      </form>
    </DialogContent>
  );
}

export type { Mode as TransactionMode };
