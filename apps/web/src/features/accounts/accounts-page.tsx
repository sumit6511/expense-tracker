import { ACCOUNT_TYPE_LABELS, type Account, type AccountType } from '@et/shared';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Landmark, Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import { CategoryIcon } from '@/components/icons';
import { Money } from '@/components/money';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, Skeleton } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { useFormat } from '@/lib/format';
import { useAccounts } from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { AccountFormDialog } from './account-form';

const GROUPS: Array<{ label: string; types: AccountType[] }> = [
  { label: 'Cash & bank', types: ['cash', 'checking', 'savings'] },
  { label: 'Digital wallets', types: ['e_wallet'] },
  { label: 'Credit & loans', types: ['credit_card', 'loan'] },
  { label: 'Investments & other', types: ['investment', 'other'] },
];

export function AccountsPage() {
  const { data: accounts, error, refetch } = useAccounts();
  const canWrite = useCanWrite();
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const active = accounts?.filter((a) => !a.archived) ?? [];
  const archived = accounts?.filter((a) => a.archived) ?? [];
  const inNetWorth = active.filter((a) => a.inNetWorth);
  const assets = inNetWorth
    .filter((a) => (a.balanceBaseMinor ?? 0) > 0)
    .reduce((s, a) => s + (a.balanceBaseMinor ?? 0), 0);
  const debts = inNetWorth
    .filter((a) => (a.balanceBaseMinor ?? 0) < 0)
    .reduce((s, a) => s + (a.balanceBaseMinor ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Accounts"
        actions={
          canWrite && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add account
            </Button>
          )
        }
      />
      {error && <ErrorState error={error} retry={() => refetch()} />}
      {!accounts ? (
        !error && <Skeleton className="h-64" />
      ) : (
        <div className="grid grid-cols-1 gap-5">
          <div className="grid grid-cols-3 gap-3">
            <Summary label="Net worth" minor={assets + debts} strong />
            <Summary label="What you have" minor={assets} />
            <Summary label="What you owe" minor={-debts} />
          </div>
          {active.length === 0 && (
            <Card>
              <EmptyState
                icon={Landmark}
                title="No accounts"
                description="Add your cash, bank accounts and wallets like eSewa or Khalti."
                action={
                  canWrite && (
                    <Button onClick={() => setAdding(true)}>
                      <Plus /> Add account
                    </Button>
                  )
                }
              />
            </Card>
          )}
          {GROUPS.map((g) => {
            const list = active.filter((a) => g.types.includes(a.type));
            if (list.length === 0) return null;
            const total = list.reduce((s, a) => s + (a.balanceBaseMinor ?? 0), 0);
            return (
              <section key={g.label}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="text-sm font-semibold">{g.label}</h2>
                  <Money minor={total} className="text-sm text-muted-foreground" trimZero />
                </div>
                <Card className="divide-y overflow-hidden">
                  {list.map((a) => (
                    <AccountRow key={a.id} account={a} />
                  ))}
                </Card>
              </section>
            );
          })}
          {archived.length > 0 && (
            <section>
              <button
                type="button"
                className="mb-2 px-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setShowArchived((v) => !v)}
              >
                {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
              </button>
              {showArchived && (
                <Card className="divide-y overflow-hidden opacity-75">
                  {archived.map((a) => (
                    <AccountRow key={a.id} account={a} />
                  ))}
                </Card>
              )}
            </section>
          )}
        </div>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding && <AccountFormDialog onDone={() => setAdding(false)} />}
      </Dialog>
    </div>
  );
}

function Summary({ label, minor, strong }: { label: string; minor: number; strong?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={
            strong
              ? 'mt-1 text-lg font-semibold sm:text-2xl'
              : 'mt-1 text-lg font-medium sm:text-xl'
          }
        >
          <Money minor={minor} trimZero />
        </p>
      </CardContent>
    </Card>
  );
}

function AccountRow({ account: a }: { account: Account }) {
  const f = useFormat();
  const utilisation =
    a.type === 'credit_card' && a.creditLimitMinor
      ? Math.round((-a.balanceMinor / a.creditLimitMinor) * 100)
      : null;
  return (
    <Link
      to="/accounts/$accountId"
      params={{ accountId: a.id }}
      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60"
    >
      <CategoryIcon icon={a.icon} color={a.color} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{a.name}</span>
          {a.visibility === 'private' && (
            <Lock
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label="Private: only you can see it"
            >
              <title>Private: only you can see it</title>
            </Lock>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {ACCOUNT_TYPE_LABELS[a.type]}
          {a.institution ? ` · ${a.institution}` : ''}
          {a.lastTransactionDate ? ` · last used ${f.relativeDate(a.lastTransactionDate)}` : ''}
          {utilisation !== null && utilisation > 0 ? ` · ${utilisation}% of limit used` : ''}
        </span>
      </span>
      <span className="text-right">
        <Money
          minor={a.balanceMinor}
          currency={a.currency}
          className="text-sm font-semibold"
          trimZero
        />
        {a.currency !== f.base && a.balanceBaseMinor !== null && (
          <span className="block text-xs text-muted-foreground">
            ≈ {f.money(a.balanceBaseMinor, undefined, { trimZeroFraction: true })}
          </span>
        )}
      </span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}
