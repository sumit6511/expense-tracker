import {
  type ApiToken,
  type CreatedApiToken,
  TOKEN_LIFETIMES,
  type TokenScope,
  todayIn,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENTS,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
} from '@et/shared';
import {
  Check,
  Copy,
  Ellipsis,
  ExternalLink,
  KeyRound,
  Plus,
  RotateCcw,
  Send,
  Webhook as WebhookIcon,
  X,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import {
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  useApiTokens,
  useCreateApiToken,
  useCreateWebhook,
  useDeleteWebhook,
  useRetryWebhookDelivery,
  useRevokeApiToken,
  useRotateWebhookSecret,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from '@/lib/queries';
import { useCanWrite, useWorkspace } from '@/lib/session';
import { EmailInCard } from './email-in-settings';

export function IntegrationsSettings() {
  const { role } = useWorkspace();
  return (
    <div className="grid grid-cols-1 gap-5">
      <EmailInCard />
      <TokensCard />
      {(role === 'owner' || role === 'admin') && <WebhooksCard />}
    </div>
  );
}

const LIFETIME_LABEL: Record<(typeof TOKEN_LIFETIMES)[number], string> = {
  30: '30 days',
  90: '90 days',
  365: '1 year',
};

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : label}
    </Button>
  );
}

/** The new token, shown once (only a hash is kept on the server), with a first request to try. */
function TokenPanel({ created, onClose }: { created: CreatedApiToken; onClose: () => void }) {
  const ws = useWorkspace();
  const example = `curl -H "Authorization: Bearer ${created.token}" \\\n  ${window.location.origin}/api/v1/workspaces/${ws.id}/accounts`;
  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border border-primary/30 bg-accent/40 p-3">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-sm">
          Copy <strong>{created.name}</strong> now and keep it somewhere safe. It won’t be shown
          again; if you lose it, revoke it and make a new one.
        </p>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          readOnly
          value={created.token}
          aria-label="New access token"
          onFocus={(e) => e.target.select()}
          className="font-mono text-xs"
        />
        <CopyButton text={created.token} />
      </div>
      <p className="text-xs text-muted-foreground">Try it:</p>
      <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">
        {example}
      </pre>
    </div>
  );
}

function NewTokenForm({
  onCreated,
  onCancel,
}: {
  onCreated: (t: CreatedApiToken) => void;
  onCancel: () => void;
}) {
  const canWrite = useCanWrite();
  const create = useCreateApiToken();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<TokenScope>('read');
  const [lifetime, setLifetime] = useState<string>('90');

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { name, scope, expiresInDays: lifetime === 'never' ? null : Number(lifetime) },
      { onSuccess: onCreated, onError: (err) => toast.error(errorMessage(err)) },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_auto_auto]"
    >
      <Field label="Name" htmlFor="token-name" hint="What will use it, so you know later.">
        <Input
          id="token-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Monthly spreadsheet"
          maxLength={60}
          required
          autoFocus
        />
      </Field>
      <Field label="Access" htmlFor="token-scope">
        <NativeSelect
          id="token-scope"
          value={scope}
          onChange={(e) => setScope(e.target.value as TokenScope)}
        >
          <option value="read">Read only</option>
          <option value="write" disabled={!canWrite}>
            Read and write
          </option>
        </NativeSelect>
      </Field>
      <Field label="Expires" htmlFor="token-expires">
        <NativeSelect
          id="token-expires"
          value={lifetime}
          onChange={(e) => setLifetime(e.target.value)}
        >
          {TOKEN_LIFETIMES.map((d) => (
            <option key={d} value={String(d)}>
              {`After ${LIFETIME_LABEL[d]}`}
            </option>
          ))}
          <option value="never">Never</option>
        </NativeSelect>
      </Field>
      <div className="flex justify-end gap-2 sm:col-span-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending || !name.trim()}>
          Make token
        </Button>
      </div>
    </form>
  );
}

function TokenRow({ token: t }: { token: ApiToken }) {
  const f = useFormat();
  const ws = useWorkspace();
  const revoke = useRevokeApiToken();
  const confirm = useConfirm();
  const day = (iso: string) => todayIn(ws.timezone, new Date(iso));
  const expired = t.expiresAt !== null && new Date(t.expiresAt) <= new Date();
  const details = [
    t.scope === 'read' ? 'Read only' : 'Read and write',
    t.lastUsedAt ? `used ${f.relativeDate(day(t.lastUsedAt)).toLowerCase()}` : 'never used',
    t.expiresAt
      ? `${expired ? 'expired' : 'expires'} ${f.date(day(t.expiresAt), 'medium')}`
      : 'no expiry',
  ];
  if (!t.mine) details.push(`made by ${t.user.name}`);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <KeyRound className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{t.name}</span>
          <code className="hidden shrink-0 text-xs font-normal text-muted-foreground sm:inline">
            {t.hint}…
          </code>
          {expired && <Badge tone="warning">Expired</Badge>}
        </p>
        <p className="text-xs text-muted-foreground">{details.join(' · ')}</p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={revoke.isPending}
        onClick={async () => {
          const ok = await confirm({
            title: `Revoke “${t.name}”?`,
            description: 'Anything using it will stop working straight away.',
            confirmLabel: 'Revoke',
            destructive: true,
          });
          if (!ok) return;
          revoke.mutate(t.id, {
            onSuccess: () => toast.success('Token revoked'),
            onError: (err) => toast.error(errorMessage(err)),
          });
        }}
      >
        Revoke
      </Button>
    </li>
  );
}

