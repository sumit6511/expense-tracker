import { useQueryClient } from '@tanstack/react-query';
import { CloudOff, Loader2, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useFormat } from '@/lib/format';
import { flushOutbox, outbox, retryOutboxItem, useOutbox } from '@/lib/outbox';

/**
 * Sends transactions recorded offline as soon as the connection is back (and every 30 s while
 * any are waiting), and shows what's still waiting or was refused.
 */
export function OutboxBanner() {
  const items = useOutbox();
  const qc = useQueryClient();
  const f = useFormat();
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    const { sent } = await flushOutbox();
    setSyncing(false);
    if (sent > 0) {
      await qc.invalidateQueries({ queryKey: ['ws'] });
      toast.success(`Synced ${sent} transaction${sent === 1 ? '' : 's'} recorded offline`);
    }
  }, [qc]);

  const pending = items.filter((i) => !i.error);
  useEffect(() => {
    const up = () => {
      setOnline(true);
      sync();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [sync]);
  useEffect(() => {
    if (pending.length === 0) return;
    sync();
    const timer = setInterval(sync, 30_000);
    return () => clearInterval(timer);
  }, [pending.length, sync]);

  const failed = items.filter((i) => i.error);
  if (items.length === 0 && online) return null;

  return (
    <div className="mb-4 grid grid-cols-1 gap-2" aria-live="polite">
      {(pending.length > 0 || !online) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
          <CloudOff className="size-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            {!online && pending.length === 0
              ? 'You’re offline. New expenses are saved on this device until you reconnect.'
              : `${pending.length} transaction${pending.length === 1 ? '' : 's'} saved on this device${online ? ', syncing…' : ', waiting for a connection'}.`}
          </span>
          {online && pending.length > 0 && (
            <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
              {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
            </Button>
          )}
        </div>
      )}
      {failed.map((item) => (
        <div
          key={item.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm"
          role="alert"
        >
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            Couldn’t save {f.money(item.body.amountMinor)}
            {item.body.payee ? ` · ${item.body.payee}` : ''} from {f.date(item.body.date)}:{' '}
            {item.error}
          </span>
          <Button size="sm" variant="outline" onClick={() => retryOutboxItem(item.id)}>
            <RefreshCw /> Retry
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => outbox.remove(item.id)}
            aria-label="Discard this transaction"
          >
            <X /> Discard
          </Button>
        </div>
      ))}
    </div>
  );
}
