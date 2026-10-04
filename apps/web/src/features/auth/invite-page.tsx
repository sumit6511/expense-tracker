import {
  type InvitationPreview,
  type Me,
  ROLE_DESCRIPTIONS,
  roleWithArticle,
  type Workspace,
} from '@et/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Loader2, MailWarning, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, api, errorMessage } from '@/lib/api';
import { meKey } from '@/lib/queries';
import { rememberWorkspace } from '@/lib/session';
import { useSignOut } from '@/lib/sign-out';
import { AuthShell } from './auth-pages';

/** Where an invitation link lands: who invited you to what, then sign in (or up) and join. */
export function InvitePage() {
  const { token } = useParams({ from: '/invite/$token' });
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Signed in or not, without the app's usual "please sign in" redirect.
  const me = useQuery({
    queryKey: ['invite-session'],
    queryFn: async () => {
      try {
        return await api<Me>('/me', { quiet401: true });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    // Coming back after signing up or in: check again.
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api<InvitationPreview>(`/invitations/${token}`),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setPending(true);
    setError(null);
    try {
      const ws = await api<Workspace>(`/invitations/${token}/accept`, { method: 'POST' });
      rememberWorkspace(ws.id);
      await qc.invalidateQueries({ queryKey: meKey });
      navigate({ to: '/' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const signOutNow = useSignOut();
  const signOut = () => signOutNow({ next: `/invite/${token}`, email: preview.data?.email });

  if (preview.isPending || me.isPending) {
    return (
      <div className="grid min-h-dvh grid-cols-1 place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  if (preview.error || !preview.data) {
    const missing = preview.error instanceof ApiError && preview.error.status === 404;
    return (
      <AuthShell
        title={missing ? 'This link doesn’t work' : 'Couldn’t open the invitation'}
        subtitle={
          missing
            ? 'It may have been cancelled, or replaced by a newer link. Ask for a new invitation.'
            : errorMessage(preview.error)
        }
        footer={
          <Link to="/" className="font-medium text-primary hover:underline">
            Go to the app
          </Link>
        }
      >
        <div className="grid grid-cols-1 justify-items-center py-2 text-muted-foreground">
          <MailWarning className="size-8" />
        </div>
      </AuthShell>
    );
  }

  const inv = preview.data;
  const user = me.data?.user ?? null;
  const next = `/invite/${token}`;
  const from = inv.invitedByName ?? 'Someone';
  const alreadyMember = me.data?.workspaces.some((w) => w.id === inv.workspaceId) ?? false;

  return (
    <AuthShell
      title={`Join “${inv.workspaceName}”`}
      subtitle={`${from} invited you as ${roleWithArticle(inv.role)}.`}
      footer={
        user ? (
          <>
            Signed in as {user.email}.{' '}
            <button
              type="button"
              onClick={signOut}
              className="font-medium text-primary hover:underline"
            >
              Use another account
            </button>
          </>
        ) : null
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <div className="flex items-start gap-3 rounded-xl bg-muted/50 p-3 text-sm">
          <UsersRound className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            As {roleWithArticle(inv.role)}: {ROLE_DESCRIPTIONS[inv.role].toLowerCase()}.
          </p>
        </div>

        {inv.status === 'expired' ? (
          <p className="text-sm text-destructive" role="alert">
            This invitation has expired. Ask {from} to send a new one.
          </p>
        ) : inv.status === 'accepted' && !alreadyMember ? (
          <p className="text-sm text-destructive" role="alert">
            This invitation has already been used.
          </p>
        ) : !user ? (
          <>
            <p className="text-sm text-muted-foreground">
              Create an account (or sign in) with{' '}
              <strong className="text-foreground">{inv.email}</strong> to join.
            </p>
            <Button size="lg" asChild>
              <Link to="/signup" search={{ next, email: inv.email }}>
                Create an account
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/login" search={{ next, email: inv.email }}>
                I already have an account
              </Link>
            </Button>
          </>
        ) : user.email.toLowerCase() !== inv.email && !alreadyMember ? (
          <p className="text-sm text-destructive" role="alert">
            This invitation is for {inv.email}, but you’re signed in as {user.email}. Use another
            account below.
          </p>
        ) : (
          <>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button size="lg" onClick={join} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}{' '}
              {alreadyMember ? 'Open the workspace' : `Join “${inv.workspaceName}”`}
            </Button>
          </>
        )}
      </div>
    </AuthShell>
  );
}
