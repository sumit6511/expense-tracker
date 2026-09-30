import type { NotificationSettings as Settings } from '@et/shared';
import { CalendarClock, Mail, Repeat, Target, Trophy } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/card';
import { Switch } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useNotificationSettings, useUpdateNotificationSettings } from '@/lib/queries';
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
      <Card className="self-start">
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
                    To {me.user.email}. Anything you haven’t already seen in the app, a few minutes
                    after it happens.
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
  );
}
