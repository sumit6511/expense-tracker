import type { AccountType, CategoryKind } from './schemas';

export interface CategoryPreset {
  name: string;
  /** lucide-react icon name */
  icon: string;
  color: string;
}

export interface CategoryGroupPreset {
  name: string;
  kind: CategoryKind;
  categories: CategoryPreset[];
}

/**
 * Starter categories for Nepal. Deliberately short (users can add more): long category lists are
 * one of the reasons people give up on expense trackers.
 */
export const STARTER_CATEGORY_GROUPS: CategoryGroupPreset[] = [
  {
    name: 'Everyday',
    kind: 'expense',
    categories: [
      { name: 'Food & Groceries', icon: 'shopping-basket', color: '#16a34a' },
      { name: 'Dining Out', icon: 'utensils', color: '#ea580c' },
      { name: 'Transport', icon: 'bus', color: '#2563eb' },
      { name: 'Shopping', icon: 'shopping-bag', color: '#db2777' },
      { name: 'Entertainment', icon: 'clapperboard', color: '#9333ea' },
    ],
  },
  {
    name: 'Home & Bills',
    kind: 'expense',
    categories: [
      { name: 'Rent', icon: 'house', color: '#0891b2' },
      { name: 'Utilities', icon: 'zap', color: '#ca8a04' },
      { name: 'Mobile & Data', icon: 'smartphone', color: '#0d9488' },
      { name: 'Loan / EMI', icon: 'landmark', color: '#475569' },
      { name: 'Insurance', icon: 'shield-check', color: '#4f46e5' },
    ],
  },
  {
    name: 'Family & Life',
    kind: 'expense',
    categories: [
      { name: 'Education', icon: 'graduation-cap', color: '#7c3aed' },
      { name: 'Health', icon: 'heart-pulse', color: '#dc2626' },
      { name: 'Family Support', icon: 'users', color: '#c2410c' },
      { name: 'Festivals & Gifts', icon: 'gift', color: '#e11d48' },
      { name: 'Travel', icon: 'plane', color: '#0284c7' },
      { name: 'Donations', icon: 'hand-heart', color: '#be185d' },
    ],
  },
  {
    name: 'Income',
    kind: 'income',
    categories: [
      { name: 'Salary', icon: 'briefcase', color: '#15803d' },
      { name: 'Business', icon: 'store', color: '#047857' },
      { name: 'Remittance', icon: 'globe', color: '#0f766e' },
      { name: 'Interest', icon: 'percent', color: '#65a30d' },
      { name: 'Gifts Received', icon: 'gift', color: '#a16207' },
      { name: 'Other Income', icon: 'circle-plus', color: '#4d7c0f' },
    ],
  },
];

export interface AccountPreset {
  key: string;
  name: string;
  type: AccountType;
  icon: string;
  color: string;
}

export const ACCOUNT_PRESETS: AccountPreset[] = [
  { key: 'cash', name: 'Cash', type: 'cash', icon: 'wallet', color: '#16a34a' },
  { key: 'bank', name: 'Bank Account', type: 'checking', icon: 'landmark', color: '#2563eb' },
  { key: 'savings', name: 'Savings', type: 'savings', icon: 'piggy-bank', color: '#0891b2' },
  { key: 'esewa', name: 'eSewa', type: 'e_wallet', icon: 'smartphone', color: '#41a124' },
  { key: 'khalti', name: 'Khalti', type: 'e_wallet', icon: 'smartphone', color: '#5c2d91' },
  { key: 'imepay', name: 'IME Pay', type: 'e_wallet', icon: 'smartphone', color: '#d61f26' },
  {
    key: 'credit',
    name: 'Credit Card',
    type: 'credit_card',
    icon: 'credit-card',
    color: '#475569',
  },
];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: 'Cash',
  checking: 'Bank account',
  savings: 'Savings',
  credit_card: 'Credit card',
  e_wallet: 'E-wallet',
  loan: 'Loan',
  investment: 'Investment',
  other: 'Other',
};

/** Liability accounts carry negative balances (money owed). */
export const LIABILITY_ACCOUNT_TYPES: readonly AccountType[] = ['credit_card', 'loan'];

export const COLOR_SWATCHES = [
  '#16a34a',
  '#0d9488',
  '#0891b2',
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#9333ea',
  '#db2777',
  '#e11d48',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#65a30d',
  '#475569',
];
