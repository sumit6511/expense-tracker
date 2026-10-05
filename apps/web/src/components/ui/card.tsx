import { ChevronRight } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useTr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-xl border bg-card text-card-foreground shadow-xs', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center justify-between gap-3 px-5 pt-4 pb-3', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, children, ...props }: ComponentProps<'h2'>) {
  const tr = useTr();
  return (
    <h2 className={cn('text-sm font-semibold', className)} {...props}>
      {tr(children)}
    </h2>
  );
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-5 pb-5', className)} {...props} />;
}

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: ComponentProps<'span'> & {
  tone?: 'neutral' | 'primary' | 'positive' | 'warning' | 'destructive';
}) {
  const tones = {
    neutral: 'bg-muted text-muted-foreground',
    primary: 'bg-accent text-accent-foreground',
    positive: 'bg-positive/12 text-positive',
    warning: 'bg-warning/15 text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning',
    destructive: 'bg-destructive/12 text-destructive',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

const TITLE_WIDTHS = ['w-2/5', 'w-1/2', 'w-1/3', 'w-3/5'];

/** A list row while it loads, shaped like the real one: icon, two lines of text, an amount. */
export function RowSkeleton({ index = 0 }: { index?: number }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
      <Skeleton className="size-9 shrink-0 rounded-full" />
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-1.5">
        <Skeleton className={cn('h-3.5', TITLE_WIDTHS[index % TITLE_WIDTHS.length])} />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-3.5 w-16" />
    </div>
  );
}

/** Loading rows for a list, announced once to screen readers. */
export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" className={cn('divide-y', className)}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows
        <RowSkeleton key={i} index={i} />
      ))}
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <hr className={cn('border-t border-border', className)} />;
}

/** Horizontal bar. `tone` switches colour as a budget fills up. */
export function Progress({
  value,
  className,
  tone = 'primary',
  label,
  decorative = false,
}: {
  value: number;
  className?: string;
  tone?: 'primary' | 'positive' | 'warning' | 'destructive' | 'muted';
  label?: string;
  /** The same number is already written next to the bar: hide the bar from screen readers. */
  decorative?: boolean;
}) {
  const colors = {
    primary: 'bg-primary',
    positive: 'bg-positive',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
    muted: 'bg-muted-foreground/40',
  };
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...(decorative
        ? { 'aria-hidden': true }
        : {
            role: 'progressbar',
            'aria-valuenow': Math.round(clamped),
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-label': label,
          })}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', colors[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** A section that opens and closes (a native <details>), with the app's chevron. */
export function Disclosure({
  summary,
  children,
  className,
  summaryClassName,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  summaryClassName?: string;
}) {
  return (
    <details className={cn('group', className)}>
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-1.5 select-none [&::-webkit-details-marker]:hidden',
          summaryClassName,
        )}
      >
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      {children}
    </details>
  );
}
