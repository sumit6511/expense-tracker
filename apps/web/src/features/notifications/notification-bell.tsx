import type { Notification, NotificationKind } from '@et/shared';
import { Link, useRouter } from '@tanstack/react-router';
import {
  Bell,
  BellOff,
  CalendarClock,
  CheckCheck,
  Lightbulb,
  type LucideIcon,
  Repeat,
  Settings,
  Target,
  Trophy,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menu';
import { type Formatters, useFormat } from '@/lib/format';
import { useMarkNotificationsRead, useNotifications } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const KIND: Record<NotificationKind, { icon: LucideIcon; tone: string }> = {
  bill: { icon: CalendarClock, tone: 'bg-primary/10 text-primary' },
  budget: { icon: Target, tone: 'bg-warning/15 text-warning' },
  recurring: { icon: Repeat, tone: 'bg-muted text-muted-foreground' },
  goal: { icon: Trophy, tone: 'bg-positive/10 text-positive' },
  insight: { icon: Lightbulb, tone: 'bg-warning/15 text-warning' },
};

function timeAgo(iso: string, f: Formatters) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return f.date(iso.slice(0, 10), 'short');
}

/** Bell with an unread count that opens the latest notifications. */
export function NotificationBell({
  align = 'start',
  className,
}: {
  align?: 'start' | 'end';
  className?: string;
}) {
  const { workspace } = useSession();
  const { data } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const router = useRouter();
  const f = useFormat();
  const [open, setOpen] = useState(false);
  const unread = data?.unreadCount ?? 0;

  function openItem(n: Notification) {
    if (!n.read) markRead.mutate({ ids: [n.id] });
    setOpen(false);
    if (n.link) router.history.push(n.link);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('relative shrink-0', className)}
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground tabular">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="flex max-h-[min(32rem,calc(100dvh-6rem))] w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col p-0"
      >
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 ml-auto h-7 text-xs"
              onClick={() => markRead.mutate({ workspaceId: workspace.id })}
            >
              <CheckCheck /> Mark all read
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!data ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : data.items.length === 0 ? (
            <div className="grid grid-cols-1 justify-items-center gap-1.5 px-6 py-8 text-center">
              <BellOff className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">You’re all caught up</p>
              <p className="text-xs text-muted-foreground">
                Bills coming due, budgets running low, automatic entries and goals reached show up
                here.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {data.items.map((n) => {
                const { icon: Icon, tone } = KIND[n.kind];
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    >
                      <span
                        className={cn(
                          'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full [&_svg]:size-4',
                          tone,
                        )}
                      >
                        <Icon />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block text-sm',
                            n.read ? 'text-muted-foreground' : 'font-medium',
                          )}
                        >
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {n.body}
                          </span>
                        )}
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {timeAgo(n.createdAt, f)}
                        </span>
                      </span>
                      {!n.read && (
                        <span className="mt-2 size-2 shrink-0 rounded-full bg-primary">
                          <span className="sr-only">Unread</span>
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t px-2 py-1.5">
          <Button variant="ghost" size="sm" className="w-full justify-start text-xs" asChild>
            <Link to="/settings" search={{ tab: 'notifications' }} onClick={() => setOpen(false)}>
              <Settings /> Notification settings
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
