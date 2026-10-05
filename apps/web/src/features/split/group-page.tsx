import {
  amountInputError,
  computeShares,
  filterAmountInput,
  filterDecimalInput,
  parseAmountInput,
  type SplitExpense,
  type SplitGroup,
  type SplitMethod,
  type SplitSettlement,
  toDecimalString,
} from '@et/shared';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  Ellipsis,
  HandCoins,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DatePicker } from '@/components/date-picker';
import { EmptyState, ErrorState } from '@/components/page';
import { PersonAvatar } from '@/components/person';
import { AccountSelect, AmountInput, CategoryPicker } from '@/components/pickers';
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
import { Field, FilteredInput, Input } from '@/components/ui/input';
import {
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  Segmented,
  Switch,
} from '@/components/ui/menu';
import { Select, SelectItem } from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { usePageTitle } from '@/lib/page-title';
import {
  useAddSplitMember,
  useCreateSettlement,
  useDeleteSettlement,
  useDeleteSplitExpense,
  useDeleteSplitGroup,
  useRemoveSplitMember,
  useSaveSplitExpense,
  useSplitGroup,
  useUpdateSplitGroup,
} from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { cn } from '@/lib/utils';
import { YourPosition } from './split-page';

type Dialogs =
  | { kind: 'expense'; expense?: SplitExpense }
  | { kind: 'settle'; from?: string; to?: string; amountMinor?: number }
  | { kind: 'person' }
  | { kind: 'edit' }
  | null;

export function SplitGroupPage() {
  const { groupId } = useParams({ from: '/app/split/$groupId' });
  const group = useSplitGroup(groupId);
  usePageTitle(group.data?.name ?? 'Split');
  const canWrite = useCanWrite();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const close = () => setDialog(null);

  if (group.error) return <ErrorState error={group.error} retry={() => group.refetch()} />;
  if (group.isPending) return <Skeleton className="h-64" />;
  const g = group.data;
  const you = g.members.find((m) => m.you);

  return (
    <div className="pb-10">
      <Link
        to="/split"
        className="hit-area mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Split
      </Link>
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
            {g.name}
            {g.archived && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">(archived)</span>
            )}
          </h1>
          <YourPosition
            balance={you ? you.balanceMinor : null}
            currency={g.currency}
            className="mt-1 block text-sm font-medium"
          />
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'settle' })}>
              <HandCoins /> Settle up
            </Button>
            <Button size="sm" onClick={() => setDialog({ kind: 'expense' })}>
              <Plus /> Add expense
            </Button>
            <GroupMenu g={g} onEdit={() => setDialog({ kind: 'edit' })} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
        <Card className="self-start overflow-hidden">
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          {g.activity.length === 0 ? (
            <EmptyState
              as="h3"
              icon={Receipt}
              title="Nothing yet"
              description="Add the first expense: who paid, how much, and who it was for."
            />
          ) : (
            <ul className="divide-y border-t">
              {g.activity.map((item) =>
                item.type === 'expense' ? (
                  <ExpenseRow
                    key={item.id}
                    g={g}
                    e={item}
                    onOpen={
                      canWrite ? () => setDialog({ kind: 'expense', expense: item }) : undefined
                    }
                  />
                ) : (
                  <SettlementRow key={item.id} g={g} s={item} canWrite={canWrite} />
                ),
              )}
            </ul>
          )}
        </Card>

        <div className="grid grid-cols-1 content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{g.suggested.length ? 'To settle up' : 'Everyone’s settled up'}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2">
              {g.suggested.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody owes anybody anything.</p>
              ) : (
                g.suggested.map((d) => (
                  <DebtRow
                    key={`${d.fromMemberId}-${d.toMemberId}`}
                    g={g}
                    from={d.fromMemberId}
                    to={d.toMemberId}
                    amount={d.amountMinor}
                    onRecord={
                      canWrite
                        ? () =>
                            setDialog({
                              kind: 'settle',
                              from: d.fromMemberId,
                              to: d.toMemberId,
                              amountMinor: d.amountMinor,
                            })
                        : undefined
                    }
                  />
                ))
              )}
              <p className="text-xs text-muted-foreground">
                {g.simplifyDebts
                  ? 'Simplified: the fewest payments that settle everyone.'
                  : 'Shown per pair of people.'}
              </p>
            </CardContent>
          </Card>
          <Balances g={g} canWrite={canWrite} onAdd={() => setDialog({ kind: 'person' })} />
        </div>
      </div>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && close()}>
        {dialog?.kind === 'expense' && (
          <ExpenseDialog g={g} expense={dialog.expense} onDone={close} />
        )}
        {dialog?.kind === 'settle' && (
          <SettleDialog
            g={g}
            from={dialog.from}
            to={dialog.to}
            amountMinor={dialog.amountMinor}
            onDone={close}
          />
        )}
        {dialog?.kind === 'person' && <AddPersonDialog g={g} onDone={close} />}
        {dialog?.kind === 'edit' && <EditGroupDialog g={g} onDone={close} />}
      </Dialog>
    </div>
  );
}

