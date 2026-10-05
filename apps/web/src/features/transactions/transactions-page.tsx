import type { Transaction } from '@et/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  ArrowLeftRight,
  CheckCheck,
  CircleDashed,
  Download,
  Ellipsis,
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
import { AccountSelect, CategoryFilter, CategoryPicker } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Segmented,
} from '@/components/ui/menu';
import { Select, SelectItem } from '@/components/ui/select';
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
import { cn, useMediaQuery } from '@/lib/utils';
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
  // Touch screens hide the checkboxes until you choose "Select" or long-press a row; then a tap
  // selects instead of opening. With a mouse, the checkboxes are always there.
  const finePointer = useMediaQuery('(pointer: fine)');
  const [selecting, setSelecting] = useState(false);
  const selectMode = selecting || selected.size > 0;
  const clearSelection = () => {
    setSelected(new Set());
    setSelecting(false);
  };
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
  useEffect(() => {
    setSelected(new Set());
    setSelecting(false);
  }, [filters]);

  // Escape clears the selection, once any open menu or dialog has closed.
  useEffect(() => {
    if (!selectMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]')) return;
      setSelected(new Set());
      setSelecting(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMode]);

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
      clearSelection();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const categoryFilter = search.categoryIds?.split(',')[0];
  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));

  return (
    // While the selection bar is up, leave room for it below the last row.
    <div className={cn('pb-16', selectMode && 'pb-40 lg:pb-24')}>
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
            maxLength={100}
          />
        </div>
        {/* One row that scrolls sideways on phones; wraps on wider screens. */}
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&>*]:shrink-0">
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
              className="h-8 text-compact"
              aria-label="Account"
            />
          </div>
          <CategoryFilter
            value={categoryFilter}
            onChange={(id) => setSearch({ categoryIds: id })}
            className="w-44"
          />
          {tags.length > 0 && (
            <Select
              value={search.tagIds ?? ''}
              onValueChange={(v) => setSearch({ tagIds: v || undefined })}
              className="h-8 w-36 text-compact"
              aria-label="Tag"
            >
              <SelectItem value="">All tags</SelectItem>
              {tags.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  #{t.name}
                </SelectItem>
              ))}
            </Select>
          )}
          {people && (
            <Select
              value={search.createdBy ?? ''}
              onValueChange={(v) => setSearch({ createdBy: v || undefined })}
              className="h-8 w-36 text-compact"
              aria-label="Added by"
            >
              <SelectItem value="">Anyone</SelectItem>
              {[...people].map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  Added by {name}
                </SelectItem>
              ))}
            </Select>
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
        <div className="mb-2 flex items-center gap-3 px-1">
          <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular">
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
          {!finePointer && canWrite && items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="-my-1 ml-auto text-primary"
              onClick={() => (selectMode ? clearSelection() : setSelecting(true))}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </Button>
          )}
        </div>
      )}

      {list.error && <ErrorState error={list.error} retry={() => list.refetch()} />}

      <Card className="overflow-clip">
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
                        selectable={canWrite && (finePointer || selectMode)}
                        selectMode={!finePointer && selectMode}
                        onLongPress={
                          canWrite && !finePointer
                            ? () => {
                                setSelecting(true);
                                setSelected((s) => new Set(s).add(tx.id));
                              }
                            : undefined
                        }
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

      {/* Bulk actions: one row on wider screens; on phones the count on top and the actions
          below, with the rarer ones in "More". */}
      {selectMode && (
        <section
          aria-label="Selected transactions"
          className="fixed inset-x-0 bottom-20 z-40 mx-auto flex w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-1.5 gap-y-2 rounded-2xl border bg-popover p-2 shadow-xl md:w-max md:max-w-[calc(100%-1.5rem)] md:flex-nowrap lg:bottom-6 lg:left-60"
        >
          <div className="flex min-w-0 grow items-center gap-1 pl-2 md:grow-0">
            <span className="text-sm font-medium whitespace-nowrap" aria-live="polite">
              {selected.size === 0 ? 'Tap transactions to select' : `${selected.size} selected`}
            </span>
            {items.length > 1 && (
              <Button variant="ghost" size="sm" className="text-primary" onClick={toggleAll}>
                {allSelected
                  ? 'Select none'
                  : list.hasNextPage
                    ? `Select all ${items.length} shown`
                    : `Select all ${items.length}`}
              </Button>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear selection"
            title="Clear selection (Esc)"
            className="md:order-last"
            onClick={clearSelection}
          >
            <X />
          </Button>
          {selected.size > 0 && (
            <div className="flex w-full items-center gap-1.5 md:w-auto md:border-l md:pl-1.5">
              {trash ? (
                <Button
                  size="sm"
                  className="ml-auto md:ml-0"
                  onClick={() =>
                    runBulk({ action: 'restore', ids: selectedIds }, (n) => `Restored ${n}`)
                  }
                >
                  <Undo2 /> Restore
                </Button>
              ) : (
                <>
                  <BulkCategorize
                    className="min-w-0 grow md:w-40 md:grow-0"
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
                        <Button variant="outline" size="sm" className="hidden xl:inline-flex">
                          <Tags /> Tag
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {tags.map((t) => (
                          <DropdownMenuItem key={t.id} onSelect={() => addTag(t)}>
                            <TagDot color={t.color} /> #{t.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="hidden md:inline-flex"
                    onClick={markReviewed}
                  >
                    <CheckCheck /> Reviewed
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="hidden xl:inline-flex">
                        <CircleDashed /> Status
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => setStatus('cleared')}>
                        Cleared (on the statement)
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setStatus('pending')}>
                        Pending
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={deleteSelected}
                  >
                    <Trash2 /> Delete
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="More actions"
                        className="xl:hidden"
                      >
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="md:hidden" onSelect={markReviewed}>
                        <CheckCheck /> Mark reviewed
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setStatus('cleared')}>
                        <CircleDashed /> Mark cleared
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setStatus('pending')}>
                        <CircleDashed /> Mark pending
                      </DropdownMenuItem>
                      {tags.length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>Add a tag</DropdownMenuLabel>
                          {tags.map((t) => (
                            <DropdownMenuItem key={t.id} onSelect={() => addTag(t)}>
                              <TagDot color={t.color} /> #{t.name}
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );

  function addTag(tag: { id: string; name: string }) {
    runBulk(
      { action: 'addTags', ids: selectedIds, tagIds: [tag.id] },
      (n) => `Tagged ${n} with #${tag.name}`,
    );
  }

  function markReviewed() {
    runBulk({ action: 'markReviewed', ids: selectedIds }, (n) => `Marked ${n} as reviewed`);
  }

  function setStatus(status: 'cleared' | 'pending') {
    runBulk({ action: 'setStatus', ids: selectedIds, status }, (n) => `Marked ${n} as ${status}`);
  }

  async function deleteSelected() {
    const ok = await confirm({
      title: `Delete ${selected.size} transaction${selected.size === 1 ? '' : 's'}?`,
      description: 'They move to the trash, where you can restore them for 30 days.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const ids = selectedIds;
    try {
      const res = await bulk.mutateAsync({ action: 'delete', ids });
      clearSelection();
      toast(`Deleted ${res.updated}`, {
        action: {
          label: 'Undo',
          onClick: () => bulk.mutate({ action: 'restore', ids }),
        },
      });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
}

function TagDot({ color }: { color: string }) {
  return <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
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

function BulkCategorize({
  onPick,
  className,
}: {
  onPick: (categoryId: string | null) => void;
  className?: string;
}) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <div className={className}>
      <CategoryPicker
        value={value}
        onChange={(id) => {
          setValue(null);
          onPick(id);
        }}
        placeholder="Categorize…"
        className="h-8 text-compact"
      />
    </div>
  );
}
