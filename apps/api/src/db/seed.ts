import {
  addDays,
  GoalBodySchema,
  getMonthPeriod,
  listMonthPeriods,
  RecurringBodySchema,
  type RecurringInput,
  shiftMonthPeriod,
  todayIn,
  uuidv7,
} from '@et/shared';
import { eq } from 'drizzle-orm';
import type { Auth } from '../auth';
import type { WorkspaceCtx } from '../context';
import { setBudgets, setRollover } from '../services/budgets';
import { createGoal } from '../services/goals';
import { findOrCreatePayee } from '../services/payees';
import { setManualRate } from '../services/rates';
import { createRecurring } from '../services/recurring';
import { createTag } from '../services/tags';
import { createTransfer, insertTransaction } from '../services/transactions';
import { createWorkspace } from '../services/workspaces';
import type { Db } from './client';
import { accounts, categories, user, workspaces } from './schema';

/** Small deterministic PRNG so the demo data is the same every time. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_EMAIL = 'demo@example.com';
export const DEMO_PASSWORD = 'demo-password-123';

/**
 * Creates a demo user with six months of realistic transactions in NPR (plus a USD card and an
 * INR wallet), budgets and tags. Safe to run repeatedly: an existing demo user is left alone.
 */
export async function seedDemo(db: Db, auth: Auth, options: { months?: number } = {}) {
  const months = options.months ?? 6;
  const [existing] = await db.select().from(user).where(eq(user.email, DEMO_EMAIL));
  if (existing) return { created: false as const, email: DEMO_EMAIL };

  const signUp = await auth.api.signUpEmail({
    body: { name: 'Sumit Demo', email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  const userId = signUp.user.id;
  const today = todayIn('Asia/Kathmandu');
  const settings = { calendar: 'bs' as const, monthStartDay: 1 };
  const current = getMonthPeriod(today, settings);
  const first = shiftMonthPeriod(current, -(months - 1), settings);

  const created = await createWorkspace(db, userId, {
    name: 'Personal',
    baseCurrency: 'NPR',
    calendar: 'bs',
    starterCategories: true,
    accounts: [
      { name: 'Cash', type: 'cash', currency: 'NPR', openingBalanceMinor: 1_500_000 },
      { name: 'Nabil Bank', type: 'checking', currency: 'NPR', openingBalanceMinor: 12_000_000 },
      { name: 'eSewa', type: 'e_wallet', currency: 'NPR', openingBalanceMinor: 250_000 },
      { name: 'Khalti', type: 'e_wallet', currency: 'NPR', openingBalanceMinor: 80_000 },
      { name: 'Visa Card (USD)', type: 'credit_card', currency: 'USD', openingBalanceMinor: 0 },
      { name: 'Paytm (INR)', type: 'e_wallet', currency: 'INR', openingBalanceMinor: 500_000 },
    ],
  });
  await db
    .update(accounts)
    .set({ openingDate: first.start })
    .where(eq(accounts.workspaceId, created.id));
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, created.id));
  const ws: WorkspaceCtx = { ...row!, role: 'owner' };

  const acct = Object.fromEntries(
    (await db.select().from(accounts).where(eq(accounts.workspaceId, ws.id))).map((a) => [
      a.name,
      a,
    ]),
  );
  const cat = Object.fromEntries(
    (await db.select().from(categories).where(eq(categories.workspaceId, ws.id))).map((c) => [
      c.name,
      c.id,
    ]),
  );
  const rand = mulberry32(2083);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]!;
  const amount = (min: number, max: number, step = 100) =>
    Math.round((min + rand() * (max - min)) / step) * step;

  await setManualRate(db, ws.id, { base: 'USD', quote: 'NPR', date: first.start, rate: '133.4' });
  const dashainTag = await createTag(db, ws.id, { name: 'dashain', color: '#e11d48' });
  const tripTag = await createTag(db, ws.id, { name: 'trip-pokhara', color: '#0284c7' });

  const payeeCache = new Map<string, string | null>();
  async function tx(
    account: string,
    date: string,
    amountMinor: number,
    payee: string,
    category: string | null,
    extra: { notes?: string; tagIds?: string[]; needsReview?: boolean } = {},
  ) {
    if (date > today) return;
    let payeeId = payeeCache.get(payee);
    if (payeeId === undefined) {
      payeeId = await findOrCreatePayee(db, ws.id, payee);
      payeeCache.set(payee, payeeId);
    }
    const a = acct[account]!;
    // The ledger invariant is checked at commit, so the row and its splits go in one transaction.
    await db.transaction((t) =>
      insertTransaction(
        t,
        ws.id,
        userId,
        a.currency,
        {
          id: uuidv7(),
          accountId: a.id,
          date,
          amountMinor,
          categoryId: category ? cat[category]! : null,
          notes: extra.notes ?? null,
          tagIds: extra.tagIds,
          needsReview: extra.needsReview,
        },
        payeeId,
      ),
    );
  }

  const groceries = ['Bhat-Bhateni Supermarket', 'Big Mart', 'Salesways', 'Local Kirana Pasal'];
  const dining = ['Himalayan Java', 'Roadhouse Cafe', 'Bajeko Sekuwa', 'Foodmandu', 'Momo Hut'];
  const transport = ['Pathao', 'InDrive', 'Sajha Yatayat', 'Petrol Pump'];

  for (const period of listMonthPeriods(first.start, current.end, settings)) {
    const day = (n: number) => addDays(period.start, n);
    await tx('Nabil Bank', day(0), 12_500_000, 'Employer Pvt. Ltd.', 'Salary', {
      notes: 'Monthly salary',
    });
    await tx('Nabil Bank', day(2), -2_500_000, 'Landlord', 'Rent');
    await tx('eSewa', day(4), -amount(180_000, 320_000), 'NEA', 'Utilities', {
      notes: 'Electricity bill',
    });
    await tx('Khalti', day(5), -amount(50_000, 90_000), 'Worldlink', 'Utilities', {
      notes: 'Internet',
    });
    await tx('eSewa', day(6), -amount(40_000, 80_000), 'Ncell', 'Mobile & Data');
    await tx('Cash', day(8), -amount(180_000, 190_000), 'Nepal Gas', 'Utilities', {
      notes: 'LPG cylinder',
    });
    await tx('Nabil Bank', day(10), -1_000_000, 'Parents', 'Family Support');
    await tx('Nabil Bank', day(12), -1_150_000, 'Global IME Bank', 'Loan / EMI', {
      notes: 'Scooter EMI',
    });
    if (rand() > 0.4) await tx('Nabil Bank', day(14), 4_000_000, 'Brother (Qatar)', 'Remittance');

    for (let d = 0; d < 29; d += 1 + Math.floor(rand() * 3)) {
      await tx(
        pick(['Cash', 'eSewa', 'Nabil Bank']),
        day(d),
        -amount(80_000, 450_000),
        pick(groceries),
        'Food & Groceries',
      );
      if (rand() > 0.45)
        await tx(
          pick(['Cash', 'Khalti', 'eSewa']),
          day(d),
          -amount(25_000, 180_000),
          pick(dining),
          'Dining Out',
        );
      if (rand() > 0.5)
        await tx(
          pick(['Cash', 'eSewa']),
          day(d),
          -amount(15_000, 60_000),
          pick(transport),
          'Transport',
        );
    }
    if (rand() > 0.3)
      await tx('Nabil Bank', day(18), -amount(200_000, 900_000), 'Daraz', 'Shopping');
    if (rand() > 0.5)
      await tx('Visa Card (USD)', day(20), -1549, 'Netflix', 'Entertainment', {
        notes: 'Monthly plan',
      });
    if (rand() > 0.6)
      await tx('Cash', day(22), -amount(50_000, 300_000), 'Nepal Mediciti', 'Health');
    await tx('Nabil Bank', day(25), 18_500, 'Nabil Bank', 'Interest');
    // Money moves from the bank into cash and wallets, as it does in real life.
    const transfers: Array<[string, number, number, string]> = [
      ['Cash', 1, 2_500_000, 'ATM withdrawal'],
      ['eSewa', 3, 2_000_000, 'Wallet top-up'],
      ['Khalti', 3, 600_000, 'Wallet top-up'],
    ];
    for (const [to, offset, amountMinor, notes] of transfers) {
      if (day(offset) > today) continue;
      await createTransfer(db, ws, userId, {
        fromAccountId: acct['Nabil Bank']!.id,
        toAccountId: acct[to]!.id,
        date: day(offset),
        amountMinor,
        notes,
      });
    }
  }

  // A festival month and a trip, tagged.
  const festival = shiftMonthPeriod(current, -1, settings);
  await tx(
    'Nabil Bank',
    addDays(festival.start, 6),
    -3_500_000,
    'Bishal Bazar',
    'Festivals & Gifts',
    {
      tagIds: [dashainTag],
      notes: 'Clothes and gifts',
    },
  );
  await tx('Cash', addDays(festival.start, 8), -1_200_000, 'Tika expenses', 'Festivals & Gifts', {
    tagIds: [dashainTag],
  });
  const trip = shiftMonthPeriod(current, -2, settings);
  await tx('Nabil Bank', addDays(trip.start, 15), -1_450_000, 'Buddha Air', 'Travel', {
    tagIds: [tripTag],
  });
  await tx('Cash', addDays(trip.start, 16), -850_000, 'Hotel Barahi', 'Travel', {
    tagIds: [tripTag],
  });
  await tx('Paytm (INR)', addDays(trip.start, 2), -120_000, 'Amazon India', 'Shopping');

  // A few recent uncategorized ones waiting for review, like a fresh import would leave.
  await tx('Nabil Bank', addDays(today, -1), -65_000, 'FONEPAY QR 9841', null, {
    needsReview: true,
  });
  await tx('Nabil Bank', today, -120_000, 'POS SMART DOKO', null, { needsReview: true });

  const budgetItems = [
    ['Food & Groceries', 4_000_000],
    ['Dining Out', 1_200_000],
    ['Transport', 600_000],
    ['Utilities', 450_000],
    ['Mobile & Data', 100_000],
    ['Rent', 2_500_000],
    ['Shopping', 700_000],
    ['Entertainment', 300_000],
    ['Family Support', 1_000_000],
    ['Loan / EMI', 1_150_000],
    ['Festivals & Gifts', 500_000],
  ] as const;
  for (const period of [shiftMonthPeriod(current, -1, settings), current]) {
    await setBudgets(
      db,
      ws,
      period.start,
      budgetItems.map(([name, amountMinor]) => ({ categoryId: cat[name]!, amountMinor })),
    );
  }

  // Bills and income that repeat every Bikram Sambat month (plus a yearly premium).
  const nextMonth = shiftMonthPeriod(current, 1, settings);
  const nextOn = (offset: number) => {
    const d = addDays(current.start, offset);
    return d >= today ? d : addDays(nextMonth.start, offset);
  };
  const series: RecurringInput[] = [
    {
      name: 'Salary',
      kind: 'income',
      accountId: acct['Nabil Bank']!.id,
      amountMinor: 12_500_000,
      payee: 'Employer Pvt. Ltd.',
      categoryId: cat.Salary!,
      frequency: 'monthly',
      calendar: 'bs',
      nextDate: nextOn(0),
      mode: 'auto',
    },
    {
      name: 'Rent',
      kind: 'expense',
      accountId: acct['Nabil Bank']!.id,
      amountMinor: 2_500_000,
      payee: 'Landlord',
      categoryId: cat.Rent!,
      frequency: 'monthly',
      calendar: 'bs',
      nextDate: nextOn(2),
    },
    {
      name: 'Electricity',
      kind: 'expense',
      accountId: acct.eSewa!.id,
      amountMinor: 250_000,
      variableAmount: true,
      payee: 'NEA',
      categoryId: cat.Utilities!,
      frequency: 'monthly',
      calendar: 'bs',
      nextDate: today,
    },
    {
      name: 'Internet',
      kind: 'expense',
      accountId: acct.Khalti!.id,
      amountMinor: 70_000,
      payee: 'Worldlink',
      categoryId: cat.Utilities!,
      frequency: 'monthly',
      calendar: 'bs',
      nextDate: nextOn(5),
      mode: 'auto',
    },
    {
      name: 'Scooter EMI',
      kind: 'expense',
      accountId: acct['Nabil Bank']!.id,
      amountMinor: 1_150_000,
      payee: 'Global IME Bank',
      categoryId: cat['Loan / EMI']!,
      frequency: 'monthly',
      calendar: 'bs',
      nextDate: nextOn(12),
      remaining: 18,
      mode: 'auto',
    },
    {
      name: 'eSewa top-up',
      kind: 'transfer',
      accountId: acct['Nabil Bank']!.id,
      toAccountId: acct.eSewa!.id,
      amountMinor: 2_000_000,
      frequency: 'monthly',
      calendar: 'bs',
      nextDate: nextOn(3),
    },
    {
      name: 'Health insurance',
      kind: 'expense',
      accountId: acct['Nabil Bank']!.id,
      amountMinor: 1_800_000,
      payee: 'Nepal Life',
      categoryId: cat.Insurance!,
      frequency: 'yearly',
      calendar: 'bs',
      nextDate: addDays(today, 20),
    },
  ];
  for (const item of series) await createRecurring(db, ws, RecurringBodySchema.parse(item));

  // Unspent dining money carries over; a Dashain fund and a scooter goal.
  await setRollover(db, ws, {
    categoryId: cat['Dining Out']!,
    mode: 'surplus',
    fromPeriodStart: shiftMonthPeriod(current, -1, settings).start,
  });
  await createGoal(
    db,
    ws,
    GoalBodySchema.parse({
      name: 'Dashain 2084',
      kind: 'category',
      categoryId: cat['Festivals & Gifts']!,
      targetMinor: 4_000_000,
      targetDate: addDays(current.start, 330),
      icon: 'gift',
      color: '#e11d48',
    }),
  );
  await createGoal(
    db,
    ws,
    GoalBodySchema.parse({
      name: 'New scooter',
      kind: 'manual',
      targetMinor: 25_000_000,
      savedMinor: 6_000_000,
      targetDate: addDays(current.start, 240),
      icon: 'bike',
      color: '#2563eb',
    }),
  );

  return { created: true as const, email: DEMO_EMAIL, workspaceId: ws.id };
}
