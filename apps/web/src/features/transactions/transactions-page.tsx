import type { Transaction } from '@et/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  ArrowLeftRight,
  CheckCheck,
  CircleDashed,
  Download,
  Inbox,
  Loader2,
  Plus,
  Search,
  Tags,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DateRangePicker } from '@/components/date-range';
import { Money } from '@/components/money';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { AccountSelect, CategoryPicker } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Segmented,
} from '@/components/ui/menu';
import { errorMessage, toQueryString } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  type TransactionFilters,
  useBulkTransactions,
  useCategoryMap,
  useMemberNames,
  useTags,
  useTransactions,
} from '@/lib/queries';
import { useCanWrite, useWorkspace } from '@/lib/session';
import { cn } from '@/lib/utils';
import type { TransactionsSearch } from '@/router';
import { useTransactionDialog } from './transaction-dialog';
import { TransactionRow } from './transaction-row';

export function TransactionsPage() {
  const search = useSearch({ from: '/app/transactions' });
  const navigate = useNavigate({ from: '/transactions' });
  const f = useFormat();
  const ws = useWorkspace();
  const canWrite = useCanWrite();
  const { openNew, openEdit } = useTransactionDialog();
  const categories = useCategoryMap();
  const { data: tags = [] } = useTags();
  const people = useMemberNames();
  const bulk = useBulkTransactions();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(search.q ?? '');
  const searchRef = useRef<HTMLInputElement>(null);

  const setSearch = (patch: Partial<TransactionsSearch>) =>
    navigate({ search: (prev) => clean({ ...prev, ...patch }), replace: true });

  // Debounce the search box into the URL.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text should restart the timer
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search.q ?? '') !== q.trim()) setSearch({ q: q.trim() || undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filters: TransactionFilters = useMemo(
    () => clean({ ...search }) as TransactionFilters,
    [search],
  );
  const list = useTransactions(filters);
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const totals = list.data?.pages[0]?.totals;
  const trash = search.deleted === 'true';

  // Clear the selection whenever the filters change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter change only
  useEffect(() => setSelected(new Set()), [filters]);

  // Infinite scroll.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage)
        list.fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [list]);

  const groups = useMemo(() => {
    const out: Array<{ date: string; items: Transaction[]; net: number }> = [];
    for (const tx of items) {
      let g = out.at(-1);
      if (!g || g.date !== tx.date) {
        g = { date: tx.date, items: [], net: 0 };
        out.push(g);
      }
      g.items.push(tx);
      if (!tx.transfer && tx.currency === f.base) g.net += tx.amountMinor;
    }
    return out;
  }, [items, f.base]);

  const hasFilters = Object.keys(filters).some((k) => k !== 'deleted');
  const selectedIds = [...selected];

  async function runBulk(
    action: Parameters<typeof bulk.mutateAsync>[0],
    message: (n: number, skipped: number) => string,
  ) {
    try {
      const res = await bulk.mutateAsync(action);
      toast.success(message(res.updated, res.skipped));
      setSelected(new Set());
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const categoryFilter = search.categoryIds?.split(',')[0];

  return (
    <div className="pb-16">
      <PageHeader
        title={trash ? 'Trash' : 'Transactions'}
        description={trash ? 'Deleted transactions are kept for 30 days.' : undefined}
        actions={
          trash ? (
            <Button variant="outline" size="sm" onClick={() => setSearch({ deleted: undefined })}>
              Back to transactions
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`/api/v1/workspaces/${ws.id}/export/transactions.csv${toQueryString(filters as Record<string, string>)}`}
                >
                  <Download /> Export CSV
                </a>
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSearch({ deleted: 'true' })}>
                <Trash2 /> Trash
              </Button>
              {canWrite && (
                <Button size="sm" onClick={() => openNew()} className="hidden sm:inline-flex">
                  <Plus /> Add
                </Button>
              )}
            </>
          )
        }
      />

      {/* Filters */}
      <div className="mb-3 grid grid-cols-1 gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search payee, notes or bank description  ( / )"
            className="pl-9"
            aria-label="Search transactions"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker
            value={{ from: search.from, to: search.to }}
            onChange={(r) => setSearch({ from: r.from, to: r.to })}
          />
          <Segmented
            size="sm"
            label="Type"
            value={search.type ?? 'all'}
            onChange={(v) => setSearch({ type: v === 'all' ? undefined : v })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'expense', label: 'Out' },
              { value: 'income', label: 'In' },
              { value: 'transfer', label: 'Transfers' },
            ]}
          />
          <div className="w-44">
            <AccountSelect
              value={search.accountIds?.split(',')[0] ?? ''}
              onChange={(id) => setSearch({ accountIds: id || undefined })}
              includeArchived
              emptyLabel="All accounts"
              className="h-8 text-[13px]"
              aria-label="Account"
            />
          </div>
          <FilterCategory
            value={categoryFilter}
            onChange={(id) => setSearch({ categoryIds: id })}
          />
          {tags.length > 0 && (
            <NativeSelect
              value={search.tagIds ?? ''}
              onChange={(e) => setSearch({ tagIds: e.target.value || undefined })}
              className="h-8 w-36 text-[13px]"
              aria-label="Tag"
            >
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.name}
                </option>
              ))}
            </NativeSelect>
          )}
          {people && (
            <NativeSelect
              value={search.createdBy ?? ''}
              onChange={(e) => setSearch({ createdBy: e.target.value || undefined })}
              className="h-8 w-36 text-[13px]"
              aria-label="Added by"
            >
              <option value="">Anyone</option>
              {[...people].map(([id, name]) => (
                <option key={id} value={id}>
                  Added by {name}
                </option>
              ))}
            </NativeSelect>
          )}
          <Button
            variant={search.needsReview === 'true' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() =>
              setSearch({ needsReview: search.needsReview === 'true' ? undefined : 'true' })
            }
            aria-pressed={search.needsReview === 'true'}
          >
            <Inbox /> Needs review
          </Button>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ('');
                navigate({ search: trash ? { deleted: 'true' } : {}, replace: true });
              }}
            >
              <X /> Clear
            </Button>
          )}
        </div>
      </div>

      {totals && (
        <p className="mb-2 flex flex-wrap gap-x-3 px-1 text-xs text-muted-foreground tabular">
          <span>
            {totals.count} transaction{totals.count === 1 ? '' : 's'}
          </span>
          <span>
            In <Money minor={totals.inflowBaseMinor} className="text-positive" trimZero />
          </span>
          <span>
            Out <Money minor={-totals.outflowBaseMinor} trimZero />
          </span>
        </p>
      )}

      {list.error && <ErrorState error={list.error} retry={() => list.refetch()} />}

      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="grid grid-cols-1 gap-3 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={trash ? Trash2 : hasFilters ? Search : ArrowLeftRight}
            title={
              trash
                ? 'Trash is empty'
                : hasFilters
                  ? 'No transactions match'
                  : 'No transactions yet'
            }
            description={
              trash
                ? undefined
                : hasFilters
                  ? 'Try a wider date range or fewer filters.'
                  : 'Add one, or import a statement.'
            }
            action={
              !trash && !hasFilters && canWrite ? (
                <Button onClick={() => openNew()}>
                  <Plus /> Add transaction
                </Button>
              ) : undefined
            }
          />
        ) : (
          groups.map((g) => (
            <section key={g.date} aria-label={f.date(g.date, 'long')}>
              <header className="sticky top-14 z-10 flex items-center justify-between border-y bg-muted/80 px-4 py-1.5 text-xs backdrop-blur first:border-t-0 lg:top-0">
                <span className="font-medium">
                  {dayHeading(f, g.date)}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {f.altDate(g.date)}
                  </span>
                </span>
                {g.net !== 0 && (
                  <Money
                    minor={g.net}
                    signed={g.net > 0}
                    className="text-muted-foreground"
                    trimZero
                  />
                )}
              </header>
              <div className="divide-y">
                {g.items.map((tx) => (
                  <div key={tx.id} className="flex items-center">
                    <div className="min-w-0 flex-1">
                      <TransactionRow
                        tx={tx}
                        onOpen={(t) => (trash ? undefined : openEdit(t.id))}
                        selectable={canWrite}
                        selected={selected.has(tx.id)}
                        onSelect={(on) =>
                          setSelected((s) => {
                            const next = new Set(s);
                            if (on) next.add(tx.id);
                            else next.delete(tx.id);
                            return next;
                          })
                        }
                        showAccount={!search.accountIds}
                      />
                    </div>
                    {trash && canWrite && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mr-2"
                        onClick={() =>
                          runBulk({ action: 'restore', ids: [tx.id] }, () => 'Restored')
                        }
                      >
                        <Undo2 /> Restore
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
        <div ref={sentinel} className="h-1" />
        {list.isFetchingNextPage && (
          <div className="grid grid-cols-1 place-items-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </Card>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-40 mx-auto flex w-[min(40rem,calc(100%-1.5rem))] flex-wrap items-center gap-2 rounded-2xl border bg-popover p-2 pl-4 shadow-xl lg:bottom-6">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setSelected(
                selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)),
              )
            }
          >
            {selected.size === items.length ? 'None' : 'All'}
          </Button>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {trash ? (
              <Button
                size="sm"
                onClick={() =>
                  runBulk({ action: 'restore', ids: selectedIds }, (n) => `Restored ${n}`)
                }
              >
                <Undo2 /> Restore
              </Button>
            ) : (
              <>
                <BulkCategorize
                  onPick={(categoryId) =>
                    runBulk(
                      { action: 'setCategory', ids: selectedIds, categoryId },
                      (n, skipped) =>
                        skipped
                          ? `Categorized ${n}. ${skipped} skipped (transfers or split transactions).`
                          : `Categorized ${n} as ${categoryId ? (categories.get(categoryId)?.name ?? '') : 'uncategorized'}`,
                    )
                  }
                />
                {tags.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Tags /> Tag
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {tags.map((t) => (
                        <DropdownMenuItem
                          key={t.id}
                          onSelect={() =>
                            runBulk(
                              { action: 'addTags', ids: selectedIds, tagIds: [t.id] },
                              (n) => `Tagged ${n} with #${t.name}`,
                            )
                          }
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: t.color }}
                          />{' '}
                          #{t.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    runBulk(
                      { action: 'markReviewed', ids: selectedIds },
                      (n) => `Marked ${n} as reviewed`,
                    )
                  }
                >
                  <CheckCheck /> Reviewed
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <CircleDashed /> Status
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      onSelect={() =>
                        runBulk(
                          { action: 'setStatus', ids: selectedIds, status: 'cleared' },
                          (n) => `Marked ${n} as cleared`,
                        )
                      }
                    >
                      Cleared (on the statement)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        runBulk(
                          { action: 'setStatus', ids: selectedIds, status: 'pending' },
                          (n) => `Marked ${n} as pending`,
                        )
                      }
                    >
                      Pending
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Delete ${selected.size} transaction${selected.size === 1 ? '' : 's'}?`,
                      description:
                        'They move to the trash, where you can restore them for 30 days.',
                      confirmLabel: 'Delete',
                      destructive: true,
                    });
                    if (!ok) return;
                    const ids = selectedIds;
                    try {
                      const res = await bulk.mutateAsync({ action: 'delete', ids });
                      setSelected(new Set());
                      toast(`Deleted ${res.updated}`, {
                        action: {
                          label: 'Undo',
                          onClick: () => bulk.mutate({ action: 'restore', ids }),
                        },
                      });
                    } catch (err) {
                      toast.error(errorMessage(err));
                    }
                  }}
                >
                  <Trash2 /> Delete
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear selection"
              onClick={() => setSelected(new Set())}
            >
              <X />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Today · 14 Asoj", "Monday, 12 Asoj" or "3 Bhadra". */
function dayHeading(f: ReturnType<typeof useFormat>, date: string) {
  const relative = f.relativeDate(date);
  return relative === 'Today' || relative === 'Yesterday'
    ? `${relative} · ${f.date(date, 'short')}`
    : relative;
}

function clean<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''),
  ) as T;
}

function FilterCategory({
  value,
  onChange,
}: {
  value?: string;
  onChange: (id: string | undefined) => void;
}) {
  const categories = useCategoryMap();
  const [open, setOpen] = useState(false);
  const label =
    value === 'none'
      ? 'Uncategorized'
      : value
        ? (categories.get(value)?.name ?? 'Category')
        : 'All categories';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('font-normal', value && 'border-primary')}
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <CategoryPicker
          value={value && value !== 'none' ? value : null}
          onChange={(id) => {
            onChange(id ?? 'none');
            setOpen(false);
          }}
          placeholder="Pick a category"
        />
        <div className="mt-2 flex justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange('none');
              setOpen(false);
            }}
          >
            Uncategorized
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            Any category
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BulkCategorize({ onPick }: { onPick: (categoryId: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <div className="w-40">
      <CategoryPicker
        value={value}
        onChange={(id) => {
          setValue(null);
          onPick(id);
        }}
        placeholder="Categorize…"
        className="h-8 text-[13px]"
      />
    </div>
  );
}
