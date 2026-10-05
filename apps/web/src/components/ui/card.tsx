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

export function Separator({ className }: { className?: string }) {
  return <hr className={cn('border-t border-border', className)} />;
}

/** Horizontal bar. `tone` switches colour as a budget fills up. */
export function Progress({
  value,
  className,
  tone = 'primary',
  label,
}: {
  value: number;
  className?: string;
  tone?: 'primary' | 'positive' | 'warning' | 'destructive' | 'muted';
  label?: string;
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
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
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
