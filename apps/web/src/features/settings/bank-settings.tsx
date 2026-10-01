import type { BankAccountLink, BankConnection } from '@et/shared';
import { ExternalLink, Landmark, Plus, RefreshCw } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { DatePicker } from '@/components/date-picker';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useAccounts,
  useBankSync,
  useConnectBank,
  useRemoveBankConnection,
  useSyncBank,
  useUpdateBankLink,
} from '@/lib/queries';
import { useWorkspace } from '@/lib/session';

export function BankSyncCard() {
  const { role } = useWorkspace();
  const manager = role === 'owner' || role === 'admin';
  const sync = useBankSync();
  const [adding, setAdding] = useState(false);
  const data = sync.data;
  const provider = data?.providers[0];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Bank sync</CardTitle>
        {manager && data?.available && provider && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Connect a bank
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        {!data ? (
          <Skeleton className="h-16" />
        ) : !data.available || !provider ? (
          <p className="text-sm text-muted-foreground">Bank sync is turned off on this server.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Bring in your bank’s transactions automatically: they wait in Review, and ones you
              already entered are matched. Sync only reads; it can never move money.{' '}
              {provider.label} covers {provider.coverage} (for a small yearly fee, paid to them).
              Banks in Nepal don’t offer this yet: for them, use email in or pasted SMS alerts.
            </p>
            {adding && <ConnectForm onDone={() => setAdding(false)} />}
            {data.connections.length === 0 && !adding ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Landmark className="size-4" /> No banks connected.
              </p>
            ) : (
              data.connections.map((c) => (
                <ConnectionView key={c.id} connection={c} manager={manager} />
              ))
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectForm({ onDone }: { onDone: () => void }) {
  const { data } = useBankSync();
  const connect = useConnectBank();
  const [token, setToken] = useState('');
  const provider = data!.providers[0]!;

  function submit(e: FormEvent) {
    e.preventDefault();
    connect.mutate(
      { provider: provider.id, setupToken: token },
      {
        onSuccess: () => {
          toast.success('Connected. Choose which of your accounts each bank account fills.');
          onDone();
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-2 rounded-xl border p-3">
      <label htmlFor="bank-token" className="text-sm font-medium">
        {provider.label} setup token
      </label>
      <Textarea
        id="bank-token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        rows={3}
        className="font-mono text-xs"
        placeholder="aHR0cHM6Ly9icmlkZ2Uuc2ltcGxlZmluLm9yZy9zaW1wbGVmaW4vY2xhaW0v…"
        required
      />
      <p className="text-xs text-muted-foreground">
        Make one at{' '}
        <a
          href={provider.signupUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          {provider.label} <ExternalLink className="size-3" />
        </a>{' '}
        and paste it here. It works once; the connection it gives is kept encrypted.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={connect.isPending || token.trim().length < 10}>
          {connect.isPending ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </form>
  );
}

function ConnectionView({
  connection: c,
  manager,
}: {
  connection: BankConnection;
  manager: boolean;
}) {
  const f = useFormat();
  const ws = useWorkspace();
  const sync = useSyncBank();
  const remove = useRemoveBankConnection();
  const confirm = useConfirm();
  const onError = (err: unknown) => toast.error(errorMessage(err));
  const synced = c.lastSyncedAt
    ? `Last synced ${f.relativeDate(new Intl.DateTimeFormat('en-CA', { timeZone: ws.timezone }).format(new Date(c.lastSyncedAt))).toLowerCase()}`
    : 'Not synced yet';

  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{c.label}</span>
            {c.status === 'error' && <Badge tone="destructive">Needs attention</Badge>}
          </p>
          <p className="text-xs text-muted-foreground">
            {synced}
            {c.lastError && ` · ${c.lastError}`}
          </p>
        </div>
        {manager && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={sync.isPending}
              onClick={() =>
                sync.mutate(c.id, {
                  onSuccess: (r) =>
                    r.errors.length
                      ? toast.error(r.errors.join(' '))
                      : toast.success(
                          r.created || r.matched
                            ? `${r.created} new, ${r.matched} matched to ones you entered`
                            : 'Nothing new',
                        ),
                  onError,
                })
              }
            >
              <RefreshCw className={sync.isPending ? 'animate-spin' : undefined} /> Sync now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const ok = await confirm({
                  title: `Disconnect ${c.label}?`,
                  description: 'Transactions already brought in stay. You can connect again later.',
                  confirmLabel: 'Disconnect',
                  destructive: true,
                });
                if (ok) remove.mutate(c.id, { onError });
              }}
            >
              Disconnect
            </Button>
          </>
        )}
      </div>
      <ul className="divide-y rounded-lg border text-sm" aria-label={`Accounts at ${c.label}`}>
        {c.accounts.map((a) => (
          <LinkRow key={a.id} link={a} manager={manager} />
        ))}
      </ul>
    </div>
  );
}

function LinkRow({ link: a, manager }: { link: BankAccountLink; manager: boolean }) {
  const f = useFormat();
  const { data: accounts = [] } = useAccounts();
  const update = useUpdateBankLink();
  const onError = (err: unknown) => toast.error(errorMessage(err));
  const choices = accounts.filter((x) => !x.archived && x.currency === a.currency);
  const ours = accounts.find((x) => x.id === a.accountId);

  return (
    <li className="grid grid-cols-1 gap-2 px-3 py-2 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium">{a.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {a.institution && `${a.institution} · `}
          {a.balanceMinor !== null
            ? `bank says ${f.money(a.balanceMinor, a.currency)}`
            : a.currency}
        </p>
      </div>
      {manager ? (
        <>
          <Select
            aria-label={`Account for ${a.name}`}
            value={a.accountId ?? ''}
            className="h-9 text-[13px] sm:w-48"
            onValueChange={(v) =>
              update.mutate(
                { id: a.id, accountId: v || null },
                {
                  onSuccess: () =>
                    v && toast.success('Linked. Use “Sync now” to bring in its transactions.'),
                  onError,
                },
              )
            }
          >
            <SelectItem value="">Don’t sync</SelectItem>
            {choices.map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.name}
              </SelectItem>
            ))}
          </Select>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            From
            <DatePicker
              aria-label={`Bring in ${a.name} transactions from`}
              value={a.syncFrom}
              max={f.today}
              className="h-9 w-44 text-[13px] text-foreground"
              onChange={(date) => update.mutate({ id: a.id, syncFrom: date }, { onError })}
            />
          </div>
        </>
      ) : (
        <span className="text-xs text-muted-foreground sm:col-span-2">
          {ours ? `Fills ${ours.name}` : a.accountId ? 'Fills another account' : 'Not synced'}
        </span>
      )}
    </li>
  );
}
