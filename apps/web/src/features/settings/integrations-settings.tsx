import {
  type ApiToken,
  type CreatedApiToken,
  TOKEN_LIFETIMES,
  type TokenScope,
  todayIn,
} from '@et/shared';
import { Check, Copy, ExternalLink, KeyRound, Plus, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useApiTokens, useCreateApiToken, useRevokeApiToken } from '@/lib/queries';
import { useCanWrite, useWorkspace } from '@/lib/session';

export function IntegrationsSettings() {
  return (
    <div className="grid grid-cols-1 gap-5">
      <TokensCard />
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
