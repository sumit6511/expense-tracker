import {
  formatAdDate,
  formatBsDate,
  formatMoney,
  formatMonthPeriod,
  getMonthPeriod,
  type IsoDate,
  type Notification,
  type NotificationKind,
  type NotificationList,
  type NotificationPrefs,
  type NotificationSettings,
  PREF_FOR_KIND,
  type UpdateNotificationPrefs,
  uuidv7,
} from '@et/shared';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import {
  accounts,
  categories,
  notificationPrefs,
  notifications,
  recurring,
  user,
  workspaceMembers,
  workspaces,
} from '../db/schema';
import type { Logger } from '../logger';
import type { Mailer } from '../mailer';
import { budgetOverview } from './budgets';
import { listGoals } from './goals';
import { periodSettings } from './reports';
import { workspaceToday } from './transactions';
import { memberContexts, visibleAccount } from './visibility';

/** Something worth telling the workspace's members about. */
export interface Candidate {
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  /** The same event is announced once per person, however often it's checked. */
  dedupeKey: string;
  /** Leave it out if one of these was already announced (e.g. "almost used" after "over"). */
  unlessAnnounced?: string[];
}

const DEFAULT_PREFS: NotificationPrefs = {
  email: false,
  bills: true,
  budgets: true,
  recurring: true,
  goals: true,
  insights: true,
};

/** Warn when this much of a budget is spent. */
const ALMOST_USED = 0.9;

const money = (minor: number, currency: string) =>
  formatMoney(minor, currency, {
    grouping: currency === 'NPR' || currency === 'INR' ? 'lakh' : 'international',
    trimZeroFraction: true,
  });

const dateLabel = (ws: Pick<WorkspaceCtx, 'calendar'>, date: IsoDate) =>
  ws.calendar === 'bs' ? formatBsDate(date, { style: 'short' }) : formatAdDate(date, 'short');

// ---------------------------------------------------------------------------------------------
// What to announce
// ---------------------------------------------------------------------------------------------

/** Bills that need recording by hand and are due within their reminder window. */
async function billCandidates(db: Executor, ws: WorkspaceCtx, today: IsoDate) {
  const rows = await db
    .select({
      id: recurring.id,
      name: recurring.name,
      kind: recurring.kind,
      amountMinor: recurring.amountMinor,
      variableAmount: recurring.variableAmount,
      nextDate: recurring.nextDate,
      account: accounts.name,
      currency: accounts.currency,
    })
    .from(recurring)
    .innerJoin(accounts, eq(accounts.id, recurring.accountId))
    .where(
      and(
        eq(recurring.workspaceId, ws.id),
        eq(recurring.active, true),
        eq(recurring.mode, 'remind'),
        sql`${recurring.nextDate} <= ${today}::date + ${recurring.remindDaysBefore}`,
        visibleAccount(ws, recurring.accountId),
        visibleAccount(ws, recurring.toAccountId),
      ),
    );
  return rows.map((r): Candidate => {
    const date = r.nextDate!;
    const amount = `${r.variableAmount ? 'About ' : ''}${money(r.amountMinor, r.currency)}`;
    const direction = r.kind === 'income' ? 'into' : 'from';
    const then =
      r.kind === 'income'
        ? 'Record it once it arrives.'
        : r.kind === 'transfer'
          ? 'Record it once it’s done.'
          : 'Record it once it’s paid.';
    return {
      kind: 'bill',
      // The date rather than "today": the notification is still read days later.
      title:
        date < today
          ? `${r.name} was due ${dateLabel(ws, date)}`
          : `${r.name} is due ${dateLabel(ws, date)}`,
      body: `${amount} ${direction} ${r.account}. ${then}`,
      link: '/recurring',
      dedupeKey: `bill:${r.id}:${date}`,
    };
  });
}

