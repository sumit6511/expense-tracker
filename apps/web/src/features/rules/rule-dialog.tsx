import {
  describeCondition,
  descriptionKeyword,
  parseAmountInput,
  type Rule,
  type RuleAction,
  RuleBodySchema,
  type RuleCondition,
  type RuleInput,
  type Transaction,
  toDecimalString,
  uuidv7,
} from '@et/shared';
import { Loader2, Plus, Sparkles, X } from 'lucide-react';
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
import { AccountSelect, AmountInput, CategoryPicker, TagPicker } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input, Label, NativeSelect } from '@/components/ui/input';
import { Checkbox, Segmented, Switch } from '@/components/ui/menu';
import { TransactionRow } from '@/features/transactions/transaction-row';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useAccountMap,
  useApplyRule,
  useCategoryMap,
  useCreateRule,
  useRulePreview,
  useTags,
  useUpdateRule,
} from '@/lib/queries';
import { cn, useDebouncedValue } from '@/lib/utils';

// ---------------------------------------------------------------------------------------------
// Opening the editor from anywhere
// ---------------------------------------------------------------------------------------------

/** A rule to start editing from: a saved rule, or a draft (e.g. built from a transaction). */
export type RuleStart = (RuleInput & { id?: string }) | Rule;

const RuleDialogContext = createContext<{
  openRule: (start?: RuleStart) => void;
} | null>(null);

export function useRuleDialog() {
  const ctx = useContext(RuleDialogContext);
  if (!ctx) throw new Error('useRuleDialog must be used inside RuleDialogProvider');
  return ctx;
}

export function RuleDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; start?: RuleStart; key: number }>({
    open: false,
    key: 0,
  });
  const openRule = useCallback(
    (start?: RuleStart) => setState((s) => ({ open: true, start, key: s.key + 1 })),
    [],
  );
  const value = useMemo(() => ({ openRule }), [openRule]);
  return (
    <RuleDialogContext.Provider value={value}>
      {children}
      <Dialog open={state.open} onOpenChange={(open) => setState((s) => ({ ...s, open }))}>
        {state.open && (
          <RuleEditor
            key={state.key}
            start={state.start}
            onDone={() => setState((s) => ({ ...s, open: false }))}
          />
        )}
      </Dialog>
    </RuleDialogContext.Provider>
  );
}

/**
 * A rule that would have categorized `tx` as `categoryId`. Imported transactions match on a
 * keyword from the bank's description (it stays the same across statements); others on payee.
 */
export function ruleFromTransaction(tx: Transaction, categoryId: string | null): RuleInput {
  const keyword = descriptionKeyword(tx.rawDescription);
  const condition: RuleCondition =
    keyword.length >= 3 || !tx.payeeName
      ? { field: 'description', op: 'contains', value: keyword }
      : { field: 'payee', op: 'equals', value: tx.payeeName };
  return {
    name: '',
    conditions: [condition],
    actions: [{ type: 'setCategory', categoryId }],
  };
}

/** Whether `ruleFromTransaction` can build a sensible rule for this transaction. */
export function canMakeRule(tx: Transaction) {
  return !tx.transfer && (!!tx.payeeName || tx.rawDescription.trim().length >= 3);
}

// ---------------------------------------------------------------------------------------------
// Describing rules in words
// ---------------------------------------------------------------------------------------------

export function useRuleText() {
  const f = useFormat();
  const accounts = useAccountMap();
  const categories = useCategoryMap();
  const { data: tags = [] } = useTags();
  return useMemo(() => {
    const catName = (id: string | null) =>
      id === null ? 'Uncategorized' : (categories.get(id)?.name ?? 'a deleted category');
    const condition = (c: RuleCondition) =>
      describeCondition(c, {
        account: (id) => accounts.get(id)?.name ?? 'a deleted account',
        amount: (minor) => f.money(minor, f.base),
      });
    const action = (a: RuleAction): string => {
      switch (a.type) {
        case 'setCategory':
          return `Category: ${catName(a.categoryId)}`;
        case 'setPayee':
          return `Payee: ${a.payee}`;
        case 'addTags':
          return `Tags: ${a.tagIds.map((id) => `#${tags.find((t) => t.id === id)?.name ?? '?'}`).join(' ')}`;
        case 'setNotes':
          return a.notes ? `Notes: “${a.notes}”` : 'Clear notes';
        case 'markReviewed':
          return 'Mark reviewed';
        case 'splitByPercent':
          return `Split: ${a.lines.map((l) => `${l.percent}% ${catName(l.categoryId)}`).join(', ')}`;
      }
    };
    return { condition, action };
  }, [f, accounts, categories, tags]);
}

