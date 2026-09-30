import type { Transaction } from '@et/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Check, CheckCheck, CircleCheck, Loader2, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { CategoryPicker } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/menu';
import { canMakeRule, ruleFromTransaction, useRuleDialog } from '@/features/rules/rule-dialog';
import { useTransactionDialog } from '@/features/transactions/transaction-dialog';
import { TransactionRow } from '@/features/transactions/transaction-row';
import { errorMessage } from '@/lib/api';
import {
  useBulkTransactions,
  useCategoryMap,
  useReviewCounts,
  useTransactions,
  useUpdateTransaction,
} from '@/lib/queries';
import { useCanWrite } from '@/lib/session';

type Tab = 'review' | 'uncategorized';

export function InboxPage() {
  const search = useSearch({ from: '/app/inbox' });
  const navigate = useNavigate({ from: '/inbox' });
  const tab: Tab = search.tab ?? 'review';
  const counts = useReviewCounts();
  const canWrite = useCanWrite();
  const confirm = useConfirm();
  const bulk = useBulkTransactions();
  const filters = useMemo(
    () => (tab === 'review' ? { needsReview: 'true' as const } : { categoryIds: 'none' }),
    [tab],
  );
  const list = useTransactions(filters, 100);
  // Rows handled here disappear at once instead of waiting for the refetch.
  const [done, setDone] = useState<Set<string>>(new Set());
  const markDone = (id: string) => setDone((d) => new Set(d).add(id));
  const unmarkDone = (id: string) => setDone((d) => new Set([...d].filter((x) => x !== id)));
  const items = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((t) => !done.has(t.id));
  const total = list.data?.pages[0]?.totals.count ?? 0;

  async function confirmAll() {
    const ids = items.map((t) => t.id);
    const ok = await confirm({
      title: `Confirm ${ids.length} transaction${ids.length === 1 ? '' : 's'}?`,
      description: 'They leave the inbox as they are. Categories you haven’t set stay empty.',
      confirmLabel: 'Confirm all',
    });
    if (!ok) return;
    bulk.mutate(
      { action: 'markReviewed', ids },
      {
        onSuccess: ({ updated }) => {
          ids.forEach(markDone);
          toast.success(`Confirmed ${updated} transaction${updated === 1 ? '' : 's'}`);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 pb-10">
      <PageHeader
        title="Review"
        className="mb-0"
        description="Check imported transactions and give everything a category."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/settings" search={{ tab: 'rules' }}>
                <Wand2 /> Rules
              </Link>
            </Button>
            {canWrite && tab === 'review' && items.length > 0 && (
              <Button onClick={confirmAll} disabled={bulk.isPending}>
                <CheckCheck /> Confirm {items.length < total ? `these ${items.length}` : 'all'}
              </Button>
            )}
          </>
        }
      />
      <Segmented
        className="justify-self-start"
        label="Show"
        value={tab}
        onChange={(t) => {
          setDone(new Set());
          navigate({ search: { tab: t }, replace: true });
        }}
        options={[
          {
            value: 'review',
            label: `To review${counts.data ? ` · ${counts.data.needsReview}` : ''}`,
          },
          {
            value: 'uncategorized',
            label: `Uncategorized${counts.data ? ` · ${counts.data.uncategorized}` : ''}`,
          },
        ]}
      />
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : list.isPending ? (
        <Skeleton className="h-80" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={CircleCheck}
            title="All caught up"
            description={
              tab === 'review'
                ? 'Imported transactions show up here until you confirm them.'
                : 'Every transaction has a category.'
            }
          />
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          {items.map((tx) => (
            <InboxRow
              key={tx.id}
              tx={tx}
              canWrite={canWrite}
              onDone={markDone}
              onFailed={unmarkDone}
            />
          ))}
          {list.hasNextPage && (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 py-3 text-sm font-medium text-primary hover:bg-muted/60"
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />} Load more
            </button>
          )}
        </Card>
      )}
    </div>
  );
}

function InboxRow({
  tx,
  canWrite,
  onDone,
  onFailed,
}: {
  tx: Transaction;
  canWrite: boolean;
  onDone: (id: string) => void;
  onFailed: (id: string) => void;
}) {
  const { openEdit } = useTransactionDialog();
  const { openRule } = useRuleDialog();
  const categories = useCategoryMap();
  const update = useUpdateTransaction();
  const isSplit = tx.splits.length > 1;
  const categoryId = isSplit ? null : (tx.splits[0]?.categoryId ?? null);

  // The row hides at once; it comes back if saving fails. (mutateAsync, not mutate callbacks:
  // those are skipped once the row has unmounted.)
  async function setCategory(id: string | null) {
    if (id === null) return;
    onDone(tx.id);
    try {
      await update.mutateAsync({
        id: tx.id,
        version: tx.version,
        categoryId: id,
        needsReview: false,
      });
      toast.success(`Categorized as ${categories.get(id)?.name ?? 'chosen category'}`, {
        description: tx.payeeName ?? tx.rawDescription,
        ...(canMakeRule(tx) && {
          action: {
            label: 'Always do this',
            onClick: () => openRule(ruleFromTransaction(tx, id)),
          },
        }),
      });
    } catch (e) {
      onFailed(tx.id);
      toast.error(errorMessage(e));
    }
  }

  async function confirmOne() {
    onDone(tx.id);
    try {
      await update.mutateAsync({ id: tx.id, version: tx.version, needsReview: false });
    } catch (e) {
      onFailed(tx.id);
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <TransactionRow tx={tx} onOpen={() => openEdit(tx.id)} showDate />
      </div>
      {canWrite && (
        <div className="flex items-center gap-2 px-3 pb-3 sm:w-80 sm:py-2 sm:pr-4 sm:pl-0">
          {isSplit || tx.transfer ? (
            <Button variant="outline" className="flex-1" onClick={() => openEdit(tx.id)}>
              Open
            </Button>
          ) : (
            <CategoryPicker
              className="min-w-0 flex-1"
              value={categoryId}
              onChange={setCategory}
              kind={tx.amountMinor < 0 ? 'expense' : 'income'}
              allowNone={false}
              placeholder="Choose category"
            />
          )}
          {tx.needsReview ? (
            <Button
              variant="outline"
              size="icon"
              aria-label={`Confirm ${tx.payeeName ?? tx.rawDescription}`}
              onClick={confirmOne}
            >
              <Check />
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
