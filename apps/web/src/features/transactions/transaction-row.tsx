import type { Transaction } from '@et/shared';
import { ArrowLeftRight, Inbox, Lock, Paperclip, Repeat, Split } from 'lucide-react';
import { CategoryIcon } from '@/components/icons';
import { Money } from '@/components/money';
import { UserAvatar } from '@/components/person';
import { Badge } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/menu';
import { useFormat } from '@/lib/format';
import { useAccountMap, useCategoryMap, useMemberProfiles, useTags } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** One line in a transaction list: icon, payee/description, category · account, amount. */
export function TransactionRow({
  tx,
  onOpen,
  selectable,
  selected,
  onSelect,
  showAccount = true,
  showDate = false,
}: {
  tx: Transaction;
  onOpen: (tx: Transaction) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  showAccount?: boolean;
  showDate?: boolean;
}) {
  const f = useFormat();
  const accounts = useAccountMap();
  const categories = useCategoryMap();
  const { data: tags = [] } = useTags();
  const people = useMemberProfiles();
  const { me } = useSession();
  // In a shared workspace, mark what other people added (your own entries stay unmarked).
  const author =
    people && tx.createdBy && tx.createdBy !== me.user.id ? people.get(tx.createdBy) : undefined;
  const addedBy = author?.name;
  const account = accounts.get(tx.accountId);
  const isSplit = tx.splits.length > 1;
  const category =
    !isSplit && tx.splits[0]?.categoryId ? categories.get(tx.splits[0].categoryId) : undefined;

  let title: string;
  let subtitle: string;
  if (tx.transfer) {
    const other = accounts.get(tx.transfer.peerAccountId)?.name ?? 'another account';
    title = tx.amountMinor < 0 ? `Transfer to ${other}` : `Transfer from ${other}`;
    subtitle = 'Transfer';
  } else {
    title =
      tx.payeeName || tx.rawDescription || tx.notes || (category ? category.name : 'No payee');
    subtitle = isSplit
      ? `Split · ${tx.splits.length} categories`
      : category
        ? category.name
        : tx.amountMinor < 0
          ? 'Uncategorized'
          : 'Uncategorized income';
  }
  const txTags = tags.filter((t) => tx.tagIds.includes(t.id));
  const uncategorized = !tx.transfer && !isSplit && !category;

  return (
    <div
      className={cn(
        'group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60 sm:px-4',
        selected && 'bg-accent/60 hover:bg-accent/70',
      )}
    >
      {selectable && (
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onSelect?.(v === true)}
          aria-label={`Select ${title}`}
        />
      )}
      <button
        type="button"
        onClick={() => onOpen(tx)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        {tx.transfer ? (
          <span className="grid grid-cols-1 size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <ArrowLeftRight className="size-[18px]" />
          </span>
        ) : isSplit ? (
          <span className="grid grid-cols-1 size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <Split className="size-[18px]" />
          </span>
        ) : (
          <CategoryIcon icon={category?.icon ?? 'tag'} color={category?.color} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{title}</span>
            {tx.needsReview && (
              <Inbox className="size-3.5 shrink-0 text-primary" aria-label="Needs review" />
            )}
            {tx.recurringId && (
              <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-label="Recurring" />
            )}
            {tx.attachmentCount > 0 && (
              <Paperclip
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label={`${tx.attachmentCount} attachment${tx.attachmentCount === 1 ? '' : 's'}`}
              />
            )}
            {tx.status === 'pending' && <Badge tone="warning">Pending</Badge>}
            {tx.status === 'reconciled' && (
              <Lock className="size-3 shrink-0 text-muted-foreground/70" aria-label="Reconciled" />
            )}
            {addedBy && tx.createdBy && (
              <UserAvatar
                id={tx.createdBy}
                name={addedBy}
                avatar={author?.avatar}
                size="xs"
                label={`Added by ${addedBy}`}
              />
            )}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn('truncate', uncategorized && 'pr-0.5 italic')}>{subtitle}</span>
            {showAccount && account && (
              <span className="hidden truncate sm:inline">· {account.name}</span>
            )}
            {showDate && <span className="truncate">· {f.relativeDate(tx.date)}</span>}
            {txTags.slice(0, 2).map((t) => (
              <span
                key={t.id}
                className="hidden shrink-0 rounded px-1 sm:inline"
                style={{ color: t.color }}
              >
                #{t.name}
              </span>
            ))}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <Money
            minor={tx.amountMinor}
            currency={tx.currency}
            signed={tx.amountMinor > 0}
            colored={!tx.transfer}
            className={cn('text-sm font-medium', tx.transfer && 'text-muted-foreground')}
          />
          {tx.runningBalanceMinor !== null && (
            <span className="block text-[11px] text-muted-foreground tabular">
              {f.money(tx.runningBalanceMinor, tx.currency)}
            </span>
          )}
          {tx.original && (
            <span className="block text-[11px] text-muted-foreground tabular">
              {f.money(tx.original.amountMinor, tx.original.currency)}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
