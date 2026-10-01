import {
  ACCOUNT_TYPE_LABELS,
  type Account,
  type CategoryKind,
  COLOR_SWATCHES,
  type Currency,
  filterAmountInput,
  listCurrencies,
  parseAmountInput,
} from '@et/shared';
import { Command } from 'cmdk';
import { Check, ChevronDown, Plus, Search, TagIcon } from 'lucide-react';
import { type ComponentProps, type KeyboardEvent, useMemo, useState } from 'react';
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
import { FilteredInput, Input } from './ui/input';
import {
  Checkbox,
  commandGroups,
  menuItem,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from './ui/menu';
import { Select, SelectItem } from './ui/select';

const commandList = cn('max-h-72 overflow-y-auto overscroll-contain p-1', commandGroups);
const commandItem = cn(menuItem, 'gap-2.5');

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

/** The category groups of a cmdk list, with a check on the chosen one. */
function CategoryGroups({
  value,
  kind,
  onPick,
}: {
  value: string | null | undefined;
  kind?: CategoryKind;
  onPick: (id: string) => void;
}) {
  const { data: groups = [] } = useCategories();
  const visible = groups
    .filter((g) => !kind || g.kind === kind || g.categories.some((c) => c.id === value))
    .map((g) => ({ ...g, categories: g.categories.filter((c) => !c.archived || c.id === value) }))
    .filter((g) => g.categories.length > 0);
  return visible.map((g) => (
    <Command.Group key={g.id} heading={g.name}>
      {g.categories.map((c) => (
        <Command.Item
          key={c.id}
          value={`${c.name} ${g.name} ${c.id}`}
          onSelect={() => onPick(c.id)}
          className={cn(commandItem, 'py-1.5')}
        >
          <CategoryIcon icon={c.icon} color={c.color} size="sm" />
          <span className="truncate">{c.name}</span>
          {c.id === value && <Check className="ml-auto text-primary" />}
        </Command.Item>
      ))}
    </Command.Group>
  ));
}

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
  const map = useCategoryMap();
  const selected = value ? map.get(value) : undefined;
  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className={cn('h-10 w-full justify-start gap-2 px-2.5 font-normal shadow-xs', className)}
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
          <Command.List className={commandList}>
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              No category found
            </Command.Empty>
            {allowNone && (
              <Command.Item
                value="uncategorized none"
                onSelect={() => pick(null)}
                className={cn(commandItem, 'py-1.5')}
              >
                <CategoryIcon size="sm" />
                Uncategorized
                {value === null && <Check className="ml-auto text-primary" />}
              </Command.Item>
            )}
            <CategoryGroups value={value} kind={kind} onPick={pick} />
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Filters a list by category: any, uncategorized ('none'), or one category. */
export function CategoryFilter({
  value,
  onChange,
  className,
}: {
  value?: string;
  onChange: (id: string | undefined) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const map = useCategoryMap();
  const label =
    value === 'none'
      ? 'Uncategorized'
      : value
        ? (map.get(value)?.name ?? 'Category')
        : 'All categories';
  const pick = (next: string | undefined) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-label="Category"
          className={cn(
            'justify-start px-3 font-normal shadow-xs',
            value && 'border-primary',
            className,
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="-mr-1 ml-auto text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandSearch placeholder="Search categories" />
          <Command.List className={commandList}>
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              No category found
            </Command.Empty>
            <Command.Item
              value="all categories any"
              onSelect={() => pick(undefined)}
              className={commandItem}
            >
              All categories
              {!value && <Check className="ml-auto text-primary" />}
            </Command.Item>
            <Command.Item
              value="uncategorized none"
              onSelect={() => pick('none')}
              className={cn(commandItem, 'py-1.5')}
            >
              <CategoryIcon size="sm" />
              Uncategorized
              {value === 'none' && <Check className="ml-auto text-primary" />}
            </Command.Item>
            <CategoryGroups value={value} onPick={pick} />
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
}: Omit<ComponentProps<typeof Select>, 'onValueChange' | 'value' | 'children'> & {
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
    <Select value={value} onValueChange={onChange} placeholder="Choose account" {...props}>
      {emptyLabel !== undefined && <SelectItem value="">{emptyLabel}</SelectItem>}
      {list.map((a) => (
        <SelectItem key={a.id} value={a.id}>
          {a.name}
          {a.currency !== f.base ? ` (${a.currency})` : ''}
        </SelectItem>
      ))}
    </Select>
  );
}

export function accountLabel(account: Account | undefined) {
  if (!account) return 'Unknown account';
  return `${account.name} · ${ACCOUNT_TYPE_LABELS[account.type]}`;
}

const currencies = listCurrencies();

/** Searchable: there are over 150 currencies. The most used in Nepal come first. */
export function CurrencySelect({
  value,
  onChange,
  id,
  disabled,
  className,
}: {
  value: string;
  onChange: (code: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = currencies.find((c) => c.code === value);
  const row = (c: Currency) => (
    <Command.Item
      key={c.code}
      value={`${c.code} ${c.name}`}
      onSelect={() => {
        onChange(c.code);
        setOpen(false);
      }}
      className={commandItem}
    >
      <span className="w-9 shrink-0 font-medium">{c.code}</span>
      <span className="truncate">{c.name}</span>
      {c.code === value && <Check className="ml-auto text-primary" />}
    </Command.Item>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          role="combobox"
          variant="outline"
          disabled={disabled}
          className={cn('h-10 w-full justify-start px-3 font-normal shadow-xs', className)}
        >
          <span className="truncate">
            {selected ? `${selected.code} — ${selected.name}` : value}
          </span>
          <ChevronDown className="-mr-1 ml-auto text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandSearch placeholder="Search currencies" />
          <Command.List className={commandList}>
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              No currency found
            </Command.Empty>
            <Command.Group heading="Common in Nepal">
              {currencies.slice(0, 15).map(row)}
            </Command.Group>
            <Command.Group heading="All currencies">{currencies.slice(15).map(row)}</Command.Group>
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Payee ---------------------------------------------------------------------------------------

/**
 * Free-text payee with suggestions from past payees as you type (or press ↓).
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
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = `${id ?? 'payee'}-suggestions`;
  const query = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return payees.slice(0, 8);
    const starts = payees.filter((p) => p.name.toLowerCase().startsWith(query));
    const within = payees.filter(
      (p) => !p.name.toLowerCase().startsWith(query) && p.name.toLowerCase().includes(query),
    );
    // Nothing to suggest once the text is exactly a known payee.
    if (starts.length === 1 && starts[0]!.name.toLowerCase() === query && within.length === 0) {
      return [];
    }
    return [...starts, ...within].slice(0, 8);
  }, [payees, query]);
  const shown = open && matches.length > 0;

  function choose(payee: (typeof payees)[number]) {
    onChange(payee.name);
    onMatch?.(payee);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (matches.length === 0) return;
      e.preventDefault();
      if (!shown) {
        setOpen(true);
        setActive(e.key === 'ArrowDown' ? 0 : matches.length - 1);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + matches.length) % matches.length);
    } else if (e.key === 'Enter' && shown && matches[active]) {
      // Otherwise Enter submits the form as usual.
      e.preventDefault();
      choose(matches[active]!);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <Popover open={shown} onOpenChange={(o) => !o && setOpen(false)}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          value={value}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={shown ? listId : undefined}
          aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Who did you pay?"
          onChange={(e) => {
            const next = e.target.value;
            onChange(next);
            setOpen(next.trim() !== '');
            setActive(-1);
            const match = payees.find((p) => p.name.toLowerCase() === next.trim().toLowerCase());
            if (match) onMatch?.(match);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          {...props}
        />
      </PopoverAnchor>
      <PopoverContent
        id={listId}
        role="listbox"
        aria-label="Past payees"
        className="w-(--radix-popover-trigger-width) min-w-48 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {matches.map((p, i) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the input handles the keyboard
          <div
            key={p.id}
            id={`${listId}-${i}`}
            role="option"
            tabIndex={-1}
            aria-selected={i === active}
            data-selected={i === active}
            // Keep focus (and the keyboard on phones) in the input.
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => setActive(i)}
            onClick={() => choose(p)}
            className={menuItem}
          >
            <span className="truncate">{p.name}</span>
          </div>
        ))}
      </PopoverContent>
    </Popover>
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
          <Command.List className={commandList}>
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
  negative,
  ...props
}: Omit<ComponentProps<'input'>, 'onChange' | 'value'> & {
  value: string;
  onChange: (value: string) => void;
  currency: string;
  large?: boolean;
  /** Allows a minus sign at the start (balances); otherwise amounts are positive. */
  negative?: boolean;
}) {
  const f = useFormat();
  const digits = f.digits(currency);
  const parsed = useMemo(
    () => (value.trim() ? parseAmountInput(value, digits) : null),
    [value, digits],
  );
  const isExpression = /[+\-*/×÷]/.test(value.replace(/^-/, ''));
  return (
    <div className={cn('relative', className)}>
      <span
        className={cn(
          'pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground',
          large ? 'text-lg font-medium' : 'text-sm',
        )}
      >
        {currency === 'NPR' ? (f.locale === 'ne' ? 'रु.' : 'Rs.') : currency}
      </span>
      <FilteredInput
        inputMode="decimal"
        autoComplete="off"
        value={value}
        filter={(text) => filterAmountInput(text, { negative })}
        onValueChange={onChange}
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
