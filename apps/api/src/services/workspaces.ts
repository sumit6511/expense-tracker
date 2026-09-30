import {
  ACCOUNT_PRESETS,
  type CreateWorkspaceSchema,
  DEFAULT_TIME_ZONE,
  type Me,
  STARTER_CATEGORY_GROUPS,
  todayIn,
  type UpdateMeInput,
  type UpdateWorkspaceInput,
  uuidv7,
  type Workspace,
} from '@et/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import {
  accounts,
  categories,
  categoryGroups,
  user,
  workspaceMembers,
  workspaces,
} from '../db/schema';
import { badRequest, notFound } from '../lib/errors';

type WorkspaceRow = typeof workspaces.$inferSelect;

export function toWorkspaceDto(row: WorkspaceRow, role: Workspace['role']): Workspace {
  return {
    id: row.id,
    name: row.name,
    baseCurrency: row.baseCurrency,
    calendar: row.calendar,
    monthStartDay: row.monthStartDay,
    weekStart: row.weekStart,
    timezone: row.timezone,
    role,
    createdAt: row.createdAt.toISOString(),
  };
}

export function ctxToDto(ws: WorkspaceCtx): Workspace {
  return {
    id: ws.id,
    name: ws.name,
    baseCurrency: ws.baseCurrency,
    calendar: ws.calendar,
    monthStartDay: ws.monthStartDay,
    weekStart: ws.weekStart,
    timezone: ws.timezone,
    role: ws.role,
    createdAt: ws.createdAt.toISOString(),
  };
}

export async function listWorkspaces(db: Db, userId: string): Promise<Workspace[]> {
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaces.createdAt));
  return rows.map((r) => toWorkspaceDto(r.workspace, r.role));
}

export async function getMe(db: Db, userId: string): Promise<Me> {
  const [u] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
  if (!u) throw notFound('User');
  const list = await listWorkspaces(db, userId);
  const defaultId =
    u.defaultWorkspaceId && list.some((w) => w.id === u.defaultWorkspaceId)
      ? u.defaultWorkspaceId
      : (list[0]?.id ?? null);
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      numberGrouping: u.numberGrouping,
      twoFactorEnabled: u.twoFactorEnabled,
    },
    workspaces: list,
    defaultWorkspaceId: defaultId,
  };
}

export async function updateMe(db: Db, userId: string, input: UpdateMeInput): Promise<Me> {
  if (input.defaultWorkspaceId) {
    const [member] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.workspaceId, input.defaultWorkspaceId),
        ),
      )
      .limit(1);
    if (!member) throw notFound('Workspace');
  }
  const patch: Partial<typeof user.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.numberGrouping !== undefined) patch.numberGrouping = input.numberGrouping;
  if (input.defaultWorkspaceId !== undefined) patch.defaultWorkspaceId = input.defaultWorkspaceId;
  if (Object.keys(patch).length > 0) await db.update(user).set(patch).where(eq(user.id, userId));
  return getMe(db, userId);
}

/** Adds the starter category groups and categories to a workspace. */
export async function seedStarterCategories(db: Executor, workspaceId: string): Promise<void> {
  for (const [gi, group] of STARTER_CATEGORY_GROUPS.entries()) {
    const groupId = uuidv7();
    await db
      .insert(categoryGroups)
      .values({ id: groupId, workspaceId, name: group.name, kind: group.kind, sortOrder: gi });
    await db.insert(categories).values(
      group.categories.map((c, ci) => ({
        id: uuidv7(),
        workspaceId,
        groupId,
        name: c.name,
        icon: c.icon,
        color: c.color,
        sortOrder: ci,
      })),
    );
  }
}

export async function createWorkspace(
  db: Db,
  userId: string,
  input: z.output<typeof CreateWorkspaceSchema>,
): Promise<Workspace> {
  const id = uuidv7();
  const timezone = input.timezone ?? DEFAULT_TIME_ZONE;
  const today = todayIn(timezone);
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(workspaces)
      .values({
        id,
        name: input.name,
        baseCurrency: input.baseCurrency,
        calendar: input.calendar,
        monthStartDay: input.monthStartDay ?? 1,
        weekStart: input.weekStart ?? 0,
        timezone,
      })
      .returning();
    await tx.insert(workspaceMembers).values({ workspaceId: id, userId, role: 'owner' });
    if (input.starterCategories) await seedStarterCategories(tx, id);
    for (const [i, a] of input.accounts.entries()) {
      const preset = ACCOUNT_PRESETS.find((p) => p.type === a.type);
      await tx.insert(accounts).values({
        id: uuidv7(),
        workspaceId: id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        openingBalanceMinor: a.openingBalanceMinor,
        openingDate: today,
        icon: a.icon ?? preset?.icon ?? 'wallet',
        color: a.color ?? preset?.color ?? '#64748b',
        sortOrder: i,
      });
    }
    const [u] = await tx
      .select({ d: user.defaultWorkspaceId })
      .from(user)
      .where(eq(user.id, userId));
    if (!u?.d) await tx.update(user).set({ defaultWorkspaceId: id }).where(eq(user.id, userId));
    return created!;
  });
  return toWorkspaceDto(row, 'owner');
}

export async function updateWorkspace(
  db: Db,
  ws: WorkspaceCtx,
  input: UpdateWorkspaceInput,
): Promise<Workspace> {
  if (Object.keys(input).length === 0) throw badRequest('Nothing to update');
  const [row] = await db.update(workspaces).set(input).where(eq(workspaces.id, ws.id)).returning();
  return toWorkspaceDto(row!, ws.role);
}

export async function deleteWorkspace(db: Db, workspaceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ defaultWorkspaceId: null })
      .where(eq(user.defaultWorkspaceId, workspaceId));
    await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });
}
