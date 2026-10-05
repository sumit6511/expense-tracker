import { type AvatarPreset, avatarPreset } from '@et/shared';
import {
  Bike,
  Bird,
  Cat,
  Coffee,
  Dog,
  Fish,
  Flower2,
  Leaf,
  type LucideIcon,
  Moon,
  MountainSnow,
  Music,
  Panda,
  Rabbit,
  Rocket,
  Sun,
  Turtle,
} from 'lucide-react';
import { type CSSProperties, useState } from 'react';
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
        size === 'xs' ? 'size-5 text-2xs' : 'size-8 text-xs',
        className,
      )}
      style={{ '--hue': hue } as CSSProperties}
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
    >
      {initials(name)}
    </span>
  );
}

/** The ready-made avatars: an icon on a two-tone circle. */
export const AVATAR_LOOKS: Record<
  AvatarPreset,
  { label: string; icon: LucideIcon; from: string; to: string }
> = {
  mountain: { label: 'Mountain', icon: MountainSnow, from: '#38bdf8', to: '#0f766e' },
  rhododendron: { label: 'Rhododendron', icon: Flower2, from: '#fb7185', to: '#be123c' },
  sun: { label: 'Sun', icon: Sun, from: '#fbbf24', to: '#ea580c' },
  moon: { label: 'Moon', icon: Moon, from: '#818cf8', to: '#312e81' },
  leaf: { label: 'Leaf', icon: Leaf, from: '#4ade80', to: '#15803d' },
  bird: { label: 'Bird', icon: Bird, from: '#22d3ee', to: '#0369a1' },
  panda: { label: 'Panda', icon: Panda, from: '#94a3b8', to: '#1e293b' },
  cat: { label: 'Cat', icon: Cat, from: '#fb923c', to: '#c2410c' },
  dog: { label: 'Dog', icon: Dog, from: '#d6a26a', to: '#92400e' },
  rabbit: { label: 'Rabbit', icon: Rabbit, from: '#f9a8d4', to: '#db2777' },
  turtle: { label: 'Turtle', icon: Turtle, from: '#34d399', to: '#047857' },
  fish: { label: 'Fish', icon: Fish, from: '#60a5fa', to: '#1d4ed8' },
  tea: { label: 'Tea', icon: Coffee, from: '#d97706', to: '#78350f' },
  bike: { label: 'Bicycle', icon: Bike, from: '#a3e635', to: '#3f6212' },
  rocket: { label: 'Rocket', icon: Rocket, from: '#c084fc', to: '#7e22ce' },
  music: { label: 'Music', icon: Music, from: '#e879f9', to: '#a21caf' },
};

const SIZES = {
  xs: { box: 'size-5 text-2xs', icon: 'size-3' },
  sm: { box: 'size-7 text-xs', icon: 'size-4' },
  md: { box: 'size-8 text-xs', icon: 'size-4' },
  lg: { box: 'size-10 text-sm', icon: 'size-5' },
  xl: { box: 'size-20 text-2xl', icon: 'size-10' },
} as const;

/**
 * A person's picture: their photo, the avatar they chose, or their initials. `avatar` is the
 * value the API gives ("preset:<key>", a photo address, or null).
 */
export function UserAvatar({
  id,
  name,
  avatar,
  size = 'md',
  className,
  label,
}: {
  id: string;
  name: string;
  avatar: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
  /** Accessible name; when omitted the avatar is decorative. */
  label?: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const a11y = label
    ? ({ role: 'img', 'aria-label': label, title: label } as const)
    : ({ 'aria-hidden': true } as const);
  const preset = avatarPreset(avatar);
  if (preset) {
    const look = AVATAR_LOOKS[preset];
    const Icon = look.icon;
    return (
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-full text-white',
          SIZES[size].box,
          className,
        )}
        style={{ backgroundImage: `linear-gradient(135deg, ${look.from}, ${look.to})` }}
        {...a11y}
      >
        <Icon className={SIZES[size].icon} strokeWidth={2} />
      </span>
    );
  }
  if (avatar && broken !== avatar) {
    return (
      <img
        src={avatar}
        alt={label ?? ''}
        title={label}
        onError={() => setBroken(avatar)}
        className={cn('shrink-0 rounded-full bg-muted object-cover', SIZES[size].box, className)}
        {...(label ? {} : { 'aria-hidden': true })}
      />
    );
  }
  const hue = personHue(id);
  return (
    <span
      className={cn(
        'person-avatar grid shrink-0 place-items-center rounded-full font-semibold',
        SIZES[size].box,
        className,
      )}
      style={{ '--hue': hue } as CSSProperties}
      {...a11y}
    >
      {size === 'xs' ? initials(name).slice(0, 1) : initials(name)}
    </span>
  );
}
