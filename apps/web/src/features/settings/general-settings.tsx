import { formatAdDate, formatBsDate, formatMoney, WEEKDAY_NAMES } from '@et/shared';
import { Loader2, Monitor, Moon, Sparkles, Sun } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { useTheme } from '@/app/theme';
import { CurrencySelect } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { Segmented, Switch } from '@/components/ui/menu';
import { Select, SelectItem } from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useAiStatus, useUpdateMe, useUpdateWorkspace } from '@/lib/queries';
import { useSession } from '@/lib/session';

const TIME_ZONES = [
  'Asia/Kathmandu',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Qatar',
  'Asia/Riyadh',
  'Asia/Kuala_Lumpur',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Europe/London',
  'America/New_York',
  'Australia/Sydney',
  'UTC',
];

export function GeneralSettings() {
  const { me, workspace } = useSession();
  const f = useFormat();
  const update = useUpdateWorkspace();
  const updateMe = useUpdateMe();
  const { preference, setPreference } = useTheme();
  const canEdit = workspace.role === 'owner' || workspace.role === 'admin';
  const [name, setName] = useState(workspace.name);
  const [baseCurrency, setBaseCurrency] = useState(workspace.baseCurrency);
  const [calendar, setCalendar] = useState(workspace.calendar);
  const [monthStartDay, setMonthStartDay] = useState(workspace.monthStartDay);
  const [weekStart, setWeekStart] = useState(workspace.weekStart);
  const [timezone, setTimezone] = useState(workspace.timezone);
  const [budgetMode, setBudgetMode] = useState(workspace.budgetMode);

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        name: name.trim(),
        baseCurrency,
        calendar,
        monthStartDay,
        weekStart,
        timezone,
        budgetMode,
      });
      toast.success('Settings saved');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const sample = 1234567890;
  const zones = TIME_ZONES.includes(workspace.timezone)
    ? TIME_ZONES
    : [workspace.timezone, ...TIME_ZONES];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid grid-cols-1 gap-4">
            <Field label="Name" htmlFor="set-name">
              <Input
                id="set-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canEdit}
                maxLength={60}
              />
            </Field>
            <Field
              label="Main currency"
              htmlFor="set-currency"
              hint="Totals, budgets and reports are shown in this currency."
            >
              <CurrencySelect
                id="set-currency"
                value={baseCurrency}
                onChange={setBaseCurrency}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Calendar" hint="Budget months follow this calendar.">
              <Segmented
                value={calendar}
                onChange={setCalendar}
                label="Calendar"
                options={[
                  {
                    value: 'bs',
                    label: `Bikram Sambat · ${formatBsDate(f.today, { style: 'short' })}`,
                  },
                  { value: 'ad', label: `Gregorian · ${formatAdDate(f.today, 'short')}` },
                ]}
                className="w-full"
              />
            </Field>
            <Field
              label="Budgeting style"
              hint={
                budgetMode === 'envelope'
                  ? 'Assign the money you have to categories until nothing is left (“Ready to assign”). Leftovers stay in their category; overspending comes out of next month. Starts fresh from this month.'
                  : 'Set a budget per category each month and see what’s left.'
              }
            >
              <Segmented
                value={budgetMode}
                onChange={setBudgetMode}
                label="Budgeting style"
                options={[
                  { value: 'tracking', label: 'Monthly budgets' },
                  { value: 'envelope', label: 'Envelope' },
                ]}
                className="w-full"
                disabled={!canEdit}
              />
            </Field>
            {calendar === 'ad' && (
              <Field
                label="Budget month starts on day"
                htmlFor="set-start"
                hint="Useful if you’re paid on a fixed day, e.g. the 25th."
              >
                <Select
                  id="set-start"
                  value={String(monthStartDay)}
                  onValueChange={(v) => setMonthStartDay(Number(v))}
                  disabled={!canEdit}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}
                    </SelectItem>
                  ))}
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Week starts on" htmlFor="set-week">
                <Select
                  id="set-week"
                  value={String(weekStart)}
                  onValueChange={(v) => setWeekStart(Number(v))}
                  disabled={!canEdit}
                >
                  {WEEKDAY_NAMES.map((d, i) => (
                    <SelectItem key={d} value={String(i)}>
                      {d}
                    </SelectItem>
                  ))}
                </Select>
              </Field>
              <Field label="Time zone" htmlFor="set-tz" hint="Decides when “today” starts.">
                <Select
                  id="set-tz"
                  value={timezone}
                  onValueChange={setTimezone}
                  disabled={!canEdit}
                >
                  {zones.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </Select>
              </Field>
            </div>
            {canEdit && (
              <Button type="submit" className="justify-self-start" disabled={update.isPending}>
                {update.isPending && <Loader2 className="animate-spin" />} Save
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Display (just for you)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5">
            <Field label="Language">
              <Segmented
                value={me.user.locale}
                onChange={(locale) =>
                  updateMe.mutate({ locale }, { onError: (err) => toast.error(errorMessage(err)) })
                }
                label="Language"
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ne', label: 'नेपाली' },
                ]}
                className="w-full"
              />
            </Field>
            <Field label="Number format">
              <Segmented
                value={me.user.numberGrouping}
                onChange={(numberGrouping) =>
                  updateMe.mutate(
                    { numberGrouping },
                    { onError: (err) => toast.error(errorMessage(err)) },
                  )
                }
                label="Number format"
                options={[
                  {
                    value: 'lakh',
                    label: formatMoney(sample, workspace.baseCurrency, { grouping: 'lakh' }),
                  },
                  {
                    value: 'international',
                    label: formatMoney(sample, workspace.baseCurrency, {
                      grouping: 'international',
                    }),
                  },
                ]}
                className="w-full"
              />
            </Field>
            <Field label="Theme">
              <Segmented
                value={preference}
                onChange={setPreference}
                label="Theme"
                options={[
                  {
                    value: 'light',
                    label: (
                      <span className="flex items-center justify-center gap-1.5">
                        <Sun className="size-4" /> Light
                      </span>
                    ),
                  },
                  {
                    value: 'dark',
                    label: (
                      <span className="flex items-center justify-center gap-1.5">
                        <Moon className="size-4" /> Dark
                      </span>
                    ),
                  },
                  {
                    value: 'system',
                    label: (
                      <span className="flex items-center justify-center gap-1.5">
                        <Monitor className="size-4" /> Auto
                      </span>
                    ),
                  },
                ]}
                className="w-full"
              />
            </Field>
          </CardContent>
        </Card>
        <AiCard canEdit={canEdit} />
      </div>
    </div>
  );
}