/** Categories (and the overall monthly limit) that are nearly or completely used up. */
async function budgetCandidates(db: Executor, ws: WorkspaceCtx, today: IsoDate) {
  const period = getMonthPeriod(today, periodSettings(ws));
  const overview = await budgetOverview(db, ws, period);
  const month = formatMonthPeriod(period);
  const out: Candidate[] = [];
  const check = (key: string, name: string, available: number, spent: number) => {
    if (available <= 0 || spent <= 0) return;
    const over = `${key}:over`;
    if (spent > available) {
      out.push({
        kind: 'budget',
        title: `${name} is over budget`,
        body: `${money(spent, ws.baseCurrency)} spent of ${money(available, ws.baseCurrency)} for ${month}.`,
        link: '/budgets',
        dedupeKey: over,
      });
    } else if (spent >= available * ALMOST_USED && spent < available) {
      // Exactly used up is usually a fixed bill paid as planned: nothing to warn about.
      out.push({
        kind: 'budget',
        title: `${name} budget is almost used`,
        body: `${money(available - spent, ws.baseCurrency)} left of ${money(available, ws.baseCurrency)} for ${month}.`,
        link: '/budgets',
        dedupeKey: `${key}:almost`,
        unlessAnnounced: [over],
      });
    }
  };

  const watched = overview.lines.filter((l) => l.availableMinor > 0 && l.spentMinor > 0);
  if (watched.length) {
    const names = new Map(
      (
        await db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(
            inArray(
              categories.id,
              watched.map((l) => l.categoryId),
            ),
          )
      ).map((c) => [c.id, c.name]),
    );
    for (const l of watched) {
      check(
        `budget:${l.categoryId}:${period.start}`,
        names.get(l.categoryId) ?? 'A category',
        l.availableMinor,
        l.spentMinor,
      );
    }
  }
  if (overview.cap) {
    const { amountMinor, spentMinor } = overview.cap;
    const key = `cap:${period.start}`;
    if (spentMinor > amountMinor) {
      out.push({
        kind: 'budget',
        title: 'You’re over your monthly limit',
        body: `${money(spentMinor, ws.baseCurrency)} spent of ${money(amountMinor, ws.baseCurrency)} for ${month}.`,
        link: '/budgets',
        dedupeKey: `${key}:over`,
      });
    } else if (spentMinor >= amountMinor * ALMOST_USED && spentMinor < amountMinor) {
      out.push({
        kind: 'budget',
        title: 'Your monthly limit is almost used',
        body: `${money(amountMinor - spentMinor, ws.baseCurrency)} left of ${money(amountMinor, ws.baseCurrency)} for ${month}.`,
        link: '/budgets',
        dedupeKey: `${key}:almost`,
        unlessAnnounced: [`${key}:over`],
      });
    }
  }
  return out;
}

async function goalCandidates(db: Db, ws: WorkspaceCtx) {
  const goals = await listGoals(db, ws);
  return goals
    .filter((g) => g.reached && !g.archived)
    .map(
      (g): Candidate => ({
        kind: 'goal',
        title: `Goal reached: ${g.name}`,
        body: `${money(g.currentMinor, ws.baseCurrency)} saved of ${money(g.targetMinor, ws.baseCurrency)}.`,
        link: '/budgets?view=goals',
        dedupeKey: `goal:${g.id}:reached`,
      }),
    );
}