// ---------------------------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------------------------

type FieldName = RuleCondition['field'];
type ActionType = RuleAction['type'];

interface ConditionDraft {
  key: string;
  field: FieldName;
  op: string;
  text: string;
  amount: string;
  amount2: string;
  accountId: string;
  direction: 'out' | 'in';
}

interface ActionDraft {
  key: string;
  type: ActionType;
  categoryId: string | null;
  payee: string;
  tagIds: string[];
  notes: string;
  lines: Array<{ key: string; categoryId: string | null; percent: string }>;
}

const FIELDS: Array<{ value: FieldName; label: string }> = [
  { value: 'payee', label: 'Payee' },
  { value: 'description', label: 'Bank description' },
  { value: 'notes', label: 'Notes' },
  { value: 'amount', label: 'Amount' },
  { value: 'account', label: 'Account' },
  { value: 'direction', label: 'Money' },
];

const TEXT_OPS = [
  { value: 'contains', label: 'contains' },
  { value: 'equals', label: 'is' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'matches', label: 'matches pattern' },
];
const AMOUNT_OPS = [
  { value: 'equals', label: 'is exactly' },
  { value: 'gt', label: 'is more than' },
  { value: 'gte', label: 'is at least' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is at most' },
  { value: 'between', label: 'is between' },
];
const ACCOUNT_OPS = [
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
];

const opsFor = (field: FieldName) =>
  field === 'amount'
    ? AMOUNT_OPS
    : field === 'account'
      ? ACCOUNT_OPS
      : field === 'direction'
        ? [{ value: 'is', label: 'is' }]
        : TEXT_OPS;

const ACTIONS: Array<{ value: ActionType; label: string }> = [
  { value: 'setCategory', label: 'Set category' },
  { value: 'setPayee', label: 'Rename payee' },
  { value: 'addTags', label: 'Add tags' },
  { value: 'setNotes', label: 'Set notes' },
  { value: 'markReviewed', label: 'Mark as reviewed' },
  { value: 'splitByPercent', label: 'Split by percentage' },
];

function newCondition(field: FieldName = 'payee'): ConditionDraft {
  return {
    key: uuidv7(),
    field,
    op: opsFor(field)[0]!.value,
    text: '',
    amount: '',
    amount2: '',
    accountId: '',
    direction: 'out',
  };
}

function newAction(type: ActionType = 'setCategory'): ActionDraft {
  return {
    key: uuidv7(),
    type,
    categoryId: null,
    payee: '',
    tagIds: [],
    notes: '',
    lines: [
      { key: uuidv7(), categoryId: null, percent: '50' },
      { key: uuidv7(), categoryId: null, percent: '50' },
    ],
  };
}

function conditionDraft(c: RuleCondition, digits: number): ConditionDraft {
  const d = { ...newCondition(c.field), op: c.op };
  switch (c.field) {
    case 'amount':
      return {
        ...d,
        amount: toDecimalString(c.value, digits),
        amount2: c.value2 !== undefined ? toDecimalString(c.value2, digits) : '',
      };
    case 'account':
      return { ...d, accountId: c.value };
    case 'direction':
      return { ...d, direction: c.value };
    default:
      return { ...d, text: c.value };
  }
}

function actionDraft(a: RuleAction): ActionDraft {
  const d = newAction(a.type);
  switch (a.type) {
    case 'setCategory':
      return { ...d, categoryId: a.categoryId };
    case 'setPayee':
      return { ...d, payee: a.payee };
    case 'addTags':
      return { ...d, tagIds: a.tagIds };
    case 'setNotes':
      return { ...d, notes: a.notes };
    case 'splitByPercent':
      return {
        ...d,
        lines: a.lines.map((l) => ({
          key: uuidv7(),
          categoryId: l.categoryId,
          percent: String(l.percent),
        })),
      };
    default:
      return d;
  }
}

type Built = { rule: RuleInput; error: null } | { rule: null; error: string };

function build(
  name: string,
  match: 'all' | 'any',
  stopProcessing: boolean,
  enabled: boolean,
  conditions: ConditionDraft[],
  actions: ActionDraft[],
  digits: number,
  autoName: (c: RuleCondition) => string,
): Built {
  const conds: RuleCondition[] = [];
  for (const c of conditions) {
    if (c.field === 'amount') {
      const value = c.amount.trim() ? parseAmountInput(c.amount, digits) : null;
      const value2 = c.amount2.trim() ? parseAmountInput(c.amount2, digits) : null;
      if (value === null) return { rule: null, error: 'Enter an amount in each amount condition' };
      if (c.op === 'between' && value2 === null)
        return { rule: null, error: 'Enter both amounts for “is between”' };
      conds.push({
        field: 'amount',
        op: c.op as 'equals',
        value: Math.abs(value),
        ...(c.op === 'between' && value2 !== null ? { value2: Math.abs(value2) } : {}),
      });
    } else if (c.field === 'account') {
      if (!c.accountId) return { rule: null, error: 'Choose the account' };
      conds.push({ field: 'account', op: c.op as 'is', value: c.accountId });
    } else if (c.field === 'direction') {
      conds.push({ field: 'direction', op: 'is', value: c.direction });
    } else {
      if (!c.text.trim()) return { rule: null, error: 'Fill in the text to look for' };
      conds.push({ field: c.field, op: c.op as 'contains', value: c.text.trim() });
    }
  }
  const acts: RuleAction[] = [];
  for (const a of actions) {
    switch (a.type) {
      case 'setCategory':
        acts.push({ type: 'setCategory', categoryId: a.categoryId });
        break;
      case 'setPayee':
        if (!a.payee.trim()) return { rule: null, error: 'Enter the new payee name' };
        acts.push({ type: 'setPayee', payee: a.payee.trim() });
        break;
      case 'addTags':
        if (a.tagIds.length === 0) return { rule: null, error: 'Choose at least one tag' };
        acts.push({ type: 'addTags', tagIds: a.tagIds });
        break;
      case 'setNotes':
        acts.push({ type: 'setNotes', notes: a.notes.trim() });
        break;
      case 'markReviewed':
        acts.push({ type: 'markReviewed' });
        break;
      case 'splitByPercent': {
        const lines = a.lines.map((l) => ({
          categoryId: l.categoryId,
          percent: Number(l.percent.replace('%', '').trim()),
        }));
        if (lines.some((l) => !Number.isFinite(l.percent) || l.percent <= 0))
          return { rule: null, error: 'Every split line needs a percentage above 0' };
        const total = lines.reduce((s, l) => s + l.percent, 0);
        if (Math.abs(total - 100) > 1e-9)
          return { rule: null, error: `Split percentages must add up to 100 (now ${total})` };
        acts.push({ type: 'splitByPercent', lines });
        break;
      }
    }
  }
  if (conds.length === 0) return { rule: null, error: 'Add at least one condition' };
  if (acts.length === 0) return { rule: null, error: 'Add at least one action' };
  const body = {
    name: (name.trim() || autoName(conds[0]!)).slice(0, 80),
    enabled,
    match,
    stopProcessing,
    conditions: conds,
    actions: acts,
  };
  const parsed = RuleBodySchema.safeParse(body);
  if (!parsed.success) return { rule: null, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  return { rule: body, error: null };
}

function RuleEditor({ start, onDone }: { start?: RuleStart; onDone: () => void }) {
  const f = useFormat();
  const digits = f.digits(f.base);
  const text = useRuleText();
  const create = useCreateRule();
  const update = useUpdateRule();
  const apply = useApplyRule();
  const editingId = start && 'id' in start ? start.id : undefined;

  const [name, setName] = useState(start?.name ?? '');
  const [enabled, setEnabled] = useState(start?.enabled ?? true);
  const [match, setMatch] = useState<'all' | 'any'>(start?.match ?? 'all');
  const [stopProcessing, setStopProcessing] = useState(start?.stopProcessing ?? false);
  const [conditions, setConditions] = useState<ConditionDraft[]>(() =>
    start?.conditions?.length
      ? start.conditions.map((c) => conditionDraft(c, digits))
      : [newCondition()],
  );
  const [actions, setActions] = useState<ActionDraft[]>(() =>
    start?.actions?.length ? start.actions.map(actionDraft) : [newAction()],
  );
  const [applyExisting, setApplyExisting] = useState(!editingId);
  const [onlyUncategorized, setOnlyUncategorized] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const built = useMemo(
    () => build(name, match, stopProcessing, enabled, conditions, actions, digits, text.condition),
    [name, match, stopProcessing, enabled, conditions, actions, digits, text],
  );
  const debounced = useDebouncedValue(built.rule, 400);
  const preview = useRulePreview(debounced, onlyUncategorized);

  const setCondition = (key: string, patch: Partial<ConditionDraft>) =>
    setConditions((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const setAction = (key: string, patch: Partial<ActionDraft>) =>
    setActions((as) => as.map((a) => (a.key === key ? { ...a, ...patch } : a)));

  const saving = create.isPending || update.isPending || apply.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!built.rule) {
      setError(built.error);
      return;
    }
    setError(null);
    try {
      const saved = editingId
        ? await update.mutateAsync({ id: editingId, ...built.rule })
        : await create.mutateAsync(built.rule);
      if (applyExisting && (preview.data?.changeCount ?? 1) > 0) {
        const { updated } = await apply.mutateAsync({ id: saved.id, onlyUncategorized });
        toast.success(
          `Rule saved and applied to ${updated} transaction${updated === 1 ? '' : 's'}`,
        );
      } else {
        toast.success(editingId ? 'Rule updated' : 'Rule created');
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    // No autofocus: on phones it would open the keyboard over the form.
    <DialogContent className="sm:max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{editingId ? 'Edit rule' : 'New rule'}</DialogTitle>
          <DialogDescription>
            Rules run on imported transactions and fill in blanks on ones you add.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-5">
          <Field label="Name" htmlFor="rule-name">
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={built.rule?.name ?? 'e.g. Pathao rides'}
              maxLength={80}
            />
          </Field>

          <section className="grid grid-cols-1 gap-2.5" aria-labelledby="rule-when">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="rule-when" className="text-sm font-semibold">
                When
              </h3>
              {conditions.length > 1 && (
                <Segmented
                  size="sm"
                  label="How conditions combine"
                  value={match}
                  onChange={setMatch}
                  options={[
                    { value: 'all', label: 'all match' },
                    { value: 'any', label: 'any matches' },
                  ]}
                />
              )}
            </div>
            {conditions.map((c, i) => (
              <ConditionRow
                key={c.key}
                index={i}
                draft={c}
                onChange={(patch) => setCondition(c.key, patch)}
                onRemove={
                  conditions.length > 1
                    ? () => setConditions((cs) => cs.filter((x) => x.key !== c.key))
                    : undefined
                }
              />
            ))}
            {conditions.length < 10 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-self-start"
                onClick={() => setConditions((cs) => [...cs, newCondition('description')])}
              >
                <Plus /> Add condition
              </Button>
            )}
          </section>

          <section className="grid grid-cols-1 gap-2.5" aria-labelledby="rule-then">
            <h3 id="rule-then" className="text-sm font-semibold">
              Then
            </h3>
            {actions.map((a, i) => (
              <ActionRow
                key={a.key}
                index={i}
                draft={a}
                onChange={(patch) => setAction(a.key, patch)}
                onRemove={
                  actions.length > 1
                    ? () => setActions((as) => as.filter((x) => x.key !== a.key))
                    : undefined
                }
              />
            ))}
            {actions.length < ACTIONS.length && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-self-start"
                onClick={() => {
                  const used = new Set(actions.map((a) => a.type));
                  const next = ACTIONS.find(
                    (o) =>
                      !used.has(o.value) &&
                      !(o.value === 'splitByPercent' && used.has('setCategory')) &&
                      !(o.value === 'setCategory' && used.has('splitByPercent')),
                  );
                  setActions((as) => [...as, newAction(next?.value ?? 'addTags')]);
                }}
              >
                <Plus /> Add action
              </Button>
            )}
          </section>

          <div className="grid grid-cols-1 gap-3 rounded-xl border p-3.5">
            <label className="flex items-center gap-2.5 text-sm">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              Enabled
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox
                checked={stopProcessing}
                onCheckedChange={(v) => setStopProcessing(v === true)}
                className="mt-0.5"
              />
              <span>
                Stop here
                <span className="block text-xs text-muted-foreground">
                  Rules further down the list don’t run on transactions this one matches.
                </span>
              </span>
            </label>
          </div>

          <RulePreviewPanel
            preview={preview}
            valid={built.rule !== null}
            applyExisting={applyExisting}
            onApplyExisting={setApplyExisting}
            onlyUncategorized={onlyUncategorized}
            onOnlyUncategorized={setOnlyUncategorized}
          />

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
            {saving && <Loader2 className="animate-spin" />}
            {editingId ? 'Save rule' : 'Create rule'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return <span className="size-8 shrink-0" aria-hidden />;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      aria-label={label}
      onClick={onClick}
    >
      <X />
    </Button>
  );
}

function ConditionRow({
  index,
  draft,
  onChange,
  onRemove,
}: {
  index: number;
  draft: ConditionDraft;
  onChange: (patch: Partial<ConditionDraft>) => void;
  onRemove?: () => void;
}) {
  const f = useFormat();
  const n = index + 1;
  return (
    <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-2">
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[11rem_9.5rem_1fr]">
        <NativeSelect
          aria-label={`Condition ${n} field`}
          value={draft.field}
          onChange={(e) => {
            const field = e.target.value as FieldName;
            onChange({ field, op: opsFor(field)[0]!.value });
          }}
        >
          {FIELDS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={`Condition ${n} test`}
          value={draft.op}
          onChange={(e) => onChange({ op: e.target.value })}
          disabled={draft.field === 'direction'}
        >
          {opsFor(draft.field).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
        {draft.field === 'amount' ? (
          <div className={cn('grid gap-2', draft.op === 'between' && 'grid-cols-2')}>
            <AmountInput
              aria-label={`Condition ${n} amount`}
              currency={f.base}
              value={draft.amount}
              onChange={(amount) => onChange({ amount })}
            />
            {draft.op === 'between' && (
              <AmountInput
                aria-label={`Condition ${n} upper amount`}
                currency={f.base}
                value={draft.amount2}
                onChange={(amount2) => onChange({ amount2 })}
              />
            )}
          </div>
        ) : draft.field === 'account' ? (
          <AccountSelect
            aria-label={`Condition ${n} account`}
            value={draft.accountId}
            onChange={(accountId) => onChange({ accountId })}
            includeArchived
          />
        ) : draft.field === 'direction' ? (
          <NativeSelect
            aria-label={`Condition ${n} direction`}
            value={draft.direction}
            onChange={(e) => onChange({ direction: e.target.value as 'out' | 'in' })}
          >
            <option value="out">going out (spending)</option>
            <option value="in">coming in (income)</option>
          </NativeSelect>
        ) : (
          <Input
            aria-label={`Condition ${n} text`}
            value={draft.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder={draft.op === 'matches' ? 'e.g. ^(ntc|ncell)' : 'e.g. pathao'}
            maxLength={200}
          />
        )}
      </div>
      <RemoveButton label={`Remove condition ${n}`} onClick={onRemove} />
    </div>
  );
}

function ActionRow({
  index,
  draft,
  onChange,
  onRemove,
}: {
  index: number;
  draft: ActionDraft;
  onChange: (patch: Partial<ActionDraft>) => void;
  onRemove?: () => void;
}) {
  const n = index + 1;
  const total = draft.lines.reduce((s, l) => s + (Number(l.percent) || 0), 0);
  return (
    <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-2">
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr]">
        <NativeSelect
          aria-label={`Action ${n}`}
          value={draft.type}
          onChange={(e) => onChange({ type: e.target.value as ActionType })}
        >
          {ACTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
        {draft.type === 'setCategory' && (
          <CategoryPicker
            value={draft.categoryId}
            onChange={(categoryId) => onChange({ categoryId })}
          />
        )}
        {draft.type === 'setPayee' && (
          <Input
            aria-label={`Action ${n} payee name`}
            value={draft.payee}
            onChange={(e) => onChange({ payee: e.target.value })}
            placeholder="e.g. Pathao"
            maxLength={120}
          />
        )}
        {draft.type === 'addTags' && (
          <TagPicker value={draft.tagIds} onChange={(tagIds) => onChange({ tagIds })} />
        )}
        {draft.type === 'setNotes' && (
          <Input
            aria-label={`Action ${n} notes`}
            value={draft.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            placeholder="Leave empty to clear notes"
            maxLength={1000}
          />
        )}
        {draft.type === 'markReviewed' && (
          <p className="self-center text-xs text-muted-foreground">
            Skips the review inbox for matching imports.
          </p>
        )}
        {draft.type === 'splitByPercent' && (
          <div className="grid grid-cols-1 gap-2 sm:col-span-2">
            {draft.lines.map((line, i) => (
              <div key={line.key} className="flex items-center gap-2">
                <CategoryPicker
                  className="min-w-0 flex-1"
                  value={line.categoryId}
                  onChange={(categoryId) =>
                    onChange({
                      lines: draft.lines.map((l) =>
                        l.key === line.key ? { ...l, categoryId } : l,
                      ),
                    })
                  }
                />
                <div className="relative w-24 shrink-0">
                  <Input
                    aria-label={`Split line ${i + 1} percent`}
                    inputMode="decimal"
                    value={line.percent}
                    onChange={(e) =>
                      onChange({
                        lines: draft.lines.map((l) =>
                          l.key === line.key ? { ...l, percent: e.target.value } : l,
                        ),
                      })
                    }
                    className="pr-7 text-right tabular"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
                    %
                  </span>
                </div>
                <RemoveButton
                  label={`Remove split line ${i + 1}`}
                  onClick={
                    draft.lines.length > 2
                      ? () => onChange({ lines: draft.lines.filter((l) => l.key !== line.key) })
                      : undefined
                  }
                />
              </div>
            ))}
            <div className="flex items-center justify-between text-xs">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={draft.lines.length >= 10}
                onClick={() =>
                  onChange({
                    lines: [
                      ...draft.lines,
                      {
                        key: uuidv7(),
                        categoryId: null,
                        percent: String(Math.max(0, 100 - total)),
                      },
                    ],
                  })
                }
              >
                <Plus /> Add line
              </Button>
              <span
                className={cn(
                  'pr-10 tabular',
                  Math.abs(total - 100) > 1e-9 ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                Total {total}%
              </span>
            </div>
          </div>
        )}
      </div>
      <RemoveButton label={`Remove action ${n}`} onClick={onRemove} />
    </div>
  );
}

function RulePreviewPanel({
  preview,
  valid,
  applyExisting,
  onApplyExisting,
  onlyUncategorized,
  onOnlyUncategorized,
}: {
  preview: ReturnType<typeof useRulePreview>;
  valid: boolean;
  applyExisting: boolean;
  onApplyExisting: (v: boolean) => void;
  onlyUncategorized: boolean;
  onOnlyUncategorized: (v: boolean) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const data = preview.data;
  const items = data?.items ?? [];
  return (
    <section className="grid grid-cols-1 gap-2.5" aria-labelledby="rule-preview" aria-live="polite">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <h3 id="rule-preview" className="text-sm font-semibold">
          {!valid
            ? 'Finish the rule to see what it matches'
            : !data
              ? 'Checking your transactions…'
              : data.count === 0
                ? 'No existing transactions match'
                : `Matches ${data.count} existing transaction${data.count === 1 ? '' : 's'}`}
        </h3>
        {preview.isFetching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
      <Label className="flex items-center gap-2.5 font-normal">
        <Checkbox
          checked={onlyUncategorized}
          onCheckedChange={(v) => onOnlyUncategorized(v === true)}
        />
        Only transactions without a category
      </Label>
      {valid && data && data.count > 0 && (
        <>
          <div className="overflow-hidden rounded-xl border">
            <div className="divide-y">
              {(showAll ? items : items.slice(0, 3)).map((tx) => (
                <TransactionRow key={tx.id} tx={tx} onOpen={() => undefined} showDate />
              ))}
            </div>
            {items.length > 3 && (
              <button
                type="button"
                className="w-full border-t py-2 text-xs font-medium text-primary hover:bg-muted/60"
                onClick={() => setShowAll((s) => !s)}
              >
                {showAll
                  ? 'Show fewer'
                  : `Show ${items.length - 3} more${data.count > items.length ? ` (of ${data.count - 3})` : ''}`}
              </button>
            )}
          </div>
          <Label className="flex items-center gap-2.5 font-normal">
            <Checkbox
              checked={applyExisting}
              onCheckedChange={(v) => onApplyExisting(v === true)}
            />
            {data.changeCount > 0
              ? `Also update ${data.changeCount} matching transaction${data.changeCount === 1 ? '' : 's'} now`
              : 'Matching transactions already look like this'}
          </Label>
        </>
      )}
    </section>
  );
}
