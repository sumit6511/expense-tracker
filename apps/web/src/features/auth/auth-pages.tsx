import { filterIntegerInput } from '@et/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { KeyRound, Loader2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FilteredInput, Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/menu';
import { ApiError, authApi, errorMessage } from '@/lib/api';
import { isCancelled, passkeysSupported, signInWithPasskey } from '@/lib/passkeys';
import { meKey } from '@/lib/queries';

/** A same-site path to continue to after signing in (never another site). */
function safeNext(next: string | undefined) {
  return next?.startsWith('/') && !next.startsWith('//') ? next : null;
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_60%)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/favicon.svg" alt="" className="mb-4 size-12 rounded-2xl shadow-sm" />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm">{children}</div>
        <p className="mt-4 text-center text-sm text-muted-foreground">{footer}</p>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { next, email: invited } = useSearch({ from: '/login' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(invited ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);
  // After the password, people with two-step sign-in enter a code.
  const [step, setStep] = useState<'password' | 'code'>('password');

  async function signedIn() {
    await queryClient.invalidateQueries({ queryKey: meKey });
    navigate({ to: safeNext(next) ?? '/' });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await authApi.signIn({ email: email.trim(), password, rememberMe: true });
      if (res.twoFactorRedirect) {
        setPassword('');
        setStep('code');
        return;
      }
      await signedIn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function passkey() {
    setPasskeyPending(true);
    setError(null);
    try {
      await signInWithPasskey();
      await signedIn();
    } catch (err) {
      if (!isCancelled(err)) setError(errorMessage(err));
    } finally {
      setPasskeyPending(false);
    }
  }

  if (step === 'code') {
    return (
      <AuthShell
        title="Two-step sign-in"
        subtitle="One more step to keep your account safe."
        footer={
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => setStep('password')}
          >
            Back to sign in
          </button>
        }
      >
        <CodeForm onDone={signedIn} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to see where your money goes."
      footer={
        <>
          New here?{' '}
          <Link
            to="/signup"
            search={{ next, email: invited }}
            className="font-medium text-primary hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="grid grid-cols-1 gap-4">
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Link
            to="/forgot-password"
            search={{ email: email.trim() || undefined }}
            className="justify-self-end text-xs font-medium text-primary hover:underline"
          >
            Forgot password?
          </Link>
        </Field>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Sign in
        </Button>
      </form>
      {passkeysSupported() && (
        <>
          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={passkey}
            disabled={passkeyPending}
          >
            {passkeyPending ? <Loader2 className="animate-spin" /> : <KeyRound />} Sign in with a
            passkey
          </Button>
        </>
      )}
    </AuthShell>
  );
}

/** The second step: a code from the authenticator app, or a backup code. */
function CodeForm({ onDone }: { onDone: () => Promise<void> }) {
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (useBackup) await authApi.twoFactor.verifyBackupCode(code.trim(), trust);
      else await authApi.twoFactor.verifyTotp(code.replace(/\s/g, ''), trust);
      await onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'That code didn’t work. Check it and try again.'
          : errorMessage(err),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4">
      {useBackup ? (
        <Field
          label="Backup code"
          htmlFor="code"
          hint="One of the codes you saved when you turned on two-step sign-in. Each works once."
        >
          <Input
            id="code"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
        </Field>
      ) : (
        <Field
          label="Code from your authenticator app"
          htmlFor="code"
          hint="Open the app (Google Authenticator, Microsoft Authenticator, 1Password…) and enter the 6-digit code."
        >
          <FilteredInput
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            filter={(text) => filterIntegerInput(text, 6)}
            onValueChange={setCode}
            className="text-center text-lg tracking-[0.3em] tabular"
            autoFocus
          />
        </Field>
      )}
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={trust} onCheckedChange={(v) => setTrust(v === true)} /> Don’t ask again
        on this device for 30 days
      </label>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Verify
      </Button>
      <button
        type="button"
        className="justify-self-center text-sm text-muted-foreground hover:text-foreground hover:underline"
        onClick={() => {
          setUseBackup((b) => !b);
          setCode('');
          setError(null);
        }}
      >
        {useBackup ? 'Use the authenticator app instead' : 'Can’t use the app? Use a backup code'}
      </button>
    </form>
  );
}

export function SignupPage() {
  const { next, email: invited } = useSearch({ from: '/signup' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(invited ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await authApi.signUp({ name: name.trim(), email: email.trim(), password });
      await queryClient.invalidateQueries({ queryKey: meKey });
      // Coming from an invitation: go back to it to join (instead of setting up a workspace).
      navigate({ to: safeNext(next) ?? '/onboarding' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free, private, and built for NPR and Bikram Sambat."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            search={{ next, email: invited }}
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="grid grid-cols-1 gap-4">
        <Field label="Your name" htmlFor="name">
          <Input
            id="name"
            maxLength={80}
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 8 characters.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Create account
        </Button>
      </form>
    </AuthShell>
  );
}
