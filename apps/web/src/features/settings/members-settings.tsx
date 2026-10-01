import {
  type AssignableRole,
  canManageMember,
  canManageMembers,
  INVITATION_DAYS,
  type InvitationCreated,
  type Member,
  ROLE_DESCRIPTIONS,
  type Role,
  roleWithArticle,
} from '@et/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Check,
  Copy,
  Crown,
  Ellipsis,
  Link2,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { UserAvatar } from '@/components/person';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { Select, SelectItem } from '@/components/ui/select';
import { api, errorMessage } from '@/lib/api';
import {
  meKey,
  useInvite,
  useMembers,
  useRemoveMember,
  useRenewInvitation,
  useRevokeInvitation,
  useTransferOwnership,
  useUpdateMember,
} from '@/lib/queries';
import { rememberWorkspace, useSession } from '@/lib/session';

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};
const ASSIGNABLE: AssignableRole[] = ['admin', 'editor', 'viewer'];

function daysLeft(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/** The link to share after inviting someone (shown once; only a hash is kept on the server). */
function LinkPanel({ created, onClose }: { created: InvitationCreated; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl border border-primary/30 bg-accent/40 p-3">
      <div className="flex items-start gap-2">
        <Link2 className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 text-sm">
          {created.emailed ? (
            <>
              We emailed an invitation to <strong>{created.invitation.email}</strong>. You can also
              send them this link:
            </>
          ) : (
            <>
              Send this link to <strong>{created.invitation.email}</strong> (by message or email).
              It works for {INVITATION_DAYS} days, for that address only.
            </>
          )}
        </p>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          readOnly
          value={created.link}
          aria-label="Invitation link"
          onFocus={(e) => e.target.select()}
          className="font-mono text-xs"
        />
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(created.link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

function MemberRow({ m, me }: { m: Member; me: Role }) {
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const transfer = useTransferOwnership();
  const confirm = useConfirm();
  const manageable = !m.you && canManageMember(me, m.role);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <UserAvatar id={m.userId} name={m.name} avatar={m.avatar} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {m.name}
          {m.you && <span className="font-normal text-muted-foreground"> (you)</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{m.email}</p>
      </div>
      {manageable ? (
        <Select
          value={m.role}
          aria-label={`Role for ${m.name}`}
          className="h-8 w-28 text-[13px]"
          disabled={update.isPending}
          onValueChange={(v) =>
            update.mutate(
              { userId: m.userId, role: v as AssignableRole },
              {
                onSuccess: () =>
                  toast.success(`${m.name} is now ${roleWithArticle(v as AssignableRole)}`),
                onError: (err) => toast.error(errorMessage(err)),
              },
            )
          }
        >
          {ASSIGNABLE.map((r) => (
            <SelectItem key={r} value={r}>
              {ROLE_LABEL[r]}
            </SelectItem>
          ))}
        </Select>
      ) : (
        <Badge tone={m.role === 'owner' ? 'primary' : 'neutral'}>
          {m.role === 'owner' && <Crown className="size-3" />} {ROLE_LABEL[m.role]}
        </Badge>
      )}
      {manageable && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`${m.name} options`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {me === 'owner' && (
              <DropdownMenuItem
                onSelect={async () => {
                  const ok = await confirm({
                    title: `Make ${m.name} the owner?`,
                    description:
                      'They’ll be able to delete the workspace and manage everyone. You’ll become an admin.',
                    confirmLabel: 'Make owner',
                  });
                  if (!ok) return;
                  transfer.mutate(m.userId, {
                    onSuccess: () => toast.success(`${m.name} is now the owner`),
                    onError: (err) => toast.error(errorMessage(err)),
                  });
                }}
              >
                <Crown /> Make owner
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              destructive
              onSelect={async () => {
                const ok = await confirm({
                  title: `Remove ${m.name}?`,
                  description:
                    'They lose access to this workspace. Transactions they added stay, marked as theirs.',
                  confirmLabel: 'Remove',
                  destructive: true,
                });
                if (!ok) return;
                remove.mutate(m.userId, {
                  onSuccess: () => toast.success(`${m.name} was removed`),
                  onError: (err) => toast.error(errorMessage(err)),
                });
              }}
            >
              <UserMinus /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function InviteCard({ onCreated }: { onCreated: (c: InvitationCreated) => void }) {
  const invite = useInvite();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('editor');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const created = await invite.mutateAsync({ email: email.trim(), role });
      onCreated(created);
      setEmail('');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3">
      <Field label="Email address" htmlFor="invite-email">
        <Input
          id="invite-email"
          type="email"
          required
          autoComplete="off"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Role" htmlFor="invite-role" hint={`${ROLE_DESCRIPTIONS[role]}.`}>
        <div className="flex gap-2">
          <Select
            id="invite-role"
            value={role}
            onValueChange={(v) => setRole(v as AssignableRole)}
            className="flex-1"
          >
            {ASSIGNABLE.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </Select>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />} Invite
          </Button>
        </div>
      </Field>
    </form>
  );
}

export function MembersSettings() {
  const { workspace, me: session, switchWorkspace } = useSession();
  const members = useMembers();
  const renew = useRenewInvitation();
  const revoke = useRevokeInvitation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [leaving, setLeaving] = useState(false);
  const manager = canManageMembers(workspace.role);

  async function leave() {
    const ok = await confirm({
      title: `Leave “${workspace.name}”?`,
      description: 'You’ll lose access until someone invites you again.',
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (!ok) return;
    setLeaving(true);
    try {
      await api<void>(`/me/workspaces/${workspace.id}`, { method: 'DELETE' });
      const next = session.workspaces.find((w) => w.id !== workspace.id);
      if (next) {
        rememberWorkspace(next.id);
        switchWorkspace(next.id);
      }
      await qc.invalidateQueries({ queryKey: meKey });
      toast.success(`You left “${workspace.name}”`);
      navigate({ to: next ? '/' : '/onboarding' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
      <div className="grid grid-cols-1 content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>People in “{workspace.name}”</CardTitle>
          </CardHeader>
          {members.isPending ? (
            <CardContent>
              <Skeleton className="h-24" />
            </CardContent>
          ) : (
            <ul className="divide-y border-t">
              {members.data?.members.map((m) => (
                <MemberRow key={m.userId} m={m} me={workspace.role} />
              ))}
            </ul>
          )}
        </Card>

        {manager && (members.data?.invitations.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Waiting to join</CardTitle>
            </CardHeader>
            <ul className="divide-y border-t">
              {members.data?.invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed text-muted-foreground">
                    <Mail className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {ROLE_LABEL[i.role]} ·{' '}
                      {i.expired ? (
                        <span className="text-destructive">Link expired</span>
                      ) : (
                        `Link works for ${daysLeft(i.expiresAt)} more day${daysLeft(i.expiresAt) === 1 ? '' : 's'}`
                      )}
                      {i.invitedByName && ` · Invited by ${i.invitedByName}`}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={renew.isPending}
                    onClick={() =>
                      renew.mutate(i.id, {
                        onSuccess: setCreated,
                        onError: (err) => toast.error(errorMessage(err)),
                      })
                    }
                  >
                    <RefreshCw /> New link
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      revoke.mutate(i.id, {
                        onSuccess: () => toast.success('Invitation cancelled'),
                        onError: (err) => toast.error(errorMessage(err)),
                      })
                    }
                  >
                    Cancel
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 content-start gap-4">
        {manager && (
          <Card>
            <CardHeader>
              <CardTitle>Invite someone</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4">
              <p className="text-sm text-muted-foreground">
                Share this workspace with your family or partner. Everyone sees the same accounts,
                budgets and reports, and each transaction shows who added it.
              </p>
              <InviteCard onCreated={setCreated} />
              {created && <LinkPanel created={created} onClose={() => setCreated(null)} />}
            </CardContent>
          </Card>
        )}
        {workspace.role !== 'owner' && (
          <Card>
            <CardHeader>
              <CardTitle>Leave this workspace</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              <p className="text-sm text-muted-foreground">
                You’re {roleWithArticle(workspace.role)} here. Leaving doesn’t delete anything you
                added.
              </p>
              <Button
                variant="outline"
                className="justify-self-start"
                onClick={leave}
                disabled={leaving}
              >
                {leaving ? <Loader2 className="animate-spin" /> : <LogOut />} Leave workspace
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