/** A member's name, or "You"/"you" (mid-sentence) for the person asking. */
const nameOf = (g: SplitGroup, id: string, midSentence = false) => {
  const m = g.members.find((x) => x.id === id);
  if (!m) return 'Someone';
  return m.you ? (midSentence ? 'you' : 'You') : m.name;
};

function ExpenseRow({ g, e, onOpen }: { g: SplitGroup; e: SplitExpense; onOpen?: () => void }) {
  const f = useFormat();
  const you = g.members.find((m) => m.you);
  const yourShare = you ? (e.shares.find((s) => s.memberId === you.id)?.amountMinor ?? 0) : 0;
  const youPaid = you && e.paidByMemberId === you.id;
  const money = (m: number) => f.money(m, g.currency, { trimZeroFraction: true });
  let yours: { text: string; tone: string } | null = null;
  if (you) {
    if (youPaid && e.amountMinor - yourShare > 0)
      yours = { text: `you lent ${money(e.amountMinor - yourShare)}`, tone: 'text-positive' };
    else if (!youPaid && yourShare > 0)
      yours = { text: `you owe ${money(yourShare)}`, tone: 'text-foreground' };
    else if (!youPaid) yours = { text: 'not involved', tone: 'text-muted-foreground' };
  }
  const content = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
        <Receipt className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{e.description}</span>
          {e.linkedTransactionId && (
            <Hint label="Recorded in your accounts">
              <Link2 className="size-3.5 text-muted-foreground" />
            </Hint>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {f.relativeDate(e.date)} · {nameOf(g, e.paidByMemberId)} paid
          {yours && <span className={cn('ml-1', yours.tone)}>· {yours.text}</span>}
        </span>
      </span>
      <span className="shrink-0 text-sm font-medium tabular">
        {f.money(e.amountMinor, g.currency)}
      </span>
    </>
  );
  return (
    <li>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/60"
        >
          {content}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">{content}</div>
      )}
    </li>
  );
}