/** A note that recurring items were recorded automatically. */
export function recordedCandidate(item: {
  recurringId: string;
  name: string;
  kind: 'expense' | 'income' | 'transfer';
  count: number;
  lastDate: IsoDate;
  amountMinor: number;
  currency: string;
  calendar: WorkspaceCtx['calendar'];
}): Candidate {
  const amount = money(item.amountMinor, item.currency);
  return {
    kind: 'recurring',
    title: item.count > 1 ? `Recorded ${item.name} (${item.count} times)` : `Recorded ${item.name}`,
    body:
      item.count > 1
        ? `${amount} each, the latest on ${dateLabel(item, item.lastDate)}.`
        : `${amount} on ${dateLabel(item, item.lastDate)}.`,
    link: `/transactions?recurringId=${item.recurringId}`,
    dedupeKey: `recurring:${item.recurringId}:${item.lastDate}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Delivering
// ---------------------------------------------------------------------------------------------

async function prefsFor(db: Executor, userIds: string[]) {
  const rows = userIds.length
    ? await db.select().from(notificationPrefs).where(inArray(notificationPrefs.userId, userIds))
    : [];
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  return (userId: string): NotificationPrefs => byUser.get(userId) ?? DEFAULT_PREFS;
}

/**
 * Adds each candidate for every member (or just `onlyFor`) who wants that kind and hasn't had it
 * yet. Returns how many new notifications were created.
 */
export async function deliver(
  db: Executor,
  workspaceId: string,
  candidates: Candidate[],
  onlyFor?: string[],
) {
  if (candidates.length === 0) return 0;
  const members = (
    await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          onlyFor ? inArray(workspaceMembers.userId, onlyFor) : undefined,
        ),
      )
  ).map((m) => m.userId);
  if (members.length === 0) return 0;
  const prefs = await prefsFor(db, members);

  const blockers = [...new Set(candidates.flatMap((c) => c.unlessAnnounced ?? []))];
  const announced = new Set(
    blockers.length
      ? (
          await db
            .select({ userId: notifications.userId, key: notifications.dedupeKey })
            .from(notifications)
            .where(
              and(
                eq(notifications.workspaceId, workspaceId),
                inArray(notifications.dedupeKey, blockers),
              ),
            )
        ).map((r) => `${r.userId}|${r.key}`)
      : [],
  );

  const rows = members.flatMap((userId) =>
    candidates
      .filter(
        (c) =>
          prefs(userId)[PREF_FOR_KIND[c.kind]] &&
          !(c.unlessAnnounced ?? []).some((k) => announced.has(`${userId}|${k}`)),
      )
      .map((c) => ({
        id: uuidv7(),
        workspaceId,
        userId,
        kind: c.kind,
        title: c.title,
        body: c.body,
        link: c.link,
        dedupeKey: c.dedupeKey,
      })),
  );
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(notifications)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return inserted.length;
}

/**
 * Checks one workspace for anything new to tell `ws.userId` about. Each person is checked on
 * their own, since what they see (and so their budget totals) can differ.
 */
export async function refreshNotifications(db: Db, ws: WorkspaceCtx) {
  const today = workspaceToday(ws);
  const candidates = [
    ...(await billCandidates(db, ws, today)),
    ...(await budgetCandidates(db, ws, today)),
    ...(await goalCandidates(db, ws)),
  ];
  return deliver(db, ws.id, candidates, [ws.userId]);
}

// ---------------------------------------------------------------------------------------------
// Reading and settings
// ---------------------------------------------------------------------------------------------

export async function listNotifications(
  db: Db,
  userId: string,
  workspaceId: string,
  limit = 30,
): Promise<NotificationList> {
  const mine = and(eq(notifications.userId, userId), eq(notifications.workspaceId, workspaceId));
  const [rows, [unread]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(mine)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(mine, isNull(notifications.readAt))),
  ]);
  return {
    items: rows.map(
      (r): Notification => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body,
        link: r.link,
        read: r.readAt !== null,
        createdAt: r.createdAt.toISOString(),
      }),
    ),
    unreadCount: unread?.n ?? 0,
  };
}

export async function markRead(
  db: Db,
  userId: string,
  target: { ids?: string[]; workspaceId?: string },
) {
  const scope = target.ids
    ? inArray(notifications.id, target.ids)
    : eq(notifications.workspaceId, target.workspaceId!);
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), scope))
    .returning({ id: notifications.id });
  return updated.length;
}

export async function getNotificationSettings(
  db: Db,
  userId: string,
  mailer: Mailer | null,
): Promise<NotificationSettings> {
  const prefs = (await prefsFor(db, [userId]))(userId);
  return {
    email: prefs.email,
    bills: prefs.bills,
    budgets: prefs.budgets,
    recurring: prefs.recurring,
    goals: prefs.goals,
    insights: prefs.insights,
    emailAvailable: mailer !== null,
  };
}

export async function updateNotificationSettings(
  db: Db,
  userId: string,
  patch: UpdateNotificationPrefs,
  mailer: Mailer | null,
) {
  const current = await getNotificationSettings(db, userId, mailer);
  const { emailAvailable: _, ...prefs } = { ...current, ...patch };
  await db
    .insert(notificationPrefs)
    .values({ userId, ...prefs })
    .onConflictDoUpdate({ target: notificationPrefs.userId, set: prefs });
  return getNotificationSettings(db, userId, mailer);
}

// ---------------------------------------------------------------------------------------------
// Background: every workspace, then email
// ---------------------------------------------------------------------------------------------

/** Emails are for news: anything older than this, or already seen in the app, isn't sent. */
const EMAIL_WITHIN_HOURS = 24;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

/**
 * Sends each person who asked for email one message with their unread notifications from the
 * last day that haven't been emailed yet.
 */
export async function sendNotificationEmails(
  db: Db,
  mailer: Mailer,
  publicUrl: string,
  logger?: Logger,
) {
  const pending = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      email: user.email,
      name: user.name,
      workspace: workspaces.name,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
    })
    .from(notifications)
    .innerJoin(notificationPrefs, eq(notificationPrefs.userId, notifications.userId))
    .innerJoin(user, eq(user.id, notifications.userId))
    .innerJoin(workspaces, eq(workspaces.id, notifications.workspaceId))
    .where(
      and(
        eq(notificationPrefs.email, true),
        isNull(notifications.emailedAt),
        isNull(notifications.readAt),
        sql`${notifications.createdAt} > now() - make_interval(hours => ${EMAIL_WITHIN_HOURS})`,
      ),
    )
    .orderBy(notifications.userId, notifications.createdAt);

  const byUser = new Map<string, typeof pending>();
  for (const n of pending) byUser.set(n.userId, [...(byUser.get(n.userId) ?? []), n]);

  const base = publicUrl.replace(/\/$/, '');
  let sent = 0;
  for (const items of byUser.values()) {
    const first = items[0]!;
    const workspaceCount = new Set(items.map((i) => i.workspace)).size;
    const subject =
      items.length === 1 ? first.title : `${items.length} updates from your expense tracker`;
    const lines = items.map((i) => ({
      heading: workspaceCount > 1 ? `${i.title} (${i.workspace})` : i.title,
      body: i.body,
      url: `${base}${i.link ?? '/'}`,
    }));
    const text = [
      `Hi ${first.name},`,
      '',
      ...lines.flatMap((l) => [l.heading, l.body, l.url, '']),
      `Change what you're notified about in Settings: ${base}/settings?tab=notifications`,
    ].join('\n');
    const html = [
      `<p>Hi ${escapeHtml(first.name)},</p>`,
      ...lines.map(
        (l) =>
          `<p><a href="${escapeHtml(l.url)}"><strong>${escapeHtml(l.heading)}</strong></a><br>${escapeHtml(l.body)}</p>`,
      ),
      `<p style="color:#6b7280;font-size:12px">Change what you're notified about in <a href="${escapeHtml(`${base}/settings?tab=notifications`)}">Settings</a>.</p>`,
    ].join('\n');
    try {
      await mailer.send({ to: first.email, subject, text, html });
      await db
        .update(notifications)
        .set({ emailedAt: new Date() })
        .where(
          inArray(
            notifications.id,
            items.map((i) => i.id),
          ),
        );
      sent++;
    } catch (err) {
      // Try again on the next run (until the notifications are a day old).
      logger?.warn({ err, userId: first.userId }, 'could not send notification email');
    }
  }
  return sent;
}

/** Keep read notifications for 90 days and unread ones for a year. */
export async function pruneNotifications(db: Db) {
  const now = Date.now();
  const deleted = await db
    .delete(notifications)
    .where(
      sql`(${notifications.readAt} is not null and ${lt(notifications.createdAt, new Date(now - 90 * 86_400_000))}) or ${lt(notifications.createdAt, new Date(now - 365 * 86_400_000))}`,
    )
    .returning({ id: notifications.id });
  return deleted.length;
}

/** Checks every workspace, then sends emails. Runs in the background every few minutes. */
export async function runNotifications(
  db: Db,
  mailer: Mailer | null,
  publicUrl: string,
  logger?: Logger,
) {
  let created = 0;
  for (const ws of await memberContexts(db)) {
    try {
      created += await refreshNotifications(db, ws);
    } catch (err) {
      logger?.warn({ err, workspaceId: ws.id }, 'could not check workspace for notifications');
    }
  }
  const emailed = mailer ? await sendNotificationEmails(db, mailer, publicUrl, logger) : 0;
  if (created || emailed) logger?.info({ created, emailed }, 'notifications sent');
  return { created, emailed };
}
