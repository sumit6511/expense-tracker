import { useNavigate } from '@tanstack/react-router';
import { Download, FileJson, Loader2, TriangleAlert, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/dialog';
import { api, errorMessage } from '@/lib/api';
import { useDeleteWorkspace, useRestoreBackup } from '@/lib/queries';
import { rememberWorkspace, useSession } from '@/lib/session';
import { downloadBlob } from '@/lib/utils';

export function DataSettings() {
  const { workspace, me } = useSession();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const restore = useRestoreBackup();
  const remove = useDeleteWorkspace();
  const fileRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);

  async function downloadBackup() {
    setDownloading(true);
    try {
      const backup = await api<unknown>(`/workspaces/${workspace.id}/backup`);
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(
        new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
        `expense-tracker-${date}.json`,
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  async function onRestoreFile(file: File | undefined) {
    if (!file) return;
    let backup: unknown;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      toast.error('That file isn’t a valid backup (not JSON).');
      return;
    }
    const ok = await confirm({
      title: 'Restore this backup?',
      description:
        'It’s restored into a new workspace, so nothing you have now is changed or overwritten.',
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    try {
      const ws = await restore.mutateAsync({ backup });
      rememberWorkspace(ws.id);
      toast.success(`Restored as “${ws.name}”`);
      window.location.assign('/');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function deleteWorkspace() {
    const ok = await confirm({
      title: `Delete “${workspace.name}” forever?`,
      description:
        'All its accounts, transactions, budgets and settings are permanently deleted. Download a backup first if you might need them.',
      confirmLabel: 'Delete workspace',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync();
      const next = me.workspaces.find((w) => w.id !== workspace.id);
      if (next) rememberWorkspace(next.id);
      toast.success('Workspace deleted');
      navigate({ to: next ? '/' : '/onboarding' });
      window.location.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3">
          <p className="text-sm text-muted-foreground">
            Your data is yours. Download everything at any time; nothing is locked in.
          </p>
          <Button variant="outline" className="justify-start" asChild>
            <a href={`/api/v1/workspaces/${workspace.id}/export/transactions.csv`}>
              <Download /> Transactions as CSV (opens in Excel)
            </a>
          </Button>
          <Button
            variant="outline"
            className="justify-start"
            onClick={downloadBackup}
            disabled={downloading}
          >
            {downloading ? <Loader2 className="animate-spin" /> : <FileJson />} Full backup (JSON)
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Restore</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3">
          <p className="text-sm text-muted-foreground">
            Restore a JSON backup into a new workspace. Great for moving to another server.
          </p>
          <Button
            variant="outline"
            className="justify-start"
            onClick={() => fileRef.current?.click()}
            disabled={restore.isPending}
          >
            {restore.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Choose backup
            file…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              onRestoreFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </CardContent>
      </Card>
      {workspace.role === 'owner' && (
        <Card className="border-destructive/40 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="size-4" /> Danger zone
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Permanently delete this workspace and everything in it.
            </p>
            <Button variant="destructive" onClick={deleteWorkspace} disabled={remove.isPending}>
              Delete workspace
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