/** Opt in to the AI helpers, with a plain account of what gets sent where. */
function AiCard({ canEdit }: { canEdit: boolean }) {
  const { workspace } = useSession();
  const status = useAiStatus();
  const update = useUpdateWorkspace();
  const data = status.data;
  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> AI helpers
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 text-sm">
        {!data.available ? (
          <p className="text-muted-foreground">
            Not set up on this server. Whoever runs it can add a Claude API key (ANTHROPIC_API_KEY)
            to offer them.
          </p>
        ) : (
          <>
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block font-medium">Use AI helpers in this workspace</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Scan receipts, read PDF statements, suggest categories, answer questions about
                  your money, and help quick add when the rules can’t read what you typed.
                </span>
              </span>
              <Switch
                checked={workspace.aiEnabled}
                disabled={!canEdit || update.isPending}
                onCheckedChange={(aiEnabled) =>
                  update.mutate(
                    { aiEnabled },
                    {
                      onSuccess: () =>
                        toast.success(aiEnabled ? 'AI helpers are on' : 'AI helpers are off'),
                      onError: (err) => toast.error(errorMessage(err)),
                    },
                  )
                }
              />
            </label>
            <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">What’s shared, and with whom</p>
              <p className="mt-1">
                Nothing is sent until someone uses a helper. Then {data.provider} gets what that
                helper needs: the receipt, statement, sentence or question itself, your account and
                category names, and for questions the report figures that answer them. Never your
                whole history. Results are drafts you check before saving.
              </p>
            </div>
            {workspace.aiEnabled && (
              <p className="text-xs text-muted-foreground">
                Used today: {data.usedToday} of {data.dailyLimit} requests.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
