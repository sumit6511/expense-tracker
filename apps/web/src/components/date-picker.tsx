import {
  AD_MONTH_NAMES,
  adDaysInMonth,
  addDays,
  adToBs,
  BS_MONTH_NAMES,
  bsDaysInMonth,
  bsToAd,
  type CalendarSystem,
  dayOfWeek,
  type IsoDate,
  isBsSupported,
  parseIsoDate,
  toIsoDate,
  WEEKDAY_NAMES,
} from '@et/shared';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useFormat } from '@/lib/format';
import { useWorkspace } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger, Segmented } from './ui/menu';

interface MonthView {
  calendar: CalendarSystem;
  year: number;
  month: number;
}

function viewFor(date: IsoDate, calendar: CalendarSystem): MonthView {
  if (calendar === 'bs' && isBsSupported(date)) {
    const { year, month } = adToBs(date);
    return { calendar, year, month };
  }
  const { year, month } = parseIsoDate(date);
  return { calendar: 'ad', year, month };
}

function shiftView(view: MonthView, delta: number): MonthView {
  const index = view.year * 12 + view.month - 1 + delta;
  return { ...view, year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function monthDays(view: MonthView): { first: IsoDate; count: number } | null {
  try {
    if (view.calendar === 'bs') {
      return {
        first: bsToAd({ year: view.year, month: view.month, day: 1 }),
        count: bsDaysInMonth(view.year, view.month),
      };
    }
    return {
      first: toIsoDate({ year: view.year, month: view.month, day: 1 }),
      count: adDaysInMonth(view.year, view.month),
    };
  } catch {
    return null; // outside the Bikram Sambat table
  }
}

/** A month grid that works in Bikram Sambat or Gregorian; the value is always an AD date. */
export function CalendarGrid({
  value,
  onSelect,
  calendar: initialCalendar,
  weekStart = 0,
  max,
}: {
  value: IsoDate;
  onSelect: (date: IsoDate) => void;
  calendar: CalendarSystem;
  weekStart?: number;
  max?: IsoDate;
}) {
  const f = useFormat();
  const [view, setView] = useState<MonthView>(() => viewFor(value, initialCalendar));
  const days = monthDays(view);
  const title =
    view.calendar === 'bs'
      ? `${BS_MONTH_NAMES[view.month - 1]} ${view.year}`
      : `${AD_MONTH_NAMES[view.month - 1]} ${view.year}`;
  // The same span in the other calendar, e.g. "Sep – Oct 2026" under "Asoj 2083".
  const subtitle = view.calendar === 'bs' ? adMonthSpan(days) : bsMonthSpan(days);
  const lead = days ? (dayOfWeek(days.first) - weekStart + 7) % 7 : 0;
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    WEEKDAY_NAMES[(weekStart + i) % 7]!.slice(0, 2),
  );

  return (
    <div className="w-[17.5rem]">
      <div className="mb-2 flex items-center justify-between gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => setView((v) => shiftView(v, -1))}
        >
          <ChevronLeft />
        </Button>
        <div className="text-center">
          <div className="text-sm font-semibold">{title}</div>
          {subtitle && <div className="text-[11px] text-muted-foreground">{subtitle}</div>}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next month"
          onClick={() => setView((v) => shiftView(v, 1))}
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekdays.map((d) => (
          <div key={d} className="pb-1 text-[11px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <div key={`lead-${i}`} />
        ))}
        {days &&
          Array.from({ length: days.count }, (_, i) => {
            const date = addDays(days.first, i);
            const selected = date === value;
            const isToday = date === f.today;
            const disabled = max !== undefined && date > max;
            const secondary = view.calendar === 'bs' ? parseIsoDate(date).day : null;
            return (
              <button
                key={date}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(date)}
                aria-pressed={selected}
                aria-label={`${f.date(date, 'long')}`}
                className={cn(
                  'relative flex h-9 flex-col items-center justify-center rounded-lg text-sm tabular transition-colors hover:bg-muted disabled:opacity-30',
                  isToday && !selected && 'font-semibold text-primary',
                  selected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                )}
              >
                <span className="leading-none">{i + 1}</span>
                {secondary !== null && (
                  <span
                    className={cn(
                      'mt-0.5 text-[9px] leading-none opacity-60',
                      selected && 'opacity-80',
                    )}
                  >
                    {secondary}
                  </span>
                )}
              </button>
            );
          })}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Segmented
          size="sm"
          value={view.calendar}
          onChange={(calendar) => setView(viewFor(days?.first ?? value, calendar))}
          options={[
            { value: 'bs', label: 'BS' },
            { value: 'ad', label: 'AD' },
          ]}
          label="Calendar"
        />
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => onSelect(addDays(f.today, -1))}>
            Yesterday
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onSelect(f.today)}>
            Today
          </Button>
        </div>
      </div>
    </div>
  );
}

function adMonthSpan(days: { first: IsoDate; count: number } | null) {
  if (!days) return '';
  const start = parseIsoDate(days.first);
  const end = parseIsoDate(addDays(days.first, days.count - 1));
  const s = AD_MONTH_NAMES[start.month - 1]!.slice(0, 3);
  const e = AD_MONTH_NAMES[end.month - 1]!.slice(0, 3);
  return start.month === end.month ? `${s} ${start.year}` : `${s} – ${e} ${end.year}`;
}

function bsMonthSpan(days: { first: IsoDate; count: number } | null) {
  if (!days) return '';
  const last = addDays(days.first, days.count - 1);
  if (!isBsSupported(days.first) || !isBsSupported(last)) return '';
  const start = adToBs(days.first);
  const end = adToBs(last);
  const s = BS_MONTH_NAMES[start.month - 1]!;
  const e = BS_MONTH_NAMES[end.month - 1]!;
  return start.month === end.month ? `${s} ${start.year}` : `${s} – ${e} ${end.year}`;
}

export function DatePicker({
  value,
  onChange,
  id,
  className,
  max,
}: {
  value: IsoDate;
  onChange: (date: IsoDate) => void;
  id?: string;
  className?: string;
  max?: IsoDate;
}) {
  const f = useFormat();
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className={cn('h-10 w-full justify-start px-3 font-normal', className)}
        >
          <CalendarDays className="text-muted-foreground" />
          <span className="truncate">{f.relativeDate(value)}</span>
          <span className="ml-auto truncate text-xs text-muted-foreground">{f.altDate(value)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto">
        <CalendarGrid
          value={value}
          calendar={ws.calendar}
          weekStart={ws.weekStart}
          max={max}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
