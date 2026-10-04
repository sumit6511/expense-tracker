import type { SessionInfo } from '@et/shared';
import { filterIntegerInput, todayIn } from '@et/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Download,
  Ellipsis,
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  Pencil,
  Plus,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { encode } from 'uqr';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  useConfirm,
} from '@/components/ui/dialog';
import { Field, FilteredInput, Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { ApiError, authApi, errorMessage, type Passkey } from '@/lib/api';
import { deviceLabel, isMobileDevice } from '@/lib/device';
import { useFormat } from '@/lib/format';
import { addPasskey, isCancelled, passkeyName, passkeysSupported } from '@/lib/passkeys';
import { meKey, useSessionMutations, useSessions } from '@/lib/queries';
import { useSession, useWorkspace } from '@/lib/session';

// ---------------------------------------------------------------------------------------------
// Two-step sign-in (authenticator app)
// ---------------------------------------------------------------------------------------------

function QrCode({ value }: { value: string }) {
  const path = useMemo(() => {
    const { data } = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    data.forEach((row, y) => {
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { d, size: data.length };
  }, [value]);
  return (
    <svg
      viewBox={`0 0 ${path.size} ${path.size}`}
      className="size-44 rounded-lg border [shape-rendering:crispEdges]"
      role="img"
      aria-label="QR code to scan with your authenticator app"
    >
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  const text = `Expense Tracker backup codes\nEach code works once.\n\n${codes.join('\n')}\n`;
  return (
    <div className="grid grid-cols-1 gap-3">
      <ul
        className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl border bg-muted/40 p-4 font-mono text-sm"
        aria-label="Backup codes"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            toast.success('Backup codes copied');
          }}
        >
          <Copy /> Copy
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'expense-tracker-backup-codes.txt';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download /> Download
        </Button>
      </div>
    </div>
  );
}

function PasswordForm({
  id,
  submitLabel,
  destructive,
  onSubmit,
  children,
}: {
  id: string;
  submitLabel: string;
  destructive?: boolean;
  onSubmit: (password: string) => Promise<void>;
  children?: ReactNode;
}) {
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit(password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4">
      {children}
      <Field label="Your password" htmlFor={id}>
        <Input
          id={id}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} {submitLabel}
        </Button>
      </div>
    </form>
  );
}

type Setup =
  | { step: 'password' }
  | { step: 'scan'; totpURI: string; backupCodes: string[] }
  | { step: 'codes'; backupCodes: string[] };

function SetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [state, setState] = useState<Setup>({ step: 'password' });
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setState({ step: 'password' });
      setCode('');
      setError(null);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (state.step !== 'scan') return;
    setPending(true);
    setError(null);
    try {
      await authApi.twoFactor.verifyTotp(code.replace(/\s/g, ''));
      await qc.invalidateQueries({ queryKey: meKey });
      setState({ step: 'codes', backupCodes: state.backupCodes });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'That code didn’t work. Check the time on your phone is right, and try the newest code.'
          : errorMessage(err),
      );
    } finally {
      setPending(false);
    }
  }

  const secret =
    state.step === 'scan' ? (new URL(state.totpURI).searchParams.get('secret') ?? '') : '';

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state.step === 'codes' ? 'Save your backup codes' : 'Turn on two-step sign-in'}
          </DialogTitle>
          <DialogDescription>
            {state.step === 'password'
              ? 'After your password, you’ll also enter a code from an authenticator app on your phone.'
              : state.step === 'scan'
                ? 'Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the code it shows.'
                : 'Two-step sign-in is on. If you lose your phone, each of these codes gets you in once. Keep them somewhere safe.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-6">
          {state.step === 'password' && (
            <PasswordForm
              id="tfa-password"
              submitLabel="Continue"
              onSubmit={async (password) => {
                const res = await authApi.twoFactor.enable(password);
                setState({ step: 'scan', ...res });
              }}
            />
          )}
          {state.step === 'scan' && (
            <form onSubmit={verify} className="grid grid-cols-1 gap-4">
              <div className="grid grid-cols-1 justify-items-center gap-2">
                <QrCode value={state.totpURI} />
                <p className="text-center text-xs text-muted-foreground">
                  Can’t scan? Enter this key instead:
                  <br />
                  <span className="font-mono text-sm text-foreground select-all">
                    {secret.match(/.{1,4}/g)?.join(' ')}
                  </span>
                </p>
              </div>
              <Field label="6-digit code" htmlFor="tfa-code">
                <FilteredInput
                  id="tfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  filter={(text) => filterIntegerInput(text, 6)}
                  onValueChange={setCode}
                  className="text-center text-lg tracking-[0.3em] tabular"
                />
              </Field>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="submit" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" />} Turn on
                </Button>
              </div>
            </form>
          )}
          {state.step === 'codes' && (
            <div className="grid grid-cols-1 gap-4">
              <BackupCodes codes={state.backupCodes} />
              <div className="flex justify-end gap-2 pt-1">
                <Button onClick={() => close(false)}>I’ve saved them</Button>
              </div>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function NewCodesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [codes, setCodes] = useState<string[] | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setCodes(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New backup codes</DialogTitle>
          <DialogDescription>
            {codes
              ? 'Your old codes no longer work. Keep these somewhere safe.'
              : 'This replaces your current backup codes; the old ones stop working.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-6">
          {codes ? (
            <BackupCodes codes={codes} />
          ) : (
            <PasswordForm
              id="codes-password"
              submitLabel="Make new codes"
              onSubmit={async (password) => {
                setCodes((await authApi.twoFactor.newBackupCodes(password)).backupCodes);
              }}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Turn off two-step sign-in?</DialogTitle>
          <DialogDescription>
            Signing in will only need your password (or a passkey).
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-6">
          <PasswordForm
            id="disable-password"
            submitLabel="Turn off"
            destructive
            onSubmit={async (password) => {
              await authApi.twoFactor.disable(password);
              await qc.invalidateQueries({ queryKey: meKey });
              onOpenChange(false);
              toast.success('Two-step sign-in is off');
            }}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function TwoFactorCard() {
  const { me } = useSession();
  const on = me.user.twoFactorEnabled;
  const [dialog, setDialog] = useState<'setup' | 'codes' | 'disable' | null>(null);
  const set = (d: typeof dialog) => (o: boolean) => setDialog(o ? d : null);
  return (
    <Card>
      <CardHeader className="justify-start">
        <CardTitle>Two-step sign-in</CardTitle>
        {on && (
          <Badge tone="positive">
            <ShieldCheck className="size-3.5" /> On
          </Badge>
        )}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        <p className="text-sm text-muted-foreground">
          {on
            ? 'Signing in with your password also asks for a code from your authenticator app.'
            : 'Protect your account even if someone learns your password: after it, also enter a code from an authenticator app on your phone.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {on ? (
            <>
              <Button variant="outline" onClick={() => setDialog('codes')}>
                New backup codes
              </Button>
              <Button variant="ghost" onClick={() => setDialog('disable')}>
                Turn off
              </Button>
            </>
          ) : (
            <Button onClick={() => setDialog('setup')}>
              <ShieldCheck /> Turn on
            </Button>
          )}
        </div>
      </CardContent>
      <SetupDialog open={dialog === 'setup'} onOpenChange={set('setup')} />
      <NewCodesDialog open={dialog === 'codes'} onOpenChange={set('codes')} />
      <DisableDialog open={dialog === 'disable'} onOpenChange={set('disable')} />
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------------------------

const passkeysKey = ['passkeys'] as const;

function RenameDialog({
  passkey,
  onOpenChange,
}: {
  passkey: Passkey | null;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (passkey) setName(passkey.name ?? '');
  }, [passkey]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!passkey) return;
    setPending(true);
    try {
      await authApi.passkey.rename(passkey.id, name.trim());
      await qc.invalidateQueries({ queryKey: passkeysKey });
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open={passkey !== null} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Rename passkey</DialogTitle>
        </DialogHeader>
        <DialogBody className="pb-6">
          <form onSubmit={submit} className="grid grid-cols-1 gap-4">
            <Field label="Name" htmlFor="passkey-name">
              <Input
                id="passkey-name"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="submit" disabled={pending || !name.trim()}>
                Save
              </Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function PasskeysCard() {
  const qc = useQueryClient();
  const f = useFormat();
  const confirm = useConfirm();
  const list = useQuery({ queryKey: passkeysKey, queryFn: authApi.passkey.list });
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Passkey | null>(null);
  const supported = passkeysSupported();

  async function add() {
    setAdding(true);
    try {
      await addPasskey(passkeyName());
      await qc.invalidateQueries({ queryKey: passkeysKey });
      toast.success('Passkey added. Next time, sign in with it instead of your password.');
    } catch (err) {
      if (isCancelled(err)) return;
      toast.error(
        err instanceof ApiError && err.status === 403
          ? 'For your security, sign out and back in, then add the passkey.'
          : errorMessage(err),
      );
    } finally {
      setAdding(false);
    }
  }

  async function remove(p: Passkey) {
    const ok = await confirm({
      title: `Remove “${p.name || 'Passkey'}”?`,
      description:
        'You won’t be able to sign in with it any more. The copy on your device stays until you delete it there.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await authApi.passkey.remove(p.id);
      await qc.invalidateQueries({ queryKey: passkeysKey });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passkeys</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        <p className="text-sm text-muted-foreground">
          Sign in with your fingerprint, face or screen lock instead of a password. Passkeys can’t
          be phished or leaked.
        </p>
        {list.isPending ? (
          <Skeleton className="h-14" />
        ) : list.data && list.data.length > 0 ? (
          <ul className="divide-y rounded-xl border">
            {list.data.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name || 'Passkey'}</p>
                  <p className="text-xs text-muted-foreground">
                    Added {f.date(p.createdAt.slice(0, 10))} ·{' '}
                    {p.backedUp ? 'Synced across your devices' : 'On one device'}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${p.name || 'Passkey'} options`}
                    >
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setRenaming(p)}>
                      <Pencil /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem destructive onSelect={() => remove(p)}>
                      <Trash2 /> Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        ) : null}
        <div>
          <Button variant="outline" onClick={add} disabled={!supported || adding}>
            {adding ? <Loader2 className="animate-spin" /> : <Plus />} Add a passkey
          </Button>
          {!supported && (
            <p className="mt-2 text-xs text-muted-foreground">
              This browser doesn’t support passkeys.
            </p>
          )}
        </div>
      </CardContent>
      <RenameDialog passkey={renaming} onOpenChange={(o) => !o && setRenaming(null)} />
    </Card>
  );
}

/** "Active today" rather than "Active Today". */
const lower = (s: string) => (/^(Today|Yesterday)$/.test(s) ? s.toLowerCase() : s);

const SESSIONS_SHOWN = 5;

function SessionsCard() {
  const f = useFormat();
  const { timezone } = useWorkspace();
  // The day a timestamp falls on in the workspace's time zone, like every other date here.
  const day = (iso: string) => todayIn(timezone, new Date(iso));
  const confirm = useConfirm();
  const sessions = useSessions();
  const { revoke, signOutOthers } = useSessionMutations();
  const [showAll, setShowAll] = useState(false);
  const all = sessions.data ?? [];
  const others = all.filter((s) => !s.current);
  // This device first, then the most recently used; the rest on request.
  const shown = showAll ? all : all.slice(0, SESSIONS_SHOWN);

  async function signOutOne(s: SessionInfo) {
    try {
      await revoke.mutateAsync(s.id);
      toast.success(`Signed out ${deviceLabel(s.userAgent ?? '')}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function signOutRest() {
    const ok = await confirm({
      title: 'Sign out everywhere else?',
      description: `${others.length} other device${others.length === 1 ? '' : 's'} will need your password (or passkey) to sign in again. This one stays signed in.`,
      confirmLabel: 'Sign out others',
      destructive: true,
    });
    if (!ok) return;
    try {
      const { signedOut } = await signOutOthers.mutateAsync();
      toast.success(`Signed out of ${signedOut} other device${signedOut === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where you’re signed in</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        <p className="text-sm text-muted-foreground">
          Don’t recognise one, or lost a phone? Sign it out, then change your password.
        </p>
        {sessions.isPending ? (
          <Skeleton className="h-28" />
        ) : sessions.error ? (
          <p className="text-sm text-destructive">{errorMessage(sessions.error)}</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {shown.map((s) => {
              const Icon = isMobileDevice(s.userAgent ?? '') ? Smartphone : Monitor;
              return (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                      <span className="truncate">{deviceLabel(s.userAgent ?? '')}</span>
                      {s.current && <Badge tone="primary">This device</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        s.ipAddress,
                        s.current
                          ? 'Active now'
                          : `Active ${lower(f.relativeDate(day(s.lastActiveAt)))}`,
                        `signed in ${f.date(day(s.createdAt))}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {!s.current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => signOutOne(s)}
                      disabled={revoke.isPending}
                    >
                      Sign out
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {all.length > SESSIONS_SHOWN && (
          <button
            type="button"
            className="justify-self-start text-sm font-medium text-primary hover:underline"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? 'Show fewer' : `Show all ${all.length}`}
          </button>
        )}
        {others.length > 0 && (
          <div>
            <Button variant="outline" onClick={signOutRest} disabled={signOutOthers.isPending}>
              {signOutOthers.isPending ? <Loader2 className="animate-spin" /> : <LogOut />} Sign out
              everywhere else
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SecuritySettings() {
  return (
    <>
      <TwoFactorCard />
      <PasskeysCard />
      <SessionsCard />
    </>
  );
}
