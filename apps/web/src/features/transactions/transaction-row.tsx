import type { Transaction } from '@et/shared';
import { ArrowLeftRight, Inbox, Lock, Paperclip, Repeat, Split } from 'lucide-react';
import { type PointerEvent, useRef } from 'react';
import { CategoryIcon } from '@/components/icons';
import { Money } from '@/components/money';
import { UserAvatar } from '@/components/person';
import { TagChip } from '@/components/tag-chip';
import { Badge } from '@/components/ui/card';
import { Checkbox, Hint } from '@/components/ui/menu';
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
  showReviewHint = true,
  selectMode = false,
  onLongPress,
}: {
  tx: Transaction;
  onOpen: (tx: Transaction) => void;
  /** Show the checkbox. */
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  /** Tapping the row selects it instead of opening it (selection mode on touch screens). */
  selectMode?: boolean;
  /** Long-press on a touch screen (starts selection mode). */
  onLongPress?: () => void;
  showAccount?: boolean;
  showDate?: boolean;
  /** Off where every row needs review anyway (the Review page). */
  showReviewHint?: boolean;
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
  const press = useLongPress(onLongPress);

  return (
    <div
      className={cn(
        'group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60 sm:px-4',
        selected && 'bg-accent/60 hover:bg-accent/70',
        // A long press selects; don't also start selecting text or open the iOS callout.
        onLongPress && 'select-none [-webkit-touch-callout:none]',
      )}
    >
      {selectable && (
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onSelect?.(v === true)}
          aria-label={`Select ${title}`}
          className={cn(selectMode && 'size-5')}
        />
      )}
      <button
        type="button"
        {...press.handlers}
        onClick={() => {
          if (press.consume()) return;
          if (selectMode) onSelect?.(!selected);
          else onOpen(tx);
        }}
        aria-pressed={selectMode ? selected : undefined}
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
            {tx.needsReview && showReviewHint && (
              <Hint label="Needs review">
                <Inbox className="size-3.5 text-primary" />
              </Hint>
            )}
            {tx.recurringId && (
              <Hint label="From a recurring item">
                <Repeat className="size-3.5 text-muted-foreground" />
              </Hint>
            )}
            {tx.attachmentCount > 0 && (
              <Hint
                label={`${tx.attachmentCount} attachment${tx.attachmentCount === 1 ? '' : 's'}`}
              >
                <Paperclip className="size-3.5 text-muted-foreground" />
              </Hint>
            )}
            {tx.status === 'pending' && <Badge tone="warning">Pending</Badge>}
            {tx.status === 'reconciled' && (
              <Hint label="Reconciled with a bank statement">
                <Lock className="size-3 text-muted-foreground/70" />
              </Hint>
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
              <TagChip
                key={t.id}
                name={t.name}
                color={t.color}
                className="hidden shrink-0 rounded px-1 sm:inline"
              />
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
            <span className="block text-2xs text-muted-foreground tabular">
              {f.money(tx.runningBalanceMinor, tx.currency)}
            </span>
          )}
          {tx.original && (
            <span className="block text-2xs text-muted-foreground tabular">
              {f.money(tx.original.amountMinor, tx.original.currency)}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

/**
 * Half a second's press without moving, on touch screens only. `consume()` tells the click that
 * ends a long press to do nothing (some browsers send one, some don't).
 */
function useLongPress(onLongPress: (() => void) | undefined) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  return {
    handlers: onLongPress
      ? {
          onPointerDown: (e: PointerEvent) => {
            fired.current = false;
            if (e.pointerType !== 'touch') return;
            start.current = { x: e.clientX, y: e.clientY };
            timer.current = window.setTimeout(() => {
              start.current = null;
              fired.current = true;
              navigator.vibrate?.(10);
              onLongPress();
            }, 500);
          },
          onPointerMove: (e: PointerEvent) => {
            const from = start.current;
            // Scrolling the list isn't a long press.
            if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 10) cancel();
          },
          onPointerUp: cancel,
          onPointerCancel: cancel,
          onContextMenu: (e: { preventDefault: () => void }) => {
            if (fired.current || start.current) e.preventDefault();
          },
        }
      : {},
    consume: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
  };
}
