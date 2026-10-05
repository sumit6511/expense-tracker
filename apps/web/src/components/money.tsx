import type { Minor } from '@et/shared';
import { useFormat } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * An amount in tabular figures. Money coming in is green with a "+"; money going out keeps the
 * normal text colour (with "-"), so ordinary spending isn't shown as an alarm.
 */
export function Money({
  minor,
  currency,
  className,
  signed = false,
  colored = false,
  compact = false,
  trimZero = false,
}: {
  minor: Minor;
  currency?: string;
  className?: string;
  /** Show "+" for positive amounts. */
  signed?: boolean;
  /** Green for positive amounts. */
  colored?: boolean;
  compact?: boolean;
  /**
   * Drop a ".00". The rule: a column of individual transaction amounts (transaction lists,
   * scheduled items) shows exact decimals so the column lines up; totals, budgets, headline
   * numbers, chart labels and amounts inside sentences drop a zero fraction.
   */
  trimZero?: boolean;
}) {
  const f = useFormat();
  const text = compact
    ? f.compact(minor, currency)
    : f.money(minor, currency, { sign: signed ? 'always' : 'auto', trimZeroFraction: trimZero });
  return (
    <span
      className={cn(
        'tabular whitespace-nowrap',
        colored && minor > 0 && 'text-positive',
        className,
      )}
    >
      {text}
    </span>
  );
}
