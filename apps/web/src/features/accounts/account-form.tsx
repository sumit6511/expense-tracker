import {
  ACCOUNT_PRESETS,
  ACCOUNT_TYPE_LABELS,
  type Account,
  type AccountType,
  COLOR_SWATCHES,
  parseAmountInput,
  toDecimalString,
} from '@et/shared';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { DatePicker } from '@/components/date-picker';
import { ICON_NAMES, iconFor } from '@/components/icons';
import { AmountInput, CurrencySelect } from '@/components/pickers';
import { Button } from '@/components/ui/button';
import {
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Segmented, Switch } from '@/components/ui/menu';
import { Select, SelectItem } from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useCreateAccount, useMemberNames, useUpdateAccount } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const ACCOUNT_ICONS = [
  'wallet',
  'landmark',
  'piggy-bank',
  'smartphone',
  'credit-card',
  'banknote',
  'coins',
  'building-2',
  'trending-up',
  'hand-coins',
  'globe',
  'briefcase',
];

export function AccountFormDialog({
  account,
  onDone,
}: {
  account?: Account;
  onDone: (account: Account) => void;
}) {
  const f = useFormat();
  const create = useCreateAccount();
  const update = useUpdateAccount();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking');
  const [currency, setCurrency] = useState(account?.currency ?? f.base);
  const digits = f.digits(currency);
  const [opening, setOpening] = useState(
    account ? toDecimalString(account.openingBalanceMinor, f.digits(account.currency)) : '',
  );
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? f.today);
  const [creditLimit, setCreditLimit] = useState(
    account?.creditLimitMinor
      ? toDecimalString(account.creditLimitMinor, f.digits(account.currency))
      : '',
  );
  const [institution, setInstitution] = useState(account?.institution ?? '');
  const preset = ACCOUNT_PRESETS.find((p) => p.type === type);
  const [icon, setIcon] = useState(account?.icon ?? preset?.icon ?? 'wallet');
  const [color, setColor] = useState(account?.color ?? preset?.color ?? COLOR_SWATCHES[0]!);
  const [onBudget, setOnBudget] = useState(account?.onBudget ?? true);
  const [inNetWorth, setInNetWorth] = useState(account?.inNetWorth ?? true);
  const [visibility, setVisibility] = useState(account?.visibility ?? 'shared');
  const { me } = useSession();
  const people = useMemberNames();
  // Only worth asking in a shared workspace (or to undo a private account).
  const askVisibility = people !== null || account?.visibility === 'private';
  const canChangeVisibility = !account || account.ownerUserId === me.user.id;
  const ownerName = account?.ownerUserId ? people?.get(account.ownerUserId) : undefined;
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const openingMinor = opening.trim() ? parseAmountInput(opening, digits) : 0;
    if (openingMinor === null) return setError('Opening balance is not a number');
    const limitMinor = creditLimit.trim() ? parseAmountInput(creditLimit, digits) : null;
    if (creditLimit.trim() && limitMinor === null) return setError('Credit limit is not a number');
    const body = {
      name: name.trim(),
      type,
      openingBalanceMinor: openingMinor,
      openingDate,
      creditLimitMinor: type === 'credit_card' ? limitMinor : null,
      institution: institution.trim() || null,
      icon,
      color,
      onBudget,
      inNetWorth,
      ...(canChangeVisibility && { visibility }),
    };
    if (!body.name) return setError('Give the account a name');
    try {
      const saved = account
        ? await update.mutateAsync({ id: account.id, ...body })
        : await create.mutateAsync({ ...body, currency });
      toast.success(account ? 'Account updated' : 'Account added');
      onDone(saved);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <DialogContent aria-describedby={undefined}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogHeader>
          <DialogTitle>{account ? 'Edit account' : 'New account'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid grid-cols-1 gap-4">
          <Field label="Name" htmlFor="acct-name">
            <Input
              id="acct-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder="e.g. Nabil Bank, eSewa"
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Type" htmlFor="acct-type">
              <Select
                id="acct-type"
                value={type}
                onValueChange={(v) => {
                  const next = v as AccountType;
                  setType(next);
                  const p = ACCOUNT_PRESETS.find((x) => x.type === next);
                  if (!account && p) {
                    setIcon(p.icon);
                    setColor(p.color);
                  }
                }}
              >
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </Select>
            </Field>
            <Field
              label="Currency"
              htmlFor="acct-currency"
              hint={account ? 'Can’t change after creation' : undefined}
            >
              <CurrencySelect
                id="acct-currency"
                value={currency}
                onChange={setCurrency}
                disabled={!!account}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Starting balance"
              htmlFor="acct-opening"
              hint={
                type === 'credit_card' || type === 'loan'
                  ? 'Money owed is negative, e.g. -5000'
                  : undefined
              }
            >
              <AmountInput
                id="acct-opening"
                value={opening}
                onChange={setOpening}
                currency={currency}
                placeholder="0"
              />
            </Field>
            <Field label="As of" htmlFor="acct-date">
              <DatePicker id="acct-date" value={openingDate} onChange={setOpeningDate} />
            </Field>
          </div>
          {type === 'credit_card' && (
            <Field label="Credit limit" htmlFor="acct-limit">
              <AmountInput
                id="acct-limit"
                value={creditLimit}
                onChange={setCreditLimit}
                currency={currency}
                placeholder="Optional"
              />
            </Field>
          )}
          <Field label="Bank or provider" htmlFor="acct-institution">
            <Input
              id="acct-institution"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <div className="grid grid-cols-1 gap-2">
            <span className="text-[13px] font-medium">Icon & colour</span>
            <div className="flex flex-wrap gap-1.5">
              {ACCOUNT_ICONS.filter((n) => ICON_NAMES.includes(n)).map((n) => {
                const Icon = iconFor(n);
                return (
                  <button
                    key={n}
                    type="button"
                    aria-label={n}
                    aria-pressed={icon === n}
                    onClick={() => setIcon(n)}
                    className={cn(
                      'grid grid-cols-1 size-9 place-items-center rounded-lg border hover:bg-muted',
                      icon === n && 'border-primary bg-accent',
                    )}
                    style={{ color }}
                  >
                    <Icon className="size-4" />
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'size-7 rounded-full ring-offset-2 ring-offset-popover',
                    color === c && 'ring-2 ring-foreground',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              Include in budgets
              <span className="block text-xs text-muted-foreground">
                Spending from this account counts toward budgets.
              </span>
            </span>
            <Switch checked={onBudget} onCheckedChange={setOnBudget} />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>Include in net worth</span>
            <Switch checked={inNetWorth} onCheckedChange={setInNetWorth} />
          </label>
          {askVisibility && (
            <Field
              label="Who can see it"
              hint={
                !canChangeVisibility
                  ? `Only ${ownerName ?? 'the person who added it'} can change this.`
                  : visibility === 'private'
                    ? 'Others in this workspace won’t see it, its balance or its transactions, and it’s left out of their reports and budgets.'
                    : 'Everyone in this workspace sees it and its transactions.'
              }
            >
              <Segmented
                value={visibility}
                onChange={setVisibility}
                label="Who can see it"
                disabled={!canChangeVisibility}
                options={[
                  { value: 'shared', label: 'Everyone here' },
                  { value: 'private', label: 'Only me' },
                ]}
                className="w-full"
              />
            </Field>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} {account ? 'Save' : 'Add account'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
