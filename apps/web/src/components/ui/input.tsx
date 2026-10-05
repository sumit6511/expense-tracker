import { Label as LabelPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { useTr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export const fieldBase =
  'w-full rounded-lg border border-input bg-card px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldBase, 'h-10', className)} {...props} />;
}

/**
 * A text field that only takes what `filter` lets through (see the filters in @et/shared).
 * A keystroke the filter would drop never appears and the caret stays where it was; pasted or
 * autofilled text is cleaned.
 */
export function FilteredInput({
  filter,
  onValueChange,
  ...props
}: Omit<ComponentProps<'input'>, 'onChange' | 'value'> & {
  value: string;
  filter: (text: string) => string;
  onValueChange: (value: string) => void;
}) {
  return (
    <Input
      {...props}
      onBeforeInput={(e) => {
        const data = (e.nativeEvent as InputEvent).data;
        const input = e.currentTarget;
        if (!data || input.selectionStart === null || input.selectionEnd === null) return;
        const before = input.value.slice(0, input.selectionStart) + data;
        const next = before + input.value.slice(input.selectionEnd);
        const filtered = filter(next);
        if (filtered === next) return;
        // Typed something the field can't take (or that it writes differently, like x → ×).
        e.preventDefault();
        if (filtered === input.value) return;
        onValueChange(filtered);
        const caret = Math.min(filter(before).length, filtered.length);
        requestAnimationFrame(() => input.setSelectionRange(caret, caret));
      }}
      onChange={(e) => onValueChange(filter(e.target.value))}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldBase, 'min-h-20 py-2', className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('text-compact font-medium text-foreground/90 leading-none', className)}
      {...props}
    />
  );
}

/** Label + control + optional hint/error, stacked. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const tr = useTr();
  return (
    <div className={cn('grid grid-cols-1 content-start gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{tr(label)}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{tr(hint)}</p>
      ) : null}
    </div>
  );
}
