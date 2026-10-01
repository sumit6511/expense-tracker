import type { InboundEmail, InboundEmailStatus } from '@et/shared';
import { Check, Copy, Mail, RefreshCw, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/select';
import { useTransactionDialog } from '@/features/transactions/transaction-dialog';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useAccounts,
  useAddEmailSender,
  useDismissEmail,
  useEmailIn,
  useLinkEmail,
  useNewEmailAddress,
  useRemoveEmailSender,
  useUpdateEmailIn,
} from '@/lib/queries';
import { useCanWrite, useWorkspace } from '@/lib/session';

const STATUS: Record<
  InboundEmailStatus,
  { label: string; tone: 'positive' | 'warning' | 'neutral' }
> = {
  recorded: { label: 'Added', tone: 'positive' },
  needs_review: { label: 'Needs you', tone: 'warning' },
  duplicate: { label: 'Already had it', tone: 'neutral' },
  ignored: { label: 'Ignored', tone: 'neutral' },
};

function useWhen() {
  const f = useFormat();
  const ws = useWorkspace();
  return (iso: string) => {
    const at = new Date(iso);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: ws.timezone }).format(at);
    const time = at.toLocaleTimeString('en-GB', {
      timeZone: ws.timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${f.relativeDate(day)}, ${time}`;
  };
}

export function EmailInCard() {
  const { role } = useWorkspace();
  const manager = role === 'owner' || role === 'admin';
  const data = useEmailIn();
  const [copied, setCopied] = useState(false);
  const fresh = useNewEmailAddress();
  const confirm = useConfirm();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Email in</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        {!data.data ? (
          <Skeleton className="h-20" />
        ) : !data.data.available ? (
          <p className="text-sm text-muted-foreground">
            This server doesn’t receive email yet. Whoever runs it can turn it on with{' '}
            <code className="text-xs">EMAIL_IN_ADDRESS</code> and a mailbox to read (see the
            README); then each workspace gets its own address for receipts and bank alerts.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Forward receipts to this address, with the amount in the subject if you like (“lunch
              450 eSewa”), or have your bank’s alert emails sent here. They become transactions
              waiting in Review. Only mail from people in this workspace, and from senders you
              trust, is read.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                readOnly
                value={data.data.address ?? ''}
                aria-label="Email-in address"
                onFocus={(e) => e.target.select()}
                className="min-w-0 basis-full font-mono text-xs sm:flex-1 sm:basis-0"
              />
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(data.data!.address ?? '');
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
              </Button>
              {manager && (
                <Button
                  variant="ghost"
                  disabled={fresh.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Make a new address?',
                      description:
                        'Mail to the current address will no longer be read. Update any forwarding you set up.',
                      confirmLabel: 'New address',
                    });
                    if (ok)
                      fresh.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) });
                  }}
                >
                  <RefreshCw /> New address
                </Button>
              )}
            </div>
            {manager && <Routing />}
            <Messages messages={data.data.messages} manager={manager} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Where things go: the default account, and trusted senders with their accounts. */
function Routing() {
  const { data } = useEmailIn();
  const { data: accounts = [] } = useAccounts();
  const update = useUpdateEmailIn();
  const add = useAddEmailSender();
  const remove = useRemoveEmailSender();
  const [sender, setSender] = useState('');
  const [accountId, setAccountId] = useState('');
  const open = accounts.filter((a) => !a.archived);
  const name = (id: string | null) => accounts.find((a) => a.id === id)?.name;
  const onError = (err: unknown) => toast.error(errorMessage(err));

  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate(
      { sender, accountId: accountId || null },
      {
        onSuccess: () => {
          setSender('');
          toast.success('Sender trusted');
        },
        onError,
      },
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-[12rem_1fr] sm:items-center">
        <label htmlFor="email-in-account" className="font-medium">
          Receipts go to
        </label>
        <Select
          id="email-in-account"
          value={data?.defaultAccountId ?? ''}
          onValueChange={(v) => update.mutate({ defaultAccountId: v || null }, { onError })}
        >
          <SelectItem value="">The first cash or bank account</SelectItem>
          {open.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </Select>
      </div>
      <div>
        <p className="mb-1 text-sm font-medium">Trusted senders</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Your bank’s or wallet’s alert address (or its whole domain, like @nabilbank.com). Their
          alerts are read as transactions in the account you choose.
        </p>
        {data && data.senders.length > 0 && (
          <ul className="mb-2 divide-y rounded-lg border text-sm">
            {data.senders.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{s.sender}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {name(s.accountId) ?? 'Default account'}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Stop trusting ${s.sender}`}
                  onClick={() => remove.mutate(s.id, { onError })}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <Input
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            placeholder="alerts@yourbank.com"
            aria-label="Sender address or @domain"
            maxLength={254}
            className="min-w-48 flex-1"
            required
          />
          <Select
            value={accountId}
            onValueChange={setAccountId}
            aria-label="Account for this sender"
            className="w-auto"
          >
            <SelectItem value="">Default account</SelectItem>
            {open.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </Select>
          <Button type="submit" variant="outline" disabled={add.isPending || !sender.trim()}>
            Trust
          </Button>
        </form>
      </div>
    </div>
  );
}

