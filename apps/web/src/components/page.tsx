import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTr } from '@/lib/i18n';
import { usePageTitle } from '@/lib/page-title';
import { cn } from '@/lib/utils';
import { Card, CardContent } from './ui/card';

export function PageHeader({
  title,
  description,
  actions,
  className,
  documentTitle,
  leading,
  trailing,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** The browser tab's title, when `title` isn't plain text. */
  documentTitle?: string;
  /** Beside the title, e.g. previous and next month buttons (kept out of the heading itself). */
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const tr = useTr();
  const plainTitle = typeof title === 'string' ? tr(title) : null;
  usePageTitle(documentTitle ?? (typeof plainTitle === 'string' ? plainTitle : null));
  return (
    <header className={cn('mb-5 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          {leading}
          <h1 className={cn('text-xl font-semibold tracking-tight sm:text-2xl', leading && 'px-1')}>
            {tr(title)}
          </h1>
          {trailing}
        </div>
        {description && (
          <p
            className={cn(
              'mt-0.5 max-w-3xl text-sm text-muted-foreground',
              // Lined up with the title when buttons sit before it.
              leading && 'pl-10',
            )}
          >
            {tr(description)}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  as: Heading = 'h2',
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** The heading level: h1 when it's the whole page (404, crash), h3 under a titled card. */
  as?: 'h1' | 'h2' | 'h3';
}) {
  const tr = useTr();
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <span className="mb-3 grid grid-cols-1 size-12 place-items-center rounded-full bg-accent text-accent-foreground">
        <Icon className="size-6" />
      </span>
      <Heading className="font-medium">{tr(title)}</Heading>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{tr(description)}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div
      className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
      role="alert"
    >
      <p className="font-medium text-destructive">Couldn’t load this</p>
      <p className="mt-1 text-muted-foreground">
        {error instanceof Error ? error.message : 'Unknown error'}
      </p>
      {retry && (
        <button
          type="button"
          onClick={retry}
          className="mt-2 text-sm font-medium text-primary hover:underline"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** A headline figure on its own card: a label, the value, and an optional note. */
export function StatCard({
  label,
  value,
  hint,
  emphasis,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** Larger, for the one figure that matters most in a row. */
  emphasis?: boolean;
  className?: string;
}) {
  const tr = useTr();
  return (
    <Card className={className}>
      <CardContent className="py-4">
        <p className="text-xs font-medium text-muted-foreground">{tr(label)}</p>
        <p
          className={cn(
            'mt-1 font-semibold tracking-tight break-words tabular',
            emphasis ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl',
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{tr(hint)}</p>}
      </CardContent>
    </Card>
  );
}
