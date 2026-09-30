import type { NotificationSettings as Settings } from '@et/shared';
import {
  CalendarClock,
  Lightbulb,
  Mail,
  Repeat,
  Send,
  Smartphone,
  Target,
  Trophy,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import { Switch } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import {
  currentSubscription,
  deviceLabel,
  PushError,
  pushSupport,
  subscribeThisDevice,
  unsubscribeThisDevice,
} from '@/lib/push';
import {
  useNotificationSettings,
  usePushMutations,
  usePushSettings,
  useUpdateNotificationSettings,
} from '@/lib/queries';
import { useSession } from '@/lib/session';

type Key = Exclude<keyof Settings, 'emailAvailable'>;

const KINDS: Array<{ key: Key; icon: ReactNode; label: string; hint: string }> = [
  {
    key: 'bills',
    icon: <CalendarClock />,
    label: 'Bills coming due',
    hint: 'Recurring items you record by hand, a few days before they’re due (set per item).',
  },
  {
    key: 'budgets',
    icon: <Target />,
    label: 'Budgets running low',
    hint: 'When a category or your monthly limit is 90% used, and when it’s over.',
  },
  {
    key: 'recurring',
    icon: <Repeat />,
    label: 'Recorded automatically',
    hint: 'When recurring items set to record themselves are added.',
  },
  {
    key: 'goals',
    icon: <Trophy />,
    label: 'Goals reached',
    hint: 'When a savings goal hits its target.',
  },
  {
    key: 'insights',
    icon: <Lightbulb />,
    label: 'Heads-ups',
    hint: 'When upcoming bills could take an account below zero, or a subscription’s price changes.',
  },
];

function Row({
  icon,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  hint: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-[18px]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}

export function NotificationSettings() {
  const { me } = useSession();
  const settings = useNotificationSettings();
  const update = useUpdateNotificationSettings();

  function set(key: Key, value: boolean) {
    update.mutate({ [key]: value }, { onError: (err) => toast.error(errorMessage(err)) });
  }

  const data = settings.data;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>What to tell you about</CardTitle>
        </CardHeader>
        <CardContent>
          {!data ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="divide-y">
              {KINDS.map((k) => (
                <Row
                  key={k.key}
                  icon={k.icon}
                  label={k.label}
                  hint={k.hint}
                  checked={data[k.key]}
                  onChange={(v) => set(k.key, v)}
                />
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            These apply to every workspace you belong to. Notifications appear under the bell.
          </p>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 content-start gap-4">
        <PushCard />
        <Card>
          <CardHeader>
            <CardTitle>Email</CardTitle>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-16" />
            ) : (
              <Row
                icon={<Mail />}
                label="Also send by email"
                hint={
                  data.emailAvailable ? (
                    <>
                      To {me.user.email}. Anything you haven’t already seen in the app, a few
                      minutes after it happens.
                    </>
                  ) : (
                    'This server isn’t set up to send email. Ask whoever runs it to configure SMTP.'
                  )
                }
                checked={data.email && data.emailAvailable}
                disabled={!data.emailAvailable}
                onChange={(v) => set('email', v)}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type DeviceState = 'loading' | 'on' | 'off';

/** Push notifications on this device, and the other devices that get them. */
function PushCard() {
  const f = useFormat();
  const settings = usePushSettings();
  const push = usePushMutations();
  const support = pushSupport();
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (support !== 'supported') return setEndpoint(null);
    currentSubscription()
      .then((sub) => setEndpoint(sub?.endpoint ?? null))
      .catch(() => setEndpoint(null));
  }, [support]);

  const data = settings.data;
  if (data && !data.available) return null;
  const devices = data?.devices ?? [];
  // On only if this browser is subscribed and the server still has it.
  const state: DeviceState =
    endpoint === undefined || !data
      ? 'loading'
      : endpoint && devices.some((d) => d.endpoint === endpoint)
        ? 'on'
        : 'off';
  const others = devices.filter((d) => d.endpoint !== endpoint);

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      if (on) {
        const sub = await subscribeThisDevice(data!.publicKey!);
        await push.subscribe.mutateAsync({
          endpoint: sub.endpoint!,
          keys: { p256dh: sub.keys!.p256dh!, auth: sub.keys!.auth! },
          label: deviceLabel(),
        });
        setEndpoint(sub.endpoint!);
        toast.success('Push notifications are on for this device');
      } else {
        const gone = await unsubscribeThisDevice();
        if (gone) await push.unsubscribe.mutateAsync(gone);
        setEndpoint(null);
      }
    } catch (err) {
      toast.error(err instanceof PushError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const blocked = support === 'supported' && Notification.permission === 'denied';
  const hint =
    support !== 'supported'
      ? 'This browser can’t show notifications from the app. On iPhone and iPad, add the app to your Home Screen first, then open it from there.'
      : blocked
        ? 'Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.'
        : state === 'on'
          ? 'Bills, budgets and heads-ups show up here even when the app is closed.'
          : 'Get bills, budgets and heads-ups on this device, even when the app is closed.';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push notifications</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        {!data ? (
          <Skeleton className="h-16" />
        ) : (
          <>
            <Row
              icon={<Smartphone />}
              label="On this device"
              hint={hint}
              checked={state === 'on'}
              disabled={support !== 'supported' || blocked || busy || state === 'loading'}
              onChange={toggle}
            />
            {state === 'on' && (
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={push.test.isPending}
                  onClick={() =>
                    push.test.mutate(undefined, {
                      onSuccess: ({ sent }) =>
                        toast.success(sent === 1 ? 'Test sent' : `Test sent to ${sent} devices`),
                      onError: (err) => toast.error(errorMessage(err)),
                    })
                  }
                >
                  <Send /> Send a test
                </Button>
              </div>
            )}
            {others.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Your other devices</p>
                <ul className="divide-y rounded-lg border">
                  {others.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {d.label || 'A device'}
                        <span className="ml-2 text-xs text-muted-foreground">
                          since {f.date(d.createdAt.slice(0, 10), 'short')}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          push.remove.mutate(d.id, {
                            onError: (err) => toast.error(errorMessage(err)),
                          })
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