function SettlementRow({
  g,
  s,
  canWrite,
}: {
  g: SplitGroup;
  s: SplitSettlement;
  canWrite: boolean;
}) {
  const f = useFormat();
  const remove = useDeleteSettlement();
  const confirm = useConfirm();
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-positive/10 text-positive">
        <HandCoins className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">
            {nameOf(g, s.fromMemberId)} paid {nameOf(g, s.toMemberId, true)}
          </span>
          {s.linkedTransactionId && (
            <Hint label="Recorded in your accounts">
              <Link2 className="size-3.5 text-muted-foreground" />
            </Hint>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {f.relativeDate(s.date)}
          {s.notes ? ` · ${s.notes}` : ''}
        </span>
      </span>
      <span className="shrink-0 text-sm font-medium tabular">
        {f.money(s.amountMinor, g.currency, { trimZeroFraction: true })}
      </span>
      {canWrite && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Payment options">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              destructive
              onSelect={async () => {
                const ok = await confirm({
                  title: 'Delete this payment?',
                  description: s.linkedTransactionId
                    ? 'The transaction recorded in your accounts moves to the trash too.'
                    : undefined,
                  confirmLabel: 'Delete',
                  destructive: true,
                });
                if (!ok) return;
                remove.mutate(
                  { groupId: g.id, id: s.id },
                  { onError: (err) => toast.error(errorMessage(err)) },
                );
              }}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function DebtRow({
  g,
  from,
  to,
  amount,
  onRecord,
}: {
  g: SplitGroup;
  from: string;
  to: string;
  amount: number;
  onRecord?: () => void;
}) {
  const f = useFormat();
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-medium">{nameOf(g, from)}</span>
        <ArrowRight
          className="mx-1 inline size-3.5 text-muted-foreground"
          role="img"
          aria-label="pays"
        />
        <span className="font-medium">{nameOf(g, to)}</span>
        <span className="block text-xs text-muted-foreground tabular">
          {f.money(amount, g.currency, { trimZeroFraction: true })}
        </span>
      </span>
      {onRecord && (
        <Button variant="outline" size="sm" onClick={onRecord}>
          Record
        </Button>
      )}
    </div>
  );
}

function Balances({ g, canWrite, onAdd }: { g: SplitGroup; canWrite: boolean; onAdd: () => void }) {
  const f = useFormat();
  const remove = useRemoveSplitMember();
  const confirm = useConfirm();
  return (
    <Card>
      <CardHeader>
        <CardTitle>People</CardTitle>
        {canWrite && (
          <Button variant="ghost" size="sm" onClick={onAdd}>
            <UserPlus /> Add
          </Button>
        )}
      </CardHeader>
      <ul className="divide-y border-t">
        {g.members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
            <PersonAvatar id={m.id} name={m.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {m.name}
                {m.you && <span className="font-normal text-muted-foreground"> (you)</span>}
              </span>
              {/* One line on every row; the balance beside it stacks instead. */}
              <span className="block truncate text-xs text-muted-foreground tabular">
                Paid {f.money(m.paidMinor, g.currency, { trimZeroFraction: true })} · share{' '}
                {f.money(m.shareMinor, g.currency, { trimZeroFraction: true })}
              </span>
            </span>
            <span className="shrink-0 text-right tabular">
              {m.balanceMinor === 0 ? (
                <span className="text-sm text-muted-foreground">settled</span>
              ) : (
                <>
                  <span className="block text-xs text-muted-foreground">
                    {m.balanceMinor > 0 ? 'gets back' : 'owes'}
                  </span>
                  <span
                    className={cn(
                      'block text-sm font-medium',
                      m.balanceMinor > 0 && 'text-positive',
                    )}
                  >
                    {f.money(Math.abs(m.balanceMinor), g.currency, { trimZeroFraction: true })}
                  </span>
                </>
              )}
            </span>
            {canWrite &&
              !m.you &&
              m.paidMinor === 0 &&
              m.shareMinor === 0 &&
              m.balanceMinor === 0 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${m.name}`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Remove ${m.name} from the group?`,
                      confirmLabel: 'Remove',
                      destructive: true,
                    });
                    if (ok)
                      remove.mutate(
                        { groupId: g.id, memberId: m.id },
                        { onError: (err) => toast.error(errorMessage(err)) },
                      );
                  }}
                >
                  <Trash2 />
                </Button>
              )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GroupMenu({ g, onEdit }: { g: SplitGroup; onEdit: () => void }) {
  const update = useUpdateSplitGroup();
  const remove = useDeleteSplitGroup();
  const confirm = useConfirm();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Group options">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil /> Edit group
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            update.mutate(
              { id: g.id, archived: !g.archived },
              {
                onSuccess: () => toast.success(g.archived ? 'Group restored' : 'Group archived'),
                onError: (err) => toast.error(errorMessage(err)),
              },
            )
          }
        >
          {g.archived ? <ArchiveRestore /> : <Archive />} {g.archived ? 'Unarchive' : 'Archive'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={async () => {
            const ok = await confirm({
              title: `Delete “${g.name}”?`,
              description:
                'Its expenses and payments are deleted. Transactions you recorded in your accounts stay.',
              confirmLabel: 'Delete group',
              destructive: true,
            });
            if (!ok) return;
            try {
              await remove.mutateAsync(g.id);
              toast.success('Group deleted');
              navigate({ to: '/split' });
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        >
          <Trash2 /> Delete group
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------------------------

const METHOD_OPTIONS: Array<{ value: SplitMethod; label: string }> = [
  { value: 'equal', label: 'Equally' },
  { value: 'exact', label: 'Amounts' },
  { value: 'percent', label: '%' },
  { value: 'shares', label: 'Shares' },
];

function ExpenseDialog({
  g,
  expense,
  onDone,
}: {
  g: SplitGroup;
  expense?: SplitExpense;
  onDone: () => void;
}) {
  const f = useFormat();
  const save = useSaveSplitExpense();
  const remove = useDeleteSplitExpense();
  const confirm = useConfirm();
  const digits = f.digits(g.currency);
  const you = g.members.find((m) => m.you);
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState(expense ? toDecimalString(expense.amountMinor, digits) : '');
  const [date, setDate] = useState(expense?.date ?? f.today);
  const [paidBy, setPaidBy] = useState(expense?.paidByMemberId ?? you?.id ?? g.members[0]!.id);
  const [method, setMethod] = useState<SplitMethod>(expense?.method ?? 'equal');
  // Who shares it, and what was typed for them (amount, percent or number of shares).
  const [rows, setRows] = useState<Record<string, { on: boolean; value: string }>>(() =>
    Object.fromEntries(
      g.members.map((m) => {
        const share = expense?.shares.find((s) => s.memberId === m.id);
        const value =
          share?.value == null
            ? ''
            : expense!.method === 'exact'
              ? toDecimalString(share.value, digits)
              : expense!.method === 'percent'
                ? String(share.value / 100)
                : String(share.value);
        return [m.id, { on: expense ? share !== undefined : true, value }];
      }),
    ),
  );
  const [record, setRecord] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(g.categoryId);
  const [error, setError] = useState<string | null>(null);
  const youPay = you !== undefined && paidBy === you.id;

  const total = amount.trim() ? parseAmountInput(amount, digits) : null;
  const inputs = g.members
    .filter((m) => rows[m.id]?.on)
    .map((m) => {
      const raw = rows[m.id]!.value.trim();
      let value: number | null = null;
      if (method === 'exact') value = raw ? parseAmountInput(raw, digits) : 0;
      else if (method === 'percent') value = raw ? Math.round(Number(raw) * 100) : 0;
      else if (method === 'shares') value = raw ? Number(raw) : 0;
      // Text left over from another method (e.g. "1,500" when switching to percent).
      if (value !== null && !Number.isFinite(value)) value = null;
      return { memberId: m.id, name: m.name, value };
    });
  const preview = useMemo(
    () => (total && total > 0 ? computeShares(total, method, inputs) : null),
    [total, method, inputs],
  );
  const shareOf = (id: string) =>
    preview?.ok ? preview.shares.find((s) => s.memberId === id)?.amountMinor : undefined;

  let remainder: string | null = null;
  if (total && method === 'exact') {
    const left = total - inputs.reduce((s, i) => s + (i.value ?? 0), 0);
    if (left !== 0)
      remainder = `${f.money(Math.abs(left), g.currency)} ${left > 0 ? 'left to assign' : 'too much'}`;
  } else if (method === 'percent') {
    const left = 10_000 - inputs.reduce((s, i) => s + (i.value ?? 0), 0);
    if (left !== 0) remainder = `${Math.abs(left) / 100}% ${left > 0 ? 'left' : 'too much'}`;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amountError = amountInputError(amount, digits);
    if (amountError || !total) return setError(amountError ?? 'Enter an amount');
    const unclear = method === 'equal' ? undefined : inputs.find((i) => i.value === null);
    if (unclear) {
      return setError(
        `Check the ${method === 'exact' ? 'amount' : method === 'percent' ? 'percent' : 'shares'} for ${unclear.name}`,
      );
    }
    if (preview && !preview.ok) return setError(preview.error);
    if (record && youPay && !accountId) return setError('Choose the account you paid from');
    try {
      await save.mutateAsync({
        groupId: g.id,
        expenseId: expense?.id,
        date,
        description: description.trim(),
        amountMinor: total,
        paidByMemberId: paidBy,
        method,
        shares: inputs.map((i) => ({
          memberId: i.memberId,
          value: method === 'equal' ? null : i.value,
        })),
        record: !expense && record && youPay ? { accountId, categoryId } : null,
      });
      toast.success(expense ? 'Expense updated' : 'Expense added');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <DialogContent variant="sheet" aria-describedby={undefined}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{expense ? 'Edit expense' : 'Add expense'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 content-start gap-4">
          <Field label="What for" htmlFor="split-desc">
            <Input
              id="split-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Dinner, Hotel, Taxi"
              maxLength={120}
              required
              autoFocus={!expense}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Amount" htmlFor="split-amount">
              <AmountInput
                id="split-amount"
                value={amount}
                onChange={setAmount}
                currency={g.currency}
              />
            </Field>
            <Field label="Date" htmlFor="split-date">
              <DatePicker id="split-date" value={date} onChange={setDate} />
            </Field>
          </div>
          <Field label="Paid by" htmlFor="split-paid-by">
            <Select id="split-paid-by" value={paidBy} onValueChange={setPaidBy}>
              {g.members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.you ? `${m.name} (you)` : m.name}
                </SelectItem>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-1 gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-compact font-medium">Split</span>
              <Segmented
                size="sm"
                label="How to split"
                value={method}
                onChange={setMethod}
                options={METHOD_OPTIONS}
              />
            </div>
            <ul className="divide-y rounded-xl border">
              {g.members.map((m) => {
                const row = rows[m.id]!;
                const share = shareOf(m.id);
                return (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox
                      checked={row.on}
                      onCheckedChange={(v) =>
                        setRows((r) => ({ ...r, [m.id]: { ...row, on: v === true } }))
                      }
                      aria-label={`Include ${m.name}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {m.name}
                      {m.you && <span className="text-muted-foreground"> (you)</span>}
                    </span>
                    {method !== 'equal' && row.on && (
                      <FilteredInput
                        value={row.value}
                        filter={(text) =>
                          method === 'exact'
                            ? filterAmountInput(text)
                            : filterDecimalInput(text, { maxDecimals: 2 })
                        }
                        onValueChange={(value) =>
                          setRows((r) => ({ ...r, [m.id]: { ...row, value } }))
                        }
                        autoComplete="off"
                        inputMode="decimal"
                        aria-label={`${method === 'exact' ? 'Amount' : method === 'percent' ? 'Percent' : 'Shares'} for ${m.name}`}
                        placeholder={method === 'exact' ? '0' : method === 'percent' ? '%' : '1'}
                        className="h-8 w-24 text-right"
                      />
                    )}
                    <span className="w-24 text-right text-xs text-muted-foreground tabular">
                      {row.on && share !== undefined
                        ? f.money(share, g.currency, { trimZeroFraction: true })
                        : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
            {remainder && <p className="text-xs text-warning">{remainder}</p>}
          </div>

          {!expense && youPay && (
            <div className="grid grid-cols-1 gap-3 rounded-xl border p-3">
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>
                  Record in my accounts
                  <span className="block text-xs text-muted-foreground">
                    Adds what you paid to one of your accounts. When others pay you back, record
                    that too, and your spending ends up as your share.
                  </span>
                </span>
                <Switch checked={record} onCheckedChange={setRecord} />
              </label>
              {record && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Paid from" htmlFor="split-account">
                    <AccountSelect
                      id="split-account"
                      value={accountId}
                      onChange={setAccountId}
                      currency={g.currency}
                    />
                  </Field>
                  <Field label="Category" htmlFor="split-category">
                    <CategoryPicker
                      id="split-category"
                      value={categoryId}
                      onChange={setCategoryId}
                      kind="expense"
                      allowNone
                    />
                  </Field>
                </div>
              )}
            </div>
          )}
          {expense?.linkedTransactionId && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Link2 className="size-3.5" /> Recorded in your accounts; changes here update it.
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          {expense && (
            <Button
              variant="ghost"
              className="text-destructive sm:mr-auto"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Delete this expense?',
                  description: expense.linkedTransactionId
                    ? 'The transaction recorded in your accounts moves to the trash too.'
                    : undefined,
                  confirmLabel: 'Delete',
                  destructive: true,
                });
                if (!ok) return;
                try {
                  await remove.mutateAsync({ groupId: g.id, expenseId: expense.id });
                  toast.success('Expense deleted');
                  onDone();
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              <Trash2 /> Delete
            </Button>
          )}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}{' '}
            {expense ? 'Save changes' : 'Add expense'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function SettleDialog({
  g,
  from: initialFrom,
  to: initialTo,
  amountMinor,
  onDone,
}: {
  g: SplitGroup;
  from?: string;
  to?: string;
  amountMinor?: number;
  onDone: () => void;
}) {
  const f = useFormat();
  const create = useCreateSettlement();
  const digits = f.digits(g.currency);
  const you = g.members.find((m) => m.you);
  const first = g.suggested[0];
  const [from, setFrom] = useState(initialFrom ?? first?.fromMemberId ?? g.members[0]!.id);
  const [to, setTo] = useState(initialTo ?? first?.toMemberId ?? g.members[1]?.id ?? '');
  const suggestedAmount = amountMinor ?? first?.amountMinor;
  const [amount, setAmount] = useState(
    suggestedAmount ? toDecimalString(suggestedAmount, digits) : '',
  );
  const [date, setDate] = useState(f.today);
  const [notes, setNotes] = useState('');
  const [record, setRecord] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(g.categoryId);
  const [error, setError] = useState<string | null>(null);
  const involvesYou = you !== undefined && (from === you.id || to === you.id);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = amount.trim() ? parseAmountInput(amount, digits) : null;
    const amountError = amountInputError(amount, digits);
    if (amountError || !value) return setError(amountError ?? 'Enter an amount');
    if (record && involvesYou && !accountId) return setError('Choose the account');
    try {
      await create.mutateAsync({
        groupId: g.id,
        date,
        fromMemberId: from,
        toMemberId: to,
        amountMinor: value,
        notes: notes.trim(),
        record: record && involvesYou ? { accountId, categoryId } : null,
      });
      toast.success('Payment recorded');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const option = (id: string) => {
    const m = g.members.find((x) => x.id === id)!;
    return m.you ? `${m.name} (you)` : m.name;
  };

  return (
    <DialogContent>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>Settle up</DialogTitle>
          <DialogDescription>Record money paid back between two people.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Who paid" htmlFor="settle-from">
              <Select id="settle-from" value={from} onValueChange={setFrom}>
                {g.members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {option(m.id)}
                  </SelectItem>
                ))}
              </Select>
            </Field>
            <Field label="Paid to" htmlFor="settle-to">
              <Select id="settle-to" value={to} onValueChange={setTo}>
                {g.members
                  .filter((m) => m.id !== from)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {option(m.id)}
                    </SelectItem>
                  ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Amount" htmlFor="settle-amount">
              <AmountInput
                id="settle-amount"
                value={amount}
                onChange={setAmount}
                currency={g.currency}
              />
            </Field>
            <Field label="Date" htmlFor="settle-date">
              <DatePicker id="settle-date" value={date} onChange={setDate} />
            </Field>
          </div>
          <Field label="Note" htmlFor="settle-notes">
            <Input
              id="settle-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. eSewa, cash"
              maxLength={200}
            />
          </Field>
          {involvesYou && (
            <div className="grid grid-cols-1 gap-3 rounded-xl border p-3">
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>
                  Record in my accounts
                  <span className="block text-xs text-muted-foreground">
                    {from === you?.id
                      ? 'Adds the payment as money out of your account.'
                      : 'Adds the money you got back to your account.'}
                  </span>
                </span>
                <Switch checked={record} onCheckedChange={setRecord} />
              </label>
              {record && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Account" htmlFor="settle-account">
                    <AccountSelect
                      id="settle-account"
                      value={accountId}
                      onChange={setAccountId}
                      currency={g.currency}
                    />
                  </Field>
                  <Field label="Category" htmlFor="settle-category">
                    <CategoryPicker
                      id="settle-category"
                      value={categoryId}
                      onChange={setCategoryId}
                      kind="expense"
                      allowNone
                    />
                  </Field>
                </div>
              )}
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />} Record payment
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function AddPersonDialog({ g, onDone }: { g: SplitGroup; onDone: () => void }) {
  const add = useAddSplitMember();
  const [name, setName] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await add.mutateAsync({ groupId: g.id, name: name.trim() });
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <DialogContent aria-describedby={undefined}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>Add a person</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Field label="Name" htmlFor="person-name">
            <Input
              id="person-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={60}
              autoFocus
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={add.isPending || !name.trim()}>
            Add
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function EditGroupDialog({ g, onDone }: { g: SplitGroup; onDone: () => void }) {
  const update = useUpdateSplitGroup();
  const [name, setName] = useState(g.name);
  const [categoryId, setCategoryId] = useState<string | null>(g.categoryId);
  const [simplify, setSimplify] = useState(g.simplifyDebts);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        id: g.id,
        name: name.trim(),
        categoryId,
        simplifyDebts: simplify,
      });
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <DialogContent aria-describedby={undefined}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>Edit group</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-4">
          <Field label="Name" htmlFor="edit-group-name">
            <Input
              id="edit-group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={60}
            />
          </Field>
          <Field label="Category for your share" htmlFor="edit-group-category">
            <CategoryPicker
              id="edit-group-category"
              value={categoryId}
              onChange={setCategoryId}
              kind="expense"
              allowNone
            />
          </Field>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>Simplify debts</span>
            <Switch checked={simplify} onCheckedChange={setSimplify} />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={update.isPending}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
