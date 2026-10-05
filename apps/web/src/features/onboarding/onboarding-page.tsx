import {
  ACCOUNT_PRESETS,
  amountInputError,
  type CalendarSystem,
  filterAmountInput,
  formatAdDate,
  formatBsDate,
  formatMoney,
  getCurrency,
  parseAmountInput,
  STARTER_CATEGORY_GROUPS,
  todayIn,
} from '@et/shared';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FullPageSpinner } from '@/app/app-layout';
import { CategoryIcon } from '@/components/icons';
import { CurrencySelect } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import { Field, FilteredInput, Input } from '@/components/ui/input';
import { Checkbox, Segmented, Switch } from '@/components/ui/menu';
import { ApiError, errorMessage } from '@/lib/api';
import { usePageTitle } from '@/lib/page-title';
import { useCreateWorkspace, useMeQuery, useUpdateMe } from '@/lib/queries';
import { rememberWorkspace } from '@/lib/session';
import { cn } from '@/lib/utils';

interface AccountChoice {
  key: string;
  name: string;
  enabled: boolean;
  balance: string;
}

export function OnboardingPage() {
  const me = useMeQuery();
  const navigate = useNavigate();
  const create = useCreateWorkspace();
  const updateMe = useUpdateMe();
  const today = todayIn('Asia/Kathmandu');
  const [step, setStep] = useState(0);
  const [name, setName] = useState('Personal');
  const [currency, setCurrency] = useState('NPR');
  const [calendar, setCalendar] = useState<CalendarSystem>('bs');
  const [grouping, setGrouping] = useState<'lakh' | 'international'>('lakh');
  const [starterCategories, setStarterCategories] = useState(true);
  const [accounts, setAccounts] = useState<AccountChoice[]>(
    ACCOUNT_PRESETS.map((p) => ({
      key: p.key,
      name: p.name,
      enabled: ['cash', 'bank', 'esewa'].includes(p.key),
      balance: '',
    })),
  );

  usePageTitle((me.data?.workspaces.length ?? 0) === 0 ? 'Welcome' : 'New workspace');
  if (me.isPending) return <FullPageSpinner />;
  if (me.error instanceof ApiError && me.error.status === 401)
    return <Navigate to="/login" search={{}} />;
  const isFirst = (me.data?.workspaces.length ?? 0) === 0;

  /** Each balance typed in is a number (a blank one counts as zero). */
  function balancesOk() {
    const digits = getCurrency(currency).digits;
    for (const a of accounts) {
      if (!a.enabled || a.balance.trim() === '') continue;
      const problem = amountInputError(a.balance, digits, { allowNegative: true, allowZero: true });
      if (problem) {
        toast.error(`${a.name.trim() || 'Account'} balance: ${problem}`);
        return false;
      }
    }
    return true;
  }

  async function finish() {
    if (!balancesOk()) return;
    try {
      if (me.data && me.data.user.numberGrouping !== grouping)
        await updateMe.mutateAsync({ numberGrouping: grouping });
      const ws = await create.mutateAsync({
        name: name.trim() || 'Personal',
        baseCurrency: currency,
        calendar,
        starterCategories,
        accounts: accounts
          .filter((a) => a.enabled)
          .map((a) => {
            const preset = ACCOUNT_PRESETS.find((p) => p.key === a.key)!;
            return {
              name: a.name.trim() || preset.name,
              type: preset.type,
              currency,
              openingBalanceMinor:
                parseAmountInput(a.balance || '0', getCurrency(currency).digits) ?? 0,
              icon: preset.icon,
              color: preset.color,
            };
          }),
      });
      rememberWorkspace(ws.id);
      toast.success('You’re all set!');
      navigate({ to: '/' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const steps = ['Basics', 'Accounts', 'Categories'];
  const sampleMinor = 1234567890;

  return (
    <main className="min-h-dvh bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_55%)] px-4 py-8">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10 rounded-xl" />
          <div>
            <h1 className="text-xl font-semibold">
              {isFirst
                ? `Namaste${me.data ? `, ${me.data.user.name.split(' ')[0]}` : ''}!`
                : 'New workspace'}
            </h1>
            <p className="text-sm text-muted-foreground">
              A minute of setup and you’re ready to go.
            </p>
          </div>
        </div>
        <ol className="mb-5 flex gap-2" aria-label="Steps">
          {steps.map((label, i) => (
            <li key={label} className="flex-1">
              <div className={cn('h-1.5 rounded-full', i <= step ? 'bg-primary' : 'bg-muted')} />
              <span
                className={cn(
                  'mt-1.5 block text-xs',
                  i === step ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>

        <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          {step === 0 && (
            <div className="grid grid-cols-1 gap-5">
              <Field
                label="Workspace name"
                htmlFor="ws-name"
                hint="e.g. Personal, Family, Business"
              >
                <Input
                  id="ws-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                />
              </Field>
              <Field
                label="Main currency"
                htmlFor="ws-currency"
                hint="Totals and budgets use this. Each account can have its own currency."
              >
                <CurrencySelect id="ws-currency" value={currency} onChange={setCurrency} />
              </Field>
              <Field
                label="Calendar"
                hint="Budgets follow months of this calendar. You can change it later."
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(
                    [
                      ['bs', 'Bikram Sambat', formatBsDate(today, { style: 'long' })],
                      ['ad', 'Gregorian (AD)', formatAdDate(today, 'long')],
                    ] as const
                  ).map(([value, label, example]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCalendar(value)}
                      aria-pressed={calendar === value}
                      className={cn(
                        'rounded-xl border p-3 text-left transition-colors hover:bg-muted',
                        calendar === value && 'border-primary bg-accent',
                      )}
                    >
                      <span className="flex items-center justify-between text-sm font-medium">
                        {label} {calendar === value && <Check className="size-4 text-primary" />}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Today: {example}
                      </span>
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Number format">
                <Segmented
                  value={grouping}
                  onChange={setGrouping}
                  label="Number format"
                  options={[
                    {
                      value: 'lakh',
                      label: formatMoney(sampleMinor, currency, { grouping: 'lakh' }),
                    },
                    {
                      value: 'international',
                      label: formatMoney(sampleMinor, currency, { grouping: 'international' }),
                    },
                  ]}
                  className="w-full"
                />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-1 gap-3">
              <div>
                <h2 className="font-medium">Where do you keep money?</h2>
                <p className="text-sm text-muted-foreground">
                  Pick what you use. Add the current balance if you know it.
                </p>
              </div>
              <ul className="grid grid-cols-1 gap-2">
                {accounts.map((a) => {
                  const preset = ACCOUNT_PRESETS.find((p) => p.key === a.key)!;
                  const update = (patch: Partial<AccountChoice>) =>
                    setAccounts((list) =>
                      list.map((x) => (x.key === a.key ? { ...x, ...patch } : x)),
                    );
                  return (
                    <li
                      key={a.key}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border p-2.5',
                        a.enabled && 'bg-accent/40',
                      )}
                    >
                      <Checkbox
                        checked={a.enabled}
                        onCheckedChange={(v) => update({ enabled: v === true })}
                        aria-label={`Use ${a.name}`}
                      />
                      <CategoryIcon icon={preset.icon} color={preset.color} size="sm" />
                      <Input
                        value={a.name}
                        onChange={(e) => update({ name: e.target.value, enabled: true })}
                        className="h-9 min-w-0 flex-1"
                        aria-label="Account name"
                        maxLength={80}
                      />
                      <FilteredInput
                        value={a.balance}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="Balance"
                        filter={(text) => filterAmountInput(text, { negative: true })}
                        aria-invalid={
                          a.balance.trim() !== '' &&
                          amountInputError(a.balance, getCurrency(currency).digits, {
                            allowNegative: true,
                            allowZero: true,
                          }) !== null
                        }
                        onValueChange={(balance) => update({ balance, enabled: true })}
                        className="h-9 w-28 tabular"
                        aria-label={`${a.name} balance`}
                      />
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                For a credit card, enter what you owe as a negative number (e.g. -5000).
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-1 gap-4">
              <label className="flex items-start justify-between gap-4">
                <span>
                  <span className="font-medium">Use starter categories</span>
                  <span className="block text-sm text-muted-foreground">
                    A short list made for life in Nepal. Rename or add your own any time.
                  </span>
                </span>
                <Switch checked={starterCategories} onCheckedChange={setStarterCategories} />
              </label>
              {starterCategories && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {STARTER_CATEGORY_GROUPS.map((g) => (
                    <div key={g.name}>
                      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {g.name}
                      </h3>
                      <ul className="grid grid-cols-1 gap-1">
                        {g.categories.map((c) => (
                          <li key={c.name} className="flex items-center gap-2 text-sm">
                            <CategoryIcon icon={c.icon} color={c.color} size="sm" /> {c.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            {step > 0 ? (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft /> Back
              </Button>
            ) : !isFirst ? (
              <Button variant="ghost" onClick={() => navigate({ to: '/' })}>
                Cancel
              </Button>
            ) : (
              <span />
            )}
            {step < steps.length - 1 ? (
              <Button
                onClick={() => {
                  if (step === 1 && !balancesOk()) return;
                  setStep((s) => s + 1);
                }}
              >
                Continue <ArrowRight />
              </Button>
            ) : (
              <Button onClick={finish} disabled={create.isPending}>
                {create.isPending && <Loader2 className="animate-spin" />} Start tracking
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
