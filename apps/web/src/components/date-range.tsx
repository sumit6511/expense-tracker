import {
  addDays,
  type CalendarSystem,
  getFiscalYear,
  getMonthPeriod,
  getYearRange,
  type IsoDate,
  type PeriodSettings,
  shiftMonthPeriod,
} from '@et/shared';
import { CalendarRange, Check } from 'lucide-react';
import { useState } from 'react';
import { useFormat } from '@/lib/format';
import { useWorkspace } from '@/lib/session';
import { cn } from '@/lib/utils';
import { CalendarGrid } from './date-picker';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/menu';

export interface DateRangeValue {
  from?: IsoDate;
  to?: IsoDate;
}

export interface RangePreset {
  id: string;
  label: string;
  range: (today: IsoDate) => { from: IsoDate; to: IsoDate } | Record<string, never>;
}

/** Presets that follow the workspace calendar (BS months, Nepal fiscal year). */
export function rangePresets(
  settings: PeriodSettings & { calendar: CalendarSystem },
): RangePreset[] {
  const month = (today: IsoDate, delta: number) => {
    const p = shiftMonthPeriod(getMonthPeriod(today, settings), delta, settings);
    return { from: p.start, to: p.end };
  };
  return [
    { id: 'this-month', label: 'This month', range: (t) => month(t, 0) },
    { id: 'last-month', label: 'Last month', range: (t) => month(t, -1) },
    {
      id: 'last-3',
      label: 'Last 3 months',
      range: (t) => ({
        from: shiftMonthPeriod(getMonthPeriod(t, settings), -2, settings).start,
        to: getMonthPeriod(t, settings).end,
      }),
    },
    {
      id: 'last-6',
      label: 'Last 6 months',
      range: (t) => ({
        from: shiftMonthPeriod(getMonthPeriod(t, settings), -5, settings).start,
        to: getMonthPeriod(t, settings).end,
      }),
    },
    {
      id: 'last-12',
      label: 'Last 12 months',
      range: (t) => ({
        from: shiftMonthPeriod(getMonthPeriod(t, settings), -11, settings).start,
        to: getMonthPeriod(t, settings).end,
      }),
    },
    {
      id: 'this-year',
      label: settings.calendar === 'bs' ? 'This year (BS)' : 'This year',
      range: (t) => {
        const y = getYearRange(t, settings.calendar);
        return { from: y.start, to: y.end };
      },
    },
    {
      id: 'fiscal-year',
      label: 'This fiscal year',
      range: (t) => {
        const fy = getFiscalYear(t);
        return { from: fy.start, to: fy.end };
      },
    },
    { id: 'last-30', label: 'Last 30 days', range: (t) => ({ from: addDays(t, -29), to: t }) },
    { id: 'all', label: 'All time', range: () => ({}) },
  ];
}

export function DateRangePicker({
  value,
  onChange,
  allowAllTime = true,
  className,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  allowAllTime?: boolean;
  className?: string;
}) {
  const ws = useWorkspace();
  const f = useFormat();
  const presets = rangePresets({ calendar: ws.calendar, monthStartDay: ws.monthStartDay }).filter(
    (p) => allowAllTime || p.id !== 'all',
  );
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<'from' | 'to' | null>(null);
  const active = presets.find((p) => {
    const r = p.range(f.today) as DateRangeValue;
    return r.from === value.from && r.to === value.to;
  });
  const label = active
    ? active.label
    : value.from || value.to
      ? `${value.from ? f.date(value.from, 'short') : '…'} – ${value.to ? f.date(value.to, 'medium') : '…'}`
      : 'All time';

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCustom(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('font-normal', className)}>
          <CalendarRange className="text-muted-foreground" /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">
        {custom ? (
          <div className="p-1">
            <p className="mb-2 text-sm font-medium">
              {custom === 'from' ? 'Start date' : 'End date'}
            </p>
            <CalendarGrid
              value={(custom === 'from' ? value.from : value.to) ?? f.today}
              calendar={ws.calendar}
              weekStart={ws.weekStart}
              onSelect={(d) => {
                if (custom === 'from') {
                  onChange({ from: d, to: value.to && value.to >= d ? value.to : undefined });
                  setCustom('to');
                } else {
                  onChange({ from: value.from && value.from <= d ? value.from : undefined, to: d });
                  setCustom(null);
                  setOpen(false);
                }
              }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 w-52 gap-0.5">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p.range(f.today) as DateRangeValue);
                  setOpen(false);
                }}
                className="flex h-9 items-center justify-between rounded-lg px-2.5 text-left text-sm hover:bg-muted"
              >
                {p.label}
                {active?.id === p.id && <Check className="size-4 text-primary" strokeWidth={3} />}
              </button>
            ))}
            <div className="mt-1 border-t pt-1">
              <button
                type="button"
                onClick={() => setCustom('from')}
                className="flex h-9 w-full items-center rounded-lg px-2.5 text-left text-sm hover:bg-muted"
              >
                Custom range…
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
