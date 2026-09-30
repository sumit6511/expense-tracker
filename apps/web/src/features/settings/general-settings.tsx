import { formatAdDate, formatBsDate, formatMoney, WEEKDAY_NAMES } from '@et/shared';
import { Loader2, Monitor, Moon, Sun } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { useTheme } from '@/app/theme';
import { CurrencySelect } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Segmented } from '@/components/ui/menu';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useUpdateMe, useUpdateWorkspace } from '@/lib/queries';
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
                <NativeSelect
                  id="set-start"
                  value={monthStartDay}
                  onChange={(e) => setMonthStartDay(Number(e.target.value))}
                  disabled={!canEdit}
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Week starts on" htmlFor="set-week">
                <NativeSelect
                  id="set-week"
                  value={weekStart}
                  onChange={(e) => setWeekStart(Number(e.target.value))}
                  disabled={!canEdit}
                >
                  {WEEKDAY_NAMES.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Time zone" htmlFor="set-tz" hint="Decides when “today” starts.">
                <NativeSelect
                  id="set-tz"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  disabled={!canEdit}
                >
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z.replace('_', ' ')}
                    </option>
                  ))}
                </NativeSelect>
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

      <Card className="self-start">
        <CardHeader>
          <CardTitle>Display (just for you)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-5">
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
                  label: formatMoney(sample, workspace.baseCurrency, { grouping: 'international' }),
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
    </div>
  );
}
