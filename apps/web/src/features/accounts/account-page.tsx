import { ACCOUNT_TYPE_LABELS } from '@et/shared';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowLeftRight,
  Ellipsis,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CategoryIcon } from '@/components/icons';
import { Money } from '@/components/money';
import { EmptyState, ErrorState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { Dialog, useConfirm } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { useTransactionDialog } from '@/features/transactions/transaction-dialog';
import { TransactionRow } from '@/features/transactions/transaction-row';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useAccounts, useDeleteAccount, useTransactions, useUpdateAccount } from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { AccountFormDialog } from './account-form';

export function AccountPage() {
  const { accountId } = useParams({ from: '/app/accounts/$accountId' });
  const navigate = useNavigate();
  const f = useFormat();
  const canWrite = useCanWrite();
  const confirm = useConfirm();
  const { openNew, openEdit } = useTransactionDialog();
  const { data: accounts, error } = useAccounts();
  const update = useUpdateAccount();
  const remove = useDeleteAccount();
  const [editing, setEditing] = useState(false);
  const account = accounts?.find((a) => a.id === accountId);
  const filters = useMemo(() => ({ accountIds: accountId }), [accountId]);
  const list = useTransactions(filters);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

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

  if (error) return <ErrorState error={error} />;
  if (!accounts) return <Skeleton className="h-64" />;
  if (!account) {
    return (
      <EmptyState
        icon={ArrowLeft}
        title="Account not found"
        action={
          <Button asChild variant="outline">
            <Link to="/accounts">Back to accounts</Link>
          </Button>
        }
      />
    );
  }

  async function toggleArchive() {
    if (!account) return;
    try {
      await update.mutateAsync({ id: account.id, archived: !account.archived });
      toast.success(account.archived ? 'Account restored' : 'Account archived');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function deleteAccount() {
    if (!account) return;
    const ok = await confirm({
      title: `Delete ${account.name}?`,
      description:
        account.transactionCount > 0
          ? 'This account still has transactions. Archive it instead, or delete its transactions first.'
          : 'This can’t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(account.id);
      toast.success('Account deleted');
      navigate({ to: '/accounts' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div>
      <Link
        to="/accounts"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Accounts
      </Link>
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <CategoryIcon icon={account.icon} color={account.color} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
            {account.name}
            {account.archived && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">(archived)</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {ACCOUNT_TYPE_LABELS[account.type]} · {account.currency}
            {account.institution ? ` · ${account.institution}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Balance</p>
          <p className="text-2xl font-semibold">
            <Money minor={account.balanceMinor} currency={account.currency} />
          </p>
          {account.currency !== f.base && account.balanceBaseMinor !== null && (
            <p className="text-xs text-muted-foreground">≈ {f.money(account.balanceBaseMinor)}</p>
          )}
        </div>
      </div>

      {canWrite && (
        <div className="mb-4 flex flex-wrap gap-2">
          {!account.archived && (
            <>
              <Button size="sm" onClick={() => openNew({ accountId: account.id })}>
                <Plus /> Add transaction
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openNew({ accountId: account.id, mode: 'transfer' })}
              >
                <ArrowLeftRight /> Transfer
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/import">
                  <Upload /> Import statement
                </Link>
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label="More actions">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil /> Edit account
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggleArchive}>
                {account.archived ? <ArchiveRestore /> : <Archive />}{' '}
                {account.archived ? 'Unarchive' : 'Archive'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={deleteAccount}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <Card className="overflow-hidden">
        {list.isPending ? (
          <div className="grid grid-cols-1 gap-3 p-4">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : (
          <div className="divide-y">
            {items.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                onOpen={(t) => openEdit(t.id)}
                showAccount={false}
                showDate
              />
            ))}
            <div className="flex items-center justify-between px-4 py-3 text-sm text-muted-foreground">
              <span>Starting balance · {f.date(account.openingDate)}</span>
              <Money minor={account.openingBalanceMinor} currency={account.currency} />
            </div>
          </div>
        )}
        <div ref={sentinel} className="h-1" />
        {list.isFetchingNextPage && (
          <div className="grid grid-cols-1 place-items-center py-3">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </Card>

      <Dialog open={editing} onOpenChange={setEditing}>
        {editing && <AccountFormDialog account={account} onDone={() => setEditing(false)} />}
      </Dialog>
    </div>
  );
}