function Messages({ messages, manager }: { messages: InboundEmail[]; manager: boolean }) {
  const when = useWhen();
  const ws = useWorkspace();
  const canWrite = useCanWrite();
  const { openNew, openEdit } = useTransactionDialog();
  const dismiss = useDismissEmail();
  const link = useLinkEmail();
  const trust = useAddEmailSender();
  const [all, setAll] = useState(false);
  const onError = (err: unknown) => toast.error(errorMessage(err));

  if (messages.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Mail className="size-4" /> No emails yet.
      </p>
    );
  }

  /** Opens the usual dialog with what the email gave, its files queued as receipts. */
  async function add(m: InboundEmail) {
    try {
      const files = await Promise.all(
        m.files.map(async (file) => {
          const res = await fetch(
            `/api/v1/workspaces/${ws.id}/email-in/messages/${m.id}/files/${file.id}`,
          );
          if (!res.ok) throw new Error(`Couldn’t load ${file.fileName}`);
          return new File([await res.blob()], file.fileName, { type: file.contentType });
        }),
      );
      const d = m.draft;
      openNew({
        mode: d?.amountMinor && d.amountMinor > 0 ? 'income' : 'expense',
        ...(d?.accountId && { accountId: d.accountId }),
        ...(d?.date && { date: d.date }),
        ...(d?.amountMinor && { amountMinor: Math.abs(d.amountMinor) }),
        ...(d?.payee && { payee: d.payee }),
        ...(d?.notes && { notes: d.notes }),
        files,
        onCreated: (tx) => link.mutate({ id: m.id, transactionId: tx.id }, { onError }),
      });
    } catch (err) {
      onError(err);
    }
  }

  const shown = all ? messages : messages.slice(0, 8);
  return (
    <div>
      <p className="mb-1 text-sm font-medium">Recent emails</p>
      <ul className="divide-y rounded-lg border text-sm" aria-label="Recent emails">
        {shown.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{m.subject || '(no subject)'}</p>
              <p className="truncate text-xs text-muted-foreground">
                {m.fromName || m.from} · {when(m.receivedAt)}
                {m.detail && ` · ${m.detail}`}
                {m.files.length > 0 &&
                  ` · ${m.files.length} file${m.files.length === 1 ? '' : 's'}`}
              </p>
            </div>
            <div className="flex gap-1">
              {m.status === 'needs_review' && canWrite && (
                <>
                  <Button size="sm" variant="outline" onClick={() => void add(m)}>
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dismiss.mutate(m.id, { onError })}
                  >
                    Dismiss
                  </Button>
                </>
              )}
              {(m.status === 'recorded' || m.status === 'duplicate') && m.transactionIds[0] && (
                <Button size="sm" variant="ghost" onClick={() => openEdit(m.transactionIds[0]!)}>
                  Open
                </Button>
              )}
              {m.status === 'ignored' && manager && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    trust.mutate(
                      { sender: m.from, accountId: null },
                      {
                        onSuccess: () =>
                          toast.success(`${m.from} is trusted; their next emails will be read`),
                        onError,
                      },
                    )
                  }
                >
                  Trust sender
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {messages.length > 8 && (
        <Button size="sm" variant="ghost" className="mt-1" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${messages.length}`}
        </Button>
      )}
    </div>
  );
}
