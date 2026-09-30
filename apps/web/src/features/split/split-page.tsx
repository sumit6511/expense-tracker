import type { SplitGroup, SplitGroupSummary } from '@et/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Handshake, Loader2, Plus, UserPlus, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { CategoryPicker, CurrencySelect } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useCreateSplitGroup, useMembers, useSplitGroups } from '@/lib/queries';
import { useCanWrite } from '@/lib/session';
import { cn } from '@/lib/utils';

/** "You're owed Rs. 500", "You owe Rs. 200", "Settled up". */
export function YourPosition({
  balance,
  currency,
  className,
}: {
  balance: number | null;
  currency: string;
  className?: string;
}) {
  const f = useFormat();
  if (balance === null)
    return <span className={cn('text-muted-foreground', className)}>You’re not in this group</span>;
  if (balance === 0)
    return <span className={cn('text-muted-foreground', className)}>You’re settled up</span>;
  return balance > 0 ? (
    <span className={cn('text-positive', className)}>
      You’re owed {f.money(balance, currency, { trimZeroFraction: true })}
    </span>
  ) : (
    <span className={className}>
      You owe {f.money(-balance, currency, { trimZeroFraction: true })}
    </span>
  );
}

function GroupCard({ g }: { g: SplitGroupSummary }) {
  const f = useFormat();
  return (
    <Link
      to="/split/$groupId"
      params={{ groupId: g.id }}
      className="block rounded-xl border bg-card p-4 shadow-xs transition-colors hover:bg-muted/50"
    >
      <p className="truncate font-medium">{g.name}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {g.memberCount} {g.memberCount === 1 ? 'person' : 'people'} ·{' '}
        {f.money(g.totalSpentMinor, g.currency, { trimZeroFraction: true })} spent
      </p>
      <YourPosition
        balance={g.yourBalanceMinor}
        currency={g.currency}
        className="mt-3 block text-sm font-semibold"
      />
    </Link>
  );
}

export function SplitPage() {
  const groups = useSplitGroups();
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const active = groups.data?.filter((g) => !g.archived) ?? [];
  const archived = groups.data?.filter((g) => g.archived) ?? [];

  const newButton = canWrite && (
    <Button onClick={() => setCreating(true)}>
      <Plus /> New group
    </Button>
  );

  return (
    <div className="pb-10">
      <PageHeader
        title="Split with friends"
        description="Trips, flatmates and dinners: who paid, who owes whom, and settling up."
        actions={newButton}
      />
      {groups.error && <ErrorState error={groups.error} retry={() => groups.refetch()} />}
      {groups.isPending ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : active.length === 0 && archived.length === 0 ? (
        <Card>
          <EmptyState
            icon={Handshake}
            title="No groups yet"
            description="Start one for a trip or your flat. Add people (they don’t need an account), then note who paid for what. The app works out who owes whom."
            action={newButton}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((g) => (
              <GroupCard key={g.id} g={g} />
            ))}
          </div>
          {archived.length > 0 && (
            <>
              <h2 className="mt-8 mb-3 text-sm font-medium text-muted-foreground">Archived</h2>
              <div className="grid grid-cols-1 gap-3 opacity-75 sm:grid-cols-2 lg:grid-cols-3">
                {archived.map((g) => (
                  <GroupCard key={g.id} g={g} />
                ))}
              </div>
            </>
          )}
        </>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <NewGroupDialog
            onDone={(g) => {
              setCreating(false);
              navigate({ to: '/split/$groupId', params: { groupId: g.id } });
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

interface PersonDraft {
  key: number;
  name: string;
  userId: string | null;
}

let draftKey = 0;

function NewGroupDialog({ onDone }: { onDone: (g: SplitGroup) => void }) {
  const f = useFormat();
  const create = useCreateSplitGroup();
  const members = useMembers();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(f.base);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [simplify, setSimplify] = useState(true);
  const [people, setPeople] = useState<PersonDraft[]>([
    { key: draftKey++, name: '', userId: null },
  ]);
  const [error, setError] = useState<string | null>(null);

  const others = (members.data?.members ?? []).filter(
    (m) => !m.you && !people.some((p) => p.userId === m.userId),
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const group = await create.mutateAsync({
        name: name.trim(),
        currency,
        categoryId,
        simplifyDebts: simplify,
        members: people
          .filter((p) => p.name.trim())
          .map((p) => ({ name: p.name.trim(), userId: p.userId })),
      });
      toast.success('Group created');
      onDone(group as SplitGroup);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <DialogContent aria-describedby={undefined}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-4">
          <Field label="Name" htmlFor="group-name">
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pokhara trip, Flat in Baneshwor"
              maxLength={60}
              required
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-1 gap-2">
            <span className="text-[13px] font-medium">People (you’re included)</span>
            {people.map((p, i) => (
              <div key={p.key} className="flex gap-2">
                <Input
                  value={p.name}
                  onChange={(e) =>
                    setPeople((list) =>
                      list.map((x) => (x.key === p.key ? { ...x, name: e.target.value } : x)),
                    )
                  }
                  placeholder={`Person ${i + 1}`}
                  aria-label={`Person ${i + 1}`}
                  maxLength={60}
                  disabled={p.userId !== null}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove person ${i + 1}`}
                  onClick={() => setPeople((list) => list.filter((x) => x.key !== p.key))}
                >
                  <X />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPeople((list) => [...list, { key: draftKey++, name: '', userId: null }])
                }
              >
                <UserPlus /> Add a person
              </Button>
              {others.map((m) => (
                <Button
                  key={m.userId}
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setPeople((list) => [
                      ...list.filter((x) => x.name.trim() || x.userId),
                      { key: draftKey++, name: m.name, userId: m.userId },
                    ])
                  }
                >
                  <Plus /> {m.name}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Currency" htmlFor="group-currency">
              <CurrencySelect id="group-currency" value={currency} onChange={setCurrency} />
            </Field>
            <Field
              label="Category for your share"
              htmlFor="group-category"
              hint="Used when you record your payments in your own accounts."
            >
              <CategoryPicker
                id="group-category"
                value={categoryId}
                onChange={setCategoryId}
                kind="expense"
                allowNone
                placeholder="None"
              />
            </Field>
          </div>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              Simplify debts
              <span className="block text-xs text-muted-foreground">
                Suggest the fewest payments to settle up, even between people who didn’t share an
                expense.
              </span>
            </span>
            <Switch checked={simplify} onCheckedChange={setSimplify} />
          </label>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Loader2 className="animate-spin" />} Create group
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
