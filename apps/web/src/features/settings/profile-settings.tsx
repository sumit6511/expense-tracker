import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LogOut, TriangleAlert } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { authApi, errorMessage } from '@/lib/api';
import { useUpdateMe } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { forgetDevice, useSignOut } from '@/lib/sign-out';
import { useUnsavedChanges } from '@/lib/unsaved-changes';
import { ProfilePicture } from './avatar-picker';

export function ProfileSettings() {
  const { me } = useSession();
  const updateMe = useUpdateMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [name, setName] = useState(me.user.name);
  const [deletePassword, setDeletePassword] = useState('');
  useUnsavedChanges(name.trim() !== me.user.name);

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

  const signOut = useSignOut();

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
      await forgetDevice(queryClient);
      navigate({ to: '/signup' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="grid max-w-2xl grid-cols-1 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5">
          <ProfilePicture />
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
              <Button variant="outline" onClick={() => void signOut()}>
                <LogOut /> Sign out
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="size-4" /> Delete account
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <p className="basis-full text-sm text-muted-foreground">
            Permanently delete your account and your private accounts. Workspaces you share stay
            with the other members; ones only you use are deleted.
          </p>
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
