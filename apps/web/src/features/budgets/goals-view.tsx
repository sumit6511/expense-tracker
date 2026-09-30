import {
  COLOR_SWATCHES,
  type Goal,
  type GoalInput,
  type GoalKind,
  type IsoDate,
  parseAmountInput,
  toDecimalString,
} from '@et/shared';
import {
  Archive,
  ArchiveRestore,
  Ellipsis,
  Landmark,
  Loader2,
  Minus,
  Pencil,
  PiggyBank,
  Plus,
  Tags,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { DatePicker } from '@/components/date-picker';
import { CategoryIcon } from '@/components/icons';
import { Money } from '@/components/money';
import { EmptyState } from '@/components/page';
import { AccountSelect, AmountInput, CategoryPicker } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, Progress, Skeleton } from '@/components/ui/card';
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
import { Field, Input } from '@/components/ui/input';
import {
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Segmented,
} from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useAccountMap,
  useCategoryMap,
  useContributeGoal,
  useCreateGoal,
  useDeleteGoal,
  useGoals,
  useUpdateGoal,
} from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { cn } from '@/lib/utils';

type Editing = { goal?: Goal } | null;

export function GoalsView() {
  const { data: goals, isPending } = useGoals();
  const canWrite = useCanWrite();
  const [editing, setEditing] = useState<Editing>(null);
  const [adding, setAdding] = useState<Goal | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (isPending || !goals) return <Skeleton className="h-64" />;
  const active = goals.filter((g) => !g.archived);
  const archived = goals.filter((g) => g.archived);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Save for a bike, a trip, Dashain or an emergency fund. Track a savings account, a budget
          category that keeps what’s left each month, or amounts you put aside yourself.
        </p>
        {canWrite && (
          <Button onClick={() => setEditing({})}>
            <Plus /> New goal
          </Button>
        )}
      </div>
      {active.length === 0 ? (
        <Card>
          <EmptyState
            icon={PiggyBank}
            title="No goals yet"
            description="Set a target and a date, and see how much to put aside each month."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {active.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              canWrite={canWrite}
              onEdit={() => setEditing({ goal: g })}
              onAdd={() => setAdding(g)}
            />
          ))}
        </div>
      )}
      {archived.length > 0 && (
        <div>
          <button
            type="button"
            className="text-sm font-medium text-primary hover:underline"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? 'Hide' : 'Show'} {archived.length} archived
          </button>
          {showArchived && (
            <div className="mt-3 grid grid-cols-1 gap-4 opacity-70 md:grid-cols-2 xl:grid-cols-3">
              {archived.map((g) => (
                <GoalCard
                  key={g.id}
                  goal={g}
                  canWrite={canWrite}
                  onEdit={() => setEditing({ goal: g })}
                  onAdd={() => setAdding(g)}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <GoalDialog goal={editing.goal} onDone={() => setEditing(null)} />}
      </Dialog>
      <Dialog open={adding !== null} onOpenChange={(o) => !o && setAdding(null)}>
        {adding && <AddMoneyDialog goal={adding} onDone={() => setAdding(null)} />}
      </Dialog>
    </div>
  );
}

function GoalCard({
  goal: g,
  canWrite,
  onEdit,
  onAdd,
}: {
  goal: Goal;
  canWrite: boolean;
  onEdit: () => void;
  onAdd: () => void;
}) {
  const f = useFormat();
  const accounts = useAccountMap();
  const categories = useCategoryMap();
  const update = useUpdateGoal();
  const remove = useDeleteGoal();
  const confirm = useConfirm();
  const source =
    g.kind === 'account'
      ? (accounts.get(g.accountId ?? '')?.name ?? 'Account removed')
      : g.kind === 'category'
        ? `${categories.get(g.categoryId ?? '')?.name ?? 'Category removed'} fund`
        : 'Saved by hand';
  const overdue = g.targetDate !== null && g.targetDate < f.today && !g.reached;

  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-3 pt-4">
        <div className="flex items-start gap-3">
          <CategoryIcon icon={g.icon} color={g.color} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{g.name}</p>
            <p className="truncate text-xs text-muted-foreground">{source}</p>
          </div>
          {g.reached && <Badge tone="positive">Reached</Badge>}
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`${g.name} options`}>
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    update.mutate(
                      { id: g.id, archived: !g.archived },
                      { onError: (e) => toast.error(errorMessage(e)) },
                    )
                  }
                >
                  {g.archived ? <ArchiveRestore /> : <Archive />}{' '}
                  {g.archived ? 'Restore' : 'Archive'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  onSelect={async () => {
                    const ok = await confirm({
                      title: `Delete “${g.name}”?`,
                      description: 'Only the goal is removed; your money and transactions stay.',
                      confirmLabel: 'Delete',
                      destructive: true,
                    });
                    if (ok) remove.mutate(g.id, { onError: (e) => toast.error(errorMessage(e)) });
                  }}
                >
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <Money minor={g.currentMinor} className="text-xl font-semibold" trimZero />
            <span className="text-sm text-muted-foreground">
              of <Money minor={g.targetMinor} trimZero />
            </span>
          </div>
          <Progress
            value={g.progress * 100}
            tone={g.reached ? 'positive' : 'primary'}
            className="mt-2"
            label={`${g.name} progress`}
          />
        </div>
        <p className={cn('text-xs text-muted-foreground', overdue && 'text-destructive')}>
          {g.reached
            ? 'Target reached.'
            : g.targetDate
              ? overdue
                ? `Target date ${f.date(g.targetDate)} has passed.`
                : `${f.money(g.monthlyNeededMinor ?? 0, undefined, { trimZeroFraction: true })} a month for ${g.monthsLeft} month${g.monthsLeft === 1 ? '' : 's'} to reach it by ${f.date(g.targetDate)}.`
              : `${Math.round(g.progress * 100)}% there · no target date`}
        </p>
        {canWrite && g.kind === 'manual' && !g.archived && (
          <Button variant="outline" size="sm" className="justify-self-start" onClick={onAdd}>
            <Plus /> Add money
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function AddMoneyDialog({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const f = useFormat();
  const contribute = useContributeGoal();
  const [amount, setAmount] = useState('');
  const [takeOut, setTakeOut] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseAmountInput(amount, f.digits());
    if (!parsed) return;
    try {
      const next = await contribute.mutateAsync({
        id: goal.id,
        amountMinor: takeOut ? -Math.abs(parsed) : Math.abs(parsed),
      });
      toast.success(next.reached ? `“${goal.name}” reached 🎉` : 'Saved', {
        description: `${f.money(next.currentMinor)} of ${f.money(next.targetMinor)}`,
      });
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <DialogContent>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{goal.name}</DialogTitle>
          <DialogDescription>
            {f.money(goal.currentMinor)} saved of {f.money(goal.targetMinor)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-4">
          <Segmented
            label="Direction"
            className="w-full"
            value={takeOut ? 'out' : 'in'}
            onChange={(v) => setTakeOut(v === 'out')}
            options={[
              { value: 'in', label: 'Put money in' },
              { value: 'out', label: 'Take money out' },
            ]}
          />
          <Field label="Amount" htmlFor="goal-add">
            <AmountInput
              id="goal-add"
              currency={f.base}
              value={amount}
              onChange={setAmount}
              large
              autoFocus
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={contribute.isPending || !amount.trim()}>
            {contribute.isPending && <Loader2 className="animate-spin" />}
            {takeOut ? <Minus /> : <Plus />} {takeOut ? 'Take out' : 'Add'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

const KIND_OPTIONS: Array<{ value: GoalKind; label: string; icon: typeof PiggyBank }> = [
  { value: 'manual', label: 'By hand', icon: PiggyBank },
  { value: 'account', label: 'An account', icon: Landmark },
  { value: 'category', label: 'Budget fund', icon: Tags },
];

function GoalDialog({ goal, onDone }: { goal?: Goal; onDone: () => void }) {
  const f = useFormat();
  const create = useCreateGoal();
  const update = useUpdateGoal();
  const digits = f.digits();
  const [name, setName] = useState(goal?.name ?? '');
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? 'manual');
  const [target, setTarget] = useState(
    goal ? toDecimalString(goal.targetMinor, digits).replace(/\.0+$/, '') : '',
  );
  const [saved, setSaved] = useState('');
  const [hasDate, setHasDate] = useState(goal ? goal.targetDate !== null : true);
  const [targetDate, setTargetDate] = useState<IsoDate>(goal?.targetDate ?? f.today);
  const [accountId, setAccountId] = useState(goal?.accountId ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(goal?.categoryId ?? null);
  const [color, setColor] = useState(goal?.color ?? '#0f766e');
  const [error, setError] = useState<string | null>(null);
  const saving = create.isPending || update.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const targetMinor = parseAmountInput(target, digits);
    if (!name.trim()) return setError('Give the goal a name');
    if (!targetMinor || targetMinor <= 0) return setError('Enter the amount you want to reach');
    if (kind === 'account' && !accountId) return setError('Choose the account');
    if (kind === 'category' && !categoryId) return setError('Choose the category');
    const body: GoalInput = {
      name: name.trim(),
      kind,
      targetMinor,
      targetDate: hasDate ? targetDate : null,
      accountId: kind === 'account' ? accountId : null,
      categoryId: kind === 'category' ? categoryId : null,
      color,
      ...(!goal && kind === 'manual' && saved.trim()
        ? { savedMinor: Math.max(0, parseAmountInput(saved, digits) ?? 0) }
        : {}),
    };
    try {
      if (goal) await update.mutateAsync({ id: goal.id, ...body });
      else await create.mutateAsync(body);
      toast.success(goal ? 'Goal updated' : 'Goal created');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{goal ? 'Edit goal' : 'New goal'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-4">
          <Field label="Name" htmlFor="goal-name">
            <Input
              id="goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Emergency fund, New scooter, Dashain"
              maxLength={80}
            />
          </Field>
          <Field label="Target amount" htmlFor="goal-target">
            <AmountInput id="goal-target" currency={f.base} value={target} onChange={setTarget} />
          </Field>
          <div className="grid grid-cols-1 gap-2">
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={hasDate} onCheckedChange={(v) => setHasDate(v === true)} />
              Reach it by a date
            </label>
            {hasDate && <DatePicker value={targetDate} onChange={setTargetDate} id="goal-date" />}
          </div>
          <fieldset className="grid grid-cols-1 gap-2">
            <legend className="mb-1.5 text-[13px] font-medium">Track progress with</legend>
            <div className="grid grid-cols-3 gap-2">
              {KIND_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={kind === o.value}
                  onClick={() => setKind(o.value)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-colors hover:bg-muted [&_svg]:size-5',
                    kind === o.value && 'border-primary bg-accent text-accent-foreground',
                  )}
                >
                  <o.icon /> {o.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {kind === 'manual'
                ? 'Record what you put aside with “Add money”.'
                : kind === 'account'
                  ? 'Progress is the account’s balance, e.g. a savings account.'
                  : 'Budget for this category each month; what isn’t spent keeps adding up.'}
            </p>
          </fieldset>
          {kind === 'account' && (
            <Field label="Account" htmlFor="goal-account">
              <AccountSelect
                id="goal-account"
                value={accountId}
                onChange={setAccountId}
                includeArchived
              />
            </Field>
          )}
          {kind === 'category' && (
            <Field label="Category" hint="Rollover is turned on for it.">
              <CategoryPicker
                value={categoryId}
                onChange={setCategoryId}
                kind="expense"
                allowNone={false}
              />
            </Field>
          )}
          {kind === 'manual' && !goal && (
            <Field label="Already saved (optional)" htmlFor="goal-saved">
              <AmountInput id="goal-saved" currency={f.base} value={saved} onChange={setSaved} />
            </Field>
          )}
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Colour</legend>
            <div className="flex flex-wrap gap-2">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-7 rounded-full ring-offset-2 ring-offset-popover',
                    color === c && 'ring-2 ring-ring',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </fieldset>
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
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} {goal ? 'Save' : 'Create goal'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
