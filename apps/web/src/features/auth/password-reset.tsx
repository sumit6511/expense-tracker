import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Loader2, MailCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { ApiError, authApi, errorMessage } from '@/lib/api';
import { useSignInOptions } from '@/lib/queries';
import { forgetDevice } from '@/lib/sign-out';
import { AuthShell } from './auth-pages';

const backToSignIn = (
  <Link to="/login" search={{}} className="font-medium text-primary hover:underline">
    Back to sign in
  </Link>
);

/** "Forgot password?": emails a link to choose a new one (when the server can send email). */
export function ForgotPasswordPage() {
  const { email: given } = useSearch({ from: '/forgot-password' });
  const options = useSignInOptions();
  const [email, setEmail] = useState(given ?? '');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await authApi.requestPasswordReset(email.trim());
      setSentTo(email.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  if (options.isPending) {
    return (
      <AuthShell title="Reset your password" subtitle="" footer={backToSignIn}>
        <div className="grid place-items-center py-6">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      </AuthShell>
    );
  }

  if (!options.data?.passwordReset) {
    return (
      <AuthShell
        title="Reset your password"
        subtitle="This server can’t send email, so it can’t send you a reset link."
        footer={backToSignIn}
      >
        <p className="text-sm">
          Ask the person who runs this Expense Tracker to reset your password. They can do it from
          the server in a minute and give you a temporary one to sign in with.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          If you added a passkey to this account, you can still sign in with it.
        </p>
      </AuthShell>
    );
  }

  if (sentTo) {
    return (
      <AuthShell title="Check your email" subtitle="" footer={backToSignIn}>
        <div className="grid grid-cols-1 justify-items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
            <MailCheck className="size-6" />
          </span>
          <p className="text-sm">
            If an account uses <strong className="break-all">{sentTo}</strong>, we’ve sent it a link
            to choose a new password. The link works for an hour.
          </p>
          <p className="text-xs text-muted-foreground">
            Nothing arrived? Check your spam folder, or try again in a minute.
          </p>
          <Button variant="outline" size="sm" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We’ll email you a link to choose a new one."
      footer={backToSignIn}
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
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}

/** Where the emailed link lands: choose a new password. */
export function ResetPasswordPage() {
  const { token } = useSearch({ from: '/reset-password' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(!token);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters for your password.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setPending(true);
    setError(null);
    try {
      await authApi.resetPassword(token!, password);
      // Every session was signed out, this device's included.
      await forgetDevice(queryClient);
      toast.success('Password changed. Sign in with your new password.');
      navigate({ to: '/login', search: {} });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && /token/i.test(err.message)) {
        setExpired(true);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  }

  if (expired) {
    return (
      <AuthShell
        title="This link has expired"
        subtitle="Reset links work for an hour, and only once."
        footer={backToSignIn}
      >
        <Button asChild size="lg" className="w-full">
          <Link to="/forgot-password" search={{}}>
            Send a new link
          </Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="You’ll be signed out everywhere else."
      footer={backToSignIn}
    >
      <form onSubmit={submit} className="grid grid-cols-1 gap-4">
        <Field label="New password" htmlFor="new-password" hint="At least 8 characters.">
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Type it again" htmlFor="confirm-password">
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            maxLength={128}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Set new password
        </Button>
      </form>
    </AuthShell>
  );
}