function TokensCard() {
  const tokens = useApiTokens();
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Access tokens</CardTitle>
        {!adding && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCreated(null);
              setAdding(true);
            }}
          >
            <Plus /> New token
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        <p className="text-sm text-muted-foreground">
          Let your own scripts, spreadsheets or home automation read your numbers or add
          transactions through the API. A token works only in this workspace, never does more than
          you can, and can’t change members or settings.{' '}
          <a
            href="/api/docs"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            API reference <ExternalLink className="size-3" />
          </a>
        </p>
        {adding && (
          <NewTokenForm
            onCancel={() => setAdding(false)}
            onCreated={(t) => {
              setAdding(false);
              setCreated(t);
            }}
          />
        )}
        {created && <TokenPanel created={created} onClose={() => setCreated(null)} />}
        {tokens.isPending ? (
          <Skeleton className="h-14" />
        ) : tokens.data && tokens.data.length > 0 ? (
          <ul className="divide-y rounded-xl border">
            {tokens.data.map((t) => (
              <TokenRow key={t.id} token={t} />
            ))}
          </ul>
        ) : (
          !adding && <p className="text-sm text-muted-foreground">No tokens yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------------

function useWhen() {
  const f = useFormat();
  const ws = useWorkspace();
  return (iso: string) => {
    const at = new Date(iso);
    const time = at.toLocaleTimeString(f.locale === 'ne' ? 'ne-NP' : 'en-GB', {
      timeZone: ws.timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${f.relativeDate(todayIn(ws.timezone, at))}, ${time}`;
  };
}

function SecretPanel({
  title,
  secret,
  onClose,
}: {
  title: string;
  secret: string;
  onClose: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border border-primary/30 bg-accent/40 p-3">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-sm">
          {title} Use this secret to check that requests really come from here (the
          <code className="mx-1 text-xs">webhook-signature</code> header). It won’t be shown again.
        </p>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          readOnly
          value={secret}
          aria-label="Signing secret"
          onFocus={(e) => e.target.select()}
          className="font-mono text-xs"
        />
        <CopyButton text={secret} />
      </div>
    </div>
  );
}

function EventChoices({
  value,
  onChange,
}: {
  value: WebhookEvent[];
  onChange: (v: WebhookEvent[]) => void;
}) {
  return (
    <fieldset className="grid grid-cols-1 gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">Send when</legend>
      {WEBHOOK_EVENTS.map((e) => (
        <label key={e} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.includes(e)}
            onCheckedChange={(on) => onChange(on ? [...value, e] : value.filter((x) => x !== e))}
          />
          {WEBHOOK_EVENT_LABELS[e]}
        </label>
      ))}
    </fieldset>
  );
}

function NewWebhookForm({
  onCreated,
  onCancel,
}: {
  onCreated: (secret: string) => void;
  onCancel: () => void;
}) {
  const create = useCreateWebhook();
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>([...WEBHOOK_EVENTS]);

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { url: url.trim(), description, events },
      {
        onSuccess: (hook) => onCreated(hook.secret),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 rounded-xl border p-3">
      <Field
        label="Address"
        htmlFor="webhook-url"
        hint="Where to send each change (a POST request)."
      >
        <Input
          id="webhook-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/hooks/expenses"
          required
          autoFocus
        />
      </Field>
      <Field label="Description" htmlFor="webhook-description">
        <Input
          id="webhook-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Family spreadsheet"
          maxLength={100}
        />
      </Field>
      <EventChoices value={events} onChange={setEvents} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending || !url.trim() || events.length === 0}>
          Add webhook
        </Button>
      </div>
    </form>
  );
}

const DELIVERY_TONE = {
  succeeded: 'positive',
  failed: 'destructive',
  pending: 'warning',
} as const;
const DELIVERY_LABEL = { succeeded: 'Delivered', failed: 'Failed', pending: 'Retrying' } as const;

function DeliveryLog({ hook }: { hook: Webhook }) {
  const when = useWhen();
  const deliveries = useWebhookDeliveries(hook.id, true);
  const retry = useRetryWebhookDelivery();
  if (deliveries.isPending) return <Skeleton className="h-12" />;
  const items = deliveries.data ?? [];
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing sent yet.</p>;
  }
  const detail = (d: WebhookDelivery) =>
    [
      d.responseStatus !== null ? `answered ${d.responseStatus}` : d.error,
      d.attempts > 1 ? `${d.attempts} tries` : null,
      d.status === 'pending' && d.nextAttemptAt ? `next ${when(d.nextAttemptAt)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <ul className="divide-y rounded-lg border text-sm" aria-label="Recent deliveries">
      {items.map((d) => (
        <li key={d.id} className="flex items-center gap-3 px-3 py-2">
          <Badge tone={DELIVERY_TONE[d.status]}>{DELIVERY_LABEL[d.status]}</Badge>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs">{d.event}</p>
            <p className="truncate text-xs text-muted-foreground">
              {when(d.createdAt)}
              {detail(d) && ` · ${detail(d)}`}
            </p>
          </div>
          {d.status === 'failed' && hook.enabled && (
            <Button
              size="sm"
              variant="ghost"
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate(
                  { id: hook.id, deliveryId: d.id },
                  {
                    onSuccess: () => toast.success('Sending it again'),
                    onError: (err) => toast.error(errorMessage(err)),
                  },
                )
              }
            >
              <RotateCcw /> Retry
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function WebhookRow({ hook }: { hook: Webhook }) {
  const when = useWhen();
  const update = useUpdateWebhook();
  const remove = useDeleteWebhook();
  const rotate = useRotateWebhookSecret();
  const test = useTestWebhook();
  const confirm = useConfirm();
  const [showLog, setShowLog] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  const state = !hook.enabled ? 'off' : hook.failingSince ? 'failing' : 'on';
  const status = !hook.enabled
    ? (hook.disabledReason ?? 'Turned off')
    : hook.failingSince
      ? `Failing since ${when(hook.failingSince)}`
      : hook.lastSuccessAt
        ? `Last delivered ${when(hook.lastSuccessAt)}`
        : 'Nothing delivered yet';
  const week = [
    hook.recent.succeeded && `${hook.recent.succeeded} delivered`,
    hook.recent.failed && `${hook.recent.failed} failed`,
    hook.recent.pending && `${hook.recent.pending} retrying`,
  ].filter(Boolean);
  const onError = (err: unknown) => toast.error(errorMessage(err));

  return (
    <li className="grid grid-cols-1 gap-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={
            state === 'on'
              ? 'size-2 shrink-0 rounded-full bg-positive'
              : state === 'failing'
                ? 'size-2 shrink-0 rounded-full bg-warning'
                : 'size-2 shrink-0 rounded-full bg-muted-foreground/40'
          }
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{hook.description || hook.url}</p>
          {hook.description && (
            <p className="truncate font-mono text-xs text-muted-foreground">{hook.url}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {status}
            {week.length > 0 && ` · this week: ${week.join(', ')}`}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowLog((v) => !v)}>
          {showLog ? 'Hide log' : 'Log'}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Webhook options">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={test.isPending}
              onSelect={() =>
                test.mutate(hook.id, {
                  onSuccess: (r) =>
                    r.ok
                      ? toast.success(`Test delivered (answered ${r.responseStatus})`)
                      : toast.error(`Test failed: ${r.error}`),
                  onError,
                })
              }
            >
              <Send /> Send a test
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => update.mutate({ id: hook.id, enabled: !hook.enabled }, { onError })}
            >
              {hook.enabled ? 'Turn off' : 'Turn on'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={async () => {
                const ok = await confirm({
                  title: 'Make a new signing secret?',
                  description:
                    'Requests are signed with the new one straight away; update the receiver to match.',
                  confirmLabel: 'New secret',
                });
                if (ok) rotate.mutate(hook.id, { onSuccess: (r) => setSecret(r.secret), onError });
              }}
            >
              <KeyRound /> New secret
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onSelect={async () => {
                const ok = await confirm({
                  title: 'Remove this webhook?',
                  description: 'Nothing more will be sent to it, and its log goes too.',
                  confirmLabel: 'Remove',
                  destructive: true,
                });
                if (ok) remove.mutate(hook.id, { onError });
              }}
            >
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {secret && (
        <SecretPanel title="New secret made." secret={secret} onClose={() => setSecret(null)} />
      )}
      {showLog && <DeliveryLog hook={hook} />}
    </li>
  );
}

function WebhooksCard() {
  const hooks = useWebhooks();
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Webhooks</CardTitle>
        {!adding && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSecret(null);
              setAdding(true);
            }}
          >
            <Plus /> Add webhook
          </Button>
        )}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        <p className="text-sm text-muted-foreground">
          Send each new, changed or deleted transaction to another service as it happens: a
          spreadsheet, Home Assistant, or your own server. Requests are signed, failed ones are
          retried for a day, and transactions in private accounts are never sent.{' '}
          <a
            href="/api/docs#tag/webhooks"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            How to receive them <ExternalLink className="size-3" />
          </a>
        </p>
        {adding && (
          <NewWebhookForm
            onCancel={() => setAdding(false)}
            onCreated={(s) => {
              setAdding(false);
              setSecret(s);
            }}
          />
        )}
        {secret && (
          <SecretPanel title="Webhook added." secret={secret} onClose={() => setSecret(null)} />
        )}
        {hooks.isPending ? (
          <Skeleton className="h-14" />
        ) : hooks.data && hooks.data.length > 0 ? (
          <ul className="divide-y rounded-xl border">
            {hooks.data.map((h) => (
              <WebhookRow key={h.id} hook={h} />
            ))}
          </ul>
        ) : (
          !adding && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <WebhookIcon className="size-4" /> No webhooks yet.
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
