import {
  Baby,
  Banknote,
  Beer,
  Bike,
  Bone,
  BookOpen,
  Briefcase,
  Building2,
  Bus,
  Cake,
  Car,
  CircleDollarSign,
  CirclePlus,
  Clapperboard,
  Coffee,
  Coins,
  CreditCard,
  Dog,
  Droplet,
  Dumbbell,
  Film,
  Flame,
  Fuel,
  Gamepad2,
  Gem,
  Gift,
  Globe,
  GraduationCap,
  HandCoins,
  HandHeart,
  Heart,
  HeartPulse,
  Hospital,
  House,
  Landmark,
  Laptop,
  type LucideIcon,
  Music,
  Package,
  PartyPopper,
  PawPrint,
  Percent,
  PiggyBank,
  Pill,
  Pizza,
  Plane,
  Receipt,
  Scissors,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Sprout,
  Stethoscope,
  Store,
  Tag,
  Ticket,
  TrainFront,
  TrendingUp,
  Tv,
  Umbrella,
  Users,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/** Icons offered for categories and accounts, keyed by lucide name (what the API stores). */
export const ICONS: Record<string, LucideIcon> = {
  'shopping-basket': ShoppingBasket,
  utensils: Utensils,
  coffee: Coffee,
  pizza: Pizza,
  beer: Beer,
  cake: Cake,
  bus: Bus,
  car: Car,
  bike: Bike,
  fuel: Fuel,
  'train-front': TrainFront,
  plane: Plane,
  house: House,
  zap: Zap,
  droplet: Droplet,
  flame: Flame,
  wifi: Wifi,
  smartphone: Smartphone,
  tv: Tv,
  laptop: Laptop,
  wrench: Wrench,
  'shopping-bag': ShoppingBag,
  shirt: Shirt,
  gem: Gem,
  scissors: Scissors,
  package: Package,
  clapperboard: Clapperboard,
  film: Film,
  music: Music,
  'gamepad-2': Gamepad2,
  ticket: Ticket,
  'party-popper': PartyPopper,
  gift: Gift,
  sparkles: Sparkles,
  'heart-pulse': HeartPulse,
  stethoscope: Stethoscope,
  pill: Pill,
  hospital: Hospital,
  dumbbell: Dumbbell,
  'graduation-cap': GraduationCap,
  'book-open': BookOpen,
  baby: Baby,
  users: Users,
  heart: Heart,
  'hand-heart': HandHeart,
  dog: Dog,
  'paw-print': PawPrint,
  bone: Bone,
  sprout: Sprout,
  'shield-check': ShieldCheck,
  umbrella: Umbrella,
  landmark: Landmark,
  'building-2': Building2,
  receipt: Receipt,
  percent: Percent,
  briefcase: Briefcase,
  store: Store,
  globe: Globe,
  'hand-coins': HandCoins,
  coins: Coins,
  banknote: Banknote,
  'trending-up': TrendingUp,
  'circle-dollar-sign': CircleDollarSign,
  'circle-plus': CirclePlus,
  wallet: Wallet,
  'piggy-bank': PiggyBank,
  'credit-card': CreditCard,
  tag: Tag,
};

export const ICON_NAMES = Object.keys(ICONS);

export function iconFor(name: string | undefined): LucideIcon {
  return (name && ICONS[name]) || Tag;
}

/** Round badge with an icon on a tint of the category's colour. */
export function CategoryIcon({
  icon,
  color,
  size = 'md',
  className,
}: {
  icon?: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const Icon = iconFor(icon);
  const sizes = {
    sm: 'size-7 [&_svg]:size-3.5',
    md: 'size-9 [&_svg]:size-[18px]',
    lg: 'size-11 [&_svg]:size-5',
  };
  return (
    <span
      aria-hidden
      className={cn(
        'grid grid-cols-1 shrink-0 place-items-center rounded-full',
        sizes[size],
        className,
      )}
      style={{
        color: color ?? 'var(--muted-foreground)',
        backgroundColor: color ? `color-mix(in oklch, ${color} 14%, transparent)` : 'var(--muted)',
      }}
    >
      <Icon />
    </span>
  );
}
