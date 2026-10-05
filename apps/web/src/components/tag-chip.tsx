import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/**
 * A tag's name in its own colour, adjusted to stay readable in light and dark (the `tag-text` and
 * `tag-chip` utilities in styles.css). `chip` adds a tinted background.
 */
export function TagChip({
  name,
  color,
  chip = false,
  className,
}: {
  name: string;
  color: string;
  chip?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        chip ? 'tag-chip rounded-md px-1.5 py-0.5 text-xs font-medium' : 'tag-text',
        className,
      )}
      style={{ '--tag': color } as CSSProperties}
    >
      #{name}
    </span>
  );
}
