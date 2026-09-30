import {
  ACCOUNT_TYPE_LABELS,
  type Account,
  type CategoryKind,
  COLOR_SWATCHES,
  listCurrencies,
  parseAmountInput,
} from '@et/shared';
import { Command } from 'cmdk';
import { Check, ChevronDown, Plus, Search, TagIcon } from 'lucide-react';
import { type ComponentProps, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useAccounts,
  useCategories,
  useCategoryMap,
  useCreateTag,
  usePayees,
  useTags,
} from '@/lib/queries';
import { cn } from '@/lib/utils';
import { CategoryIcon } from './icons';
import { Button } from './ui/button';
import { Input, NativeSelect } from './ui/input';
import { Checkbox, Popover, PopoverContent, PopoverTrigger } from './ui/menu';

const commandList =
  'max-h-72 overflow-y-auto overscroll-contain [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground';
const commandItem =
  'flex cursor-default items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm outline-none select-none data-[selected=true]:bg-muted';

function CommandSearch({ placeholder }: { placeholder: string }) {
  return (
    <div className="flex items-center gap-2 border-b px-3">
      <Search className="size-4 text-muted-foreground" />
      <Command.Input
        placeholder={placeholder}
        className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

// Category ------------------------------------------------------------------------------------

export function CategoryPicker({
  value,
  onChange,
  kind,
  id,
  className,
  placeholder = 'Choose category',
  allowNone = true,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  kind?: CategoryKind;
  id?: string;
  className?: string;
  placeholder?: string;
  allowNone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data: groups = [] } = useCategories();
  const map = useCategoryMap();
  const selected = value ? map.get(value) : undefined;
  const visible = groups
    .filter((g) => !kind || g.kind === kind || g.categories.some((c) => c.id === value))
    .map((g) => ({ ...g, categories: g.categories.filter((c) => !c.archived || c.id === value) }))
    .filter((g) => g.categories.length > 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className={cn('h-10 w-full justify-start gap-2 px-2.5 font-normal', className)}
          aria-label={selected ? `Category: ${selected.name}` : placeholder}
        >
          {selected ? (
            <>
              <CategoryIcon icon={selected.icon} color={selected.color} size="sm" />
              <span className="truncate">{selected.name}</span>
            </>
          ) : (
            <span className="truncate pl-1 text-muted-foreground">{placeholder}</span>
          )}
          <ChevronDown className="ml-auto text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandSearch placeholder="Search categories" />
          <Command.List className={cn(commandList, 'p-1')}>
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              No category found
            </Command.Empty>
            {allowNone && (
              <Command.Item
                value="uncategorized none"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className={commandItem}
              >
                <CategoryIcon size="sm" />
                Uncategorized
                {value === null && <Check className="ml-auto size-4 text-primary" />}
              </Command.Item>
            )}
            {visible.map((g) => (
              <Command.Group key={g.id} heading={g.name}>
                {g.categories.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={`${c.name} ${g.name} ${c.id}`}
                    onSelect={() => {
                      onChange(c.id);
                      setOpen(false);
                    }}
                    className={commandItem}
                  >
                    <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                    <span className="truncate">{c.name}</span>
                    {c.id === value && <Check className="ml-auto size-4 text-primary" />}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Account & currency --------------------------------------------------------------------------

export function AccountSelect({
  value,
  onChange,
  includeArchived = false,
  exclude,
  emptyLabel,
  currency,
  ...props
}: Omit<ComponentProps<'select'>, 'onChange' | 'value' | 'children'> & {
  value: string;
  onChange: (id: string) => void;
  includeArchived?: boolean;
  exclude?: string;
  /** Only accounts in this currency. */
  currency?: string;
  /** Adds a first option with an empty value (e.g. "All accounts" in filters). */
  emptyLabel?: string;
}) {
  const { data: accounts = [] } = useAccounts();
  const f = useFormat();
  const list = accounts.filter(
    (a) =>
      (includeArchived || !a.archived || a.id === value) &&
      a.id !== exclude &&
      (!currency || a.currency === currency),
  );
  return (
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      {emptyLabel !== undefined ? (
        <option value="">{emptyLabel}</option>
      ) : (
        !value && <option value="">Choose account</option>
      )}
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {a.currency !== f.base ? ` (${a.currency})` : ''}
        </option>
      ))}
    </NativeSelect>
  );
}

export function accountLabel(account: Account | undefined) {
  if (!account) return 'Unknown account';
  return `${account.name} · ${ACCOUNT_TYPE_LABELS[account.type]}`;
}

const currencies = listCurrencies();

export function CurrencySelect({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<'select'>, 'onChange' | 'value'> & {
  value: string;
  onChange: (code: string) => void;
}) {
  return (
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      <optgroup label="Common in Nepal">
        {currencies.slice(0, 15).map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {c.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="All currencies">
        {currencies.slice(15).map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} — {c.name}
          </option>
        ))}
      </optgroup>
    </NativeSelect>
  );
}

// Payee ---------------------------------------------------------------------------------------

/**
 * Free-text payee with suggestions from past payees (native datalist: works well on phones).
 * `onMatch` fires when the text matches a known payee, so the form can suggest its category.
 */
export function PayeeInput({
  value,
  onChange,
  onMatch,
  id,
  ...props
}: Omit<ComponentProps<'input'>, 'onChange' | 'value'> & {
  value: string;
  onChange: (value: string) => void;
  onMatch?: (payee: { id: string; suggestedCategoryId: string | null }) => void;
}) {
  const { data: payees = [] } = usePayees();
  const listId = `${id ?? 'payee'}-options`;
  return (
    <>
      <Input
        id={id}
        value={value}
        list={listId}
        autoComplete="off"
        placeholder="Who did you pay?"
        onChange={(e) => {
          const next = e.target.value;
          onChange(next);
          const match = payees.find((p) => p.name.toLowerCase() === next.trim().toLowerCase());
          if (match) onMatch?.(match);
        }}
        {...props}
      />
      <datalist id={listId}>
        {payees.slice(0, 200).map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
    </>
  );
}

// Tags ----------------------------------------------------------------------------------------

export function TagPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data: tags = [] } = useTags();
  const create = useCreateTag();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = tags.filter((t) => value.includes(t.id));
  const trimmed = search.trim().replace(/^#/, '');
  const exists = tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-auto min-h-10 w-full flex-wrap justify-start gap-1.5 px-2.5 py-1.5 font-normal"
        >
          <TagIcon className="text-muted-foreground" />
          {selected.length === 0 && <span className="text-muted-foreground">Add tags</span>}
          {selected.map((t) => (
            <span
              key={t.id}
              className="rounded-md px-1.5 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: `color-mix(in oklch, ${t.color} 16%, transparent)`,
                color: t.color,
              }}
            >
              #{t.name}
            </span>
          ))}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <Command shouldFilter>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Find or create a tag"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List className={cn(commandList, 'p-1')}>
            {tags.map((t) => (
              <Command.Item
                key={t.id}
                value={t.name}
                onSelect={() => toggle(t.id)}
                className={commandItem}
              >
                <Checkbox checked={value.includes(t.id)} tabIndex={-1} aria-hidden />
                <span className="size-2 rounded-full" style={{ backgroundColor: t.color }} />
                {t.name}
              </Command.Item>
            ))}
            {trimmed && !exists && (
              <Command.Item
                value={`create ${trimmed}`}
                onSelect={() => {
                  const color = COLOR_SWATCHES[tags.length % COLOR_SWATCHES.length]!;
                  create.mutate(
                    { name: trimmed, color },
                    {
                      onSuccess: ({ id }) => {
                        onChange([...value, id]);
                        setSearch('');
                      },
                      onError: (e) => toast.error(errorMessage(e)),
                    },
                  );
                }}
                className={commandItem}
              >
                <Plus className="size-4" /> Create “{trimmed}”
              </Command.Item>
            )}
            {tags.length === 0 && !trimmed && (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                Type to create your first tag
              </p>
            )}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Amount --------------------------------------------------------------------------------------

/**
 * Amount field that accepts "1,500", Devanagari digits and sums like "120+45". Shows the result
 * when the input is an expression.
 */
export function AmountInput({
  value,
  onChange,
  currency,
  className,
  large,
  ...props
}: Omit<ComponentProps<'input'>, 'onChange' | 'value'> & {
  value: string;
  onChange: (value: string) => void;
  currency: string;
  large?: boolean;
}) {
  const f = useFormat();
  const digits = f.digits(currency);
  const parsed = useMemo(
    () => (value.trim() ? parseAmountInput(value, digits) : null),
    [value, digits],
  );
  const isExpression = /[+\-*/×x÷]/.test(value.replace(/^-/, ''));
  return (
    <div className={cn('relative', className)}>
      <span
        className={cn(
          'pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground',
          large ? 'text-lg font-medium' : 'text-sm',
        )}
      >
        {currency === 'NPR' ? 'Rs.' : currency}
      </span>
      <Input
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={value.trim() !== '' && parsed === null}
        className={cn(
          'tabular',
          currency === 'NPR' ? 'pl-11' : 'pl-14',
          large && 'h-14 text-2xl font-semibold',
        )}
        {...props}
      />
      {isExpression && parsed !== null && (
        <span className="absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground tabular">
          = {f.money(Math.abs(parsed), currency, { display: 'none' })}
        </span>
      )}
    </div>
  );
}

export function accountTypeLabel(type: Account['type']) {
  return ACCOUNT_TYPE_LABELS[type];
}
