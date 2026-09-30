import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, LogOut } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/menu';
import { authApi, errorMessage } from '@/lib/api';
import { useUpdateMe } from '@/lib/queries';
import { useSession } from '@/lib/session';

export function ProfileSettings() {
  const { me } = useSession();
  const updateMe = useUpdateMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [name, setName] = useState(me.user.name);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [pending, setPending] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');

  async function saveName(e: FormEvent) {
    e.preventDefault();
    updateMe.mutate(
      { name: name.trim() },
      {
        onSuccess: () => toast.success('Name updated'),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      toast.error('Use at least 8 characters');
      return;
    }
    setPending(true);
    try {
      await authApi.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: signOutOthers,
      });
      toast.success('Password changed');
      setCurrent('');
      setNext('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    await authApi.signOut().catch(() => undefined);
    queryClient.clear();
    navigate({ to: '/login', search: {} });
  }

  async function deleteAccount() {
    const ok = await confirm({
      title: 'Delete your account?',
      description:
        'Your login is removed permanently, along with workspaces only you belong to. This can’t be undone.',
      confirmLabel: 'Delete my account',
      destructive: true,
    });
    if (!ok) return;
    try {
      await authApi.deleteUser(deletePassword);
      queryClient.clear();
      navigate({ to: '/signup' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveName} className="grid grid-cols-1 gap-4">
            <Field label="Name" htmlFor="profile-name">
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
              />
            </Field>
            <Field label="Email" htmlFor="profile-email">
              <Input id="profile-email" value={me.user.email} disabled />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={updateMe.isPending || name.trim() === me.user.name}>
                Save
              </Button>
              <Button variant="outline" onClick={signOut}>
                <LogOut /> Sign out
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="grid grid-cols-1 gap-4">
            <Field label="Current password" htmlFor="pw-current">
              <Input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            </Field>
            <Field label="New password" htmlFor="pw-new" hint="At least 8 characters.">
              <Input
                id="pw-new"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={8}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={signOutOthers}
                onCheckedChange={(v) => setSignOutOthers(v === true)}
              />{' '}
              Sign out other devices
            </label>
            <Button type="submit" className="justify-self-start" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Change password
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card className="border-destructive/40 lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-destructive">Delete account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field label="Confirm with your password" htmlFor="delete-password" className="w-64">
            <Input
              id="delete-password"
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
          </Field>
          <Button variant="destructive" onClick={deleteAccount} disabled={!deletePassword}>
            Delete my account
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
