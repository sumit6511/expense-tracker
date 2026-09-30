import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/** "Sita Sharma" → "SS", "Ram" → "R". */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]!.slice(0, 1);
  const last = words.length > 1 ? words.at(-1)!.slice(0, 1) : '';
  return (first + last).toUpperCase();
}

// Distinct hues that read on both light and dark backgrounds (text is drawn in the same hue).
const HUES = [172, 24, 262, 340, 205, 45, 130, 300];

/** A stable colour per person, so two people with the same initial still look different. */
export function personHue(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length]!;
}

export function PersonAvatar({
  id,
  name,
  size = 'md',
  className,
  label,
}: {
  id: string;
  name: string;
  size?: 'xs' | 'md';
  className?: string;
  /** Accessible name; when omitted the avatar is decorative. */
  label?: string;
}) {
  const hue = personHue(id);
  return (
    <span
      className={cn(
        'person-avatar grid shrink-0 place-items-center rounded-full font-semibold',
        size === 'xs' ? 'size-4 text-[8px]' : 'size-8 text-xs',
        className,
      )}
      style={{ '--hue': hue } as CSSProperties}
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
    >
      {initials(name)}
    </span>
  );
}
