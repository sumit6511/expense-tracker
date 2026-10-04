import { createHash, randomBytes } from 'node:crypto';
import {
  type AssignableRole,
  canAssignRole,
  canManageMember,
  canManageMembers,
  INVITATION_DAYS,
  type Invitation,
  type InvitationCreated,
  type InvitationPreview,
  type Members,
  ROLE_RANK,
  type Role,
  roleWithArticle,
  uuidv7,
  type Workspace,
} from '@et/shared';
import { and, asc, eq, gt, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { SessionUser, WorkspaceCtx } from '../context';
import type { Db, Executor } from '../db/client';
import {
  accounts,
  apiTokens,
  goals,
  invitations,
  notifications,
  transactionSplits,
  transactions,
  user,
  workspaceMembers,
  workspaces,
} from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import type { Logger } from '../logger';
import type { Mailer } from '../mailer';
import { avatarValue } from './avatars';
import { toWorkspaceDto } from './workspaces';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const inviteLink = (publicUrl: string, token: string) =>
  `${publicUrl.replace(/\/$/, '')}/invite/${token}`;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

type InvitationRow = typeof invitations.$inferSelect;

function toInvitationDto(row: InvitationRow, invitedByName: string | null): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    invitedByName,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() <= Date.now(),
  };
}

function requireManager(ws: WorkspaceCtx) {
  if (!canManageMembers(ws.role)) throw forbidden('Only owners and admins can manage members');
}

// ---------------------------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------------------------

export async function listMembers(db: Db, ws: WorkspaceCtx): Promise<Members> {
  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      joinedAt: workspaceMembers.createdAt,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, ws.id))
    .orderBy(asc(workspaceMembers.createdAt));
  const members = rows
    .map((r) => ({
      userId: r.userId,
      name: r.name,
      email: r.email,
      role: r.role,
      joinedAt: r.joinedAt.toISOString(),
      you: r.userId === ws.userId,
      avatar: avatarValue(r.userId, r.image),
    }))
    .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role]);

  let pending: Invitation[] = [];
  if (canManageMembers(ws.role)) {
    const inviter = alias(user, 'inviter');
    const open = await db
      .select({ invitation: invitations, inviter: inviter.name })
      .from(invitations)
      .leftJoin(inviter, eq(inviter.id, invitations.invitedBy))
      .where(and(eq(invitations.workspaceId, ws.id), isNull(invitations.acceptedAt)))
      .orderBy(sql`${invitations.createdAt} desc`);
    pending = open.map((r) => toInvitationDto(r.invitation, r.inviter));
  }
  return { members, invitations: pending };
}

async function requireMember(db: Executor, workspaceId: string, userId: string) {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!row) throw notFound('Member');
  return row;
}

export async function updateMemberRole(
  db: Db,
  ws: WorkspaceCtx,
  userId: string,
  role: AssignableRole,
) {
  requireManager(ws);
  if (userId === ws.userId) throw badRequest('You can’t change your own role');
  const target = await requireMember(db, ws.id, userId);
  if (!canManageMember(ws.role, target.role) || !canAssignRole(ws.role, role)) {
    throw forbidden('You can’t change this person’s role');
  }
  await db
    .update(workspaceMembers)
    .set({ role })
    .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, userId)));
  return listMembers(db, ws);
}

/**
 * Takes someone out of the workspace. Their past transactions stay, attributed to them; their
 * access tokens for it go, so being invited back later doesn't bring old tokens back to life.
 */
async function dropMember(db: Executor, workspaceId: string, userId: string) {
  await db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.workspaceId, workspaceId), eq(apiTokens.userId, userId)));
  await db
    .delete(notifications)
    .where(and(eq(notifications.workspaceId, workspaceId), eq(notifications.userId, userId)));
  await db
    .update(user)
    .set({ defaultWorkspaceId: null })
    .where(and(eq(user.id, userId), eq(user.defaultWorkspaceId, workspaceId)));
}

export async function removeMember(db: Db, ws: WorkspaceCtx, userId: string) {
  requireManager(ws);
  if (userId === ws.userId) throw badRequest('To leave the workspace, use “Leave”');
  const target = await requireMember(db, ws.id, userId);
  if (!canManageMember(ws.role, target.role)) throw forbidden('You can’t remove this person');
  await db.transaction((tx) => dropMember(tx, ws.id, userId));
}

/** Leaves a workspace. The owner has to hand over ownership (or delete it) first. */
export async function leaveWorkspace(db: Db, userId: string, workspaceId: string) {
  const member = await requireMember(db, workspaceId, userId).catch(() => {
    throw notFound('Workspace');
  });
  if (member.role === 'owner') {
    throw conflict('Make someone else the owner before leaving, or delete the workspace');
  }
  await db.transaction((tx) => dropMember(tx, workspaceId, userId));
}

export async function transferOwnership(db: Db, ws: WorkspaceCtx, userId: string) {
  if (ws.role !== 'owner') throw forbidden('Only the owner can hand over ownership');
  if (userId === ws.userId) throw badRequest('You’re already the owner');
  await requireMember(db, ws.id, userId);
  await db.transaction(async (tx) => {
    await tx
      .update(workspaceMembers)
      .set({ role: 'owner' })
      .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, userId)));
    await tx
      .update(workspaceMembers)
      .set({ role: 'admin' })
      .where(and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, ws.userId)));
  });
  return listMembers(db, { ...ws, role: 'admin' });
}

/**
 * Before an account is deleted: in workspaces shared with others, the longest-standing admin
 * (or else member) becomes the owner so the workspace isn't left without one.
 */
export async function handOverOwnedWorkspaces(db: Executor, userId: string) {
  await db.execute(sql`
    update ${workspaceMembers} m set role = 'owner'
    from (
      select distinct on (o.workspace_id) o.workspace_id, o.user_id
      from ${workspaceMembers} owned
      join ${workspaceMembers} o on o.workspace_id = owned.workspace_id and o.user_id <> ${userId}
      where owned.user_id = ${userId} and owned.role = 'owner'
      order by o.workspace_id, (o.role = 'admin') desc, o.created_at
    ) heir
    where m.workspace_id = heir.workspace_id and m.user_id = heir.user_id
  `);
}

/**
 * Before an account is deleted: its private accounts go too (nobody else could ever see them).
 * A transfer between one of them and a shared account stays in the shared account as a plain
 * transaction, so shared balances don't change.
 */
export async function deletePrivateAccountsOf(db: Db, userId: string) {
  await db.transaction(async (tx) => {
    const owned = (
      await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.ownerUserId, userId), eq(accounts.visibility, 'private')))
    ).map((a) => a.id);
    if (owned.length === 0) return;
    const groups = (
      await tx
        .selectDistinct({ group: transactions.transferGroupId })
        .from(transactions)
        .where(and(inArray(transactions.accountId, owned), isNotNull(transactions.transferGroupId)))
    ).map((g) => g.group!);
    const peers = groups.length
      ? await tx
          .select()
          .from(transactions)
          .where(
            and(
              inArray(transactions.transferGroupId, groups),
              notInArray(transactions.accountId, owned),
            ),
          )
      : [];
    for (const leg of peers) {
      await tx
        .update(transactions)
        .set({
          transferGroupId: null,
          notes: leg.notes || 'Transfer (the other account was deleted)',
        })
        .where(eq(transactions.id, leg.id));
      await tx.insert(transactionSplits).values({
        id: uuidv7(),
        transactionId: leg.id,
        workspaceId: leg.workspaceId,
        categoryId: null,
        amountMinor: leg.amountMinor,
        memo: '',
        sortOrder: 0,
      });
    }
    await tx.delete(goals).where(inArray(goals.accountId, owned));
    await tx.delete(transactions).where(inArray(transactions.accountId, owned));
    await tx.delete(accounts).where(inArray(accounts.id, owned));
  });
}

// ---------------------------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------------------------

async function sendInvitationEmail(
  mailer: Mailer | null,
  logger: Logger | undefined,
  mail: { to: string; inviter: string; workspace: string; role: Role; link: string },
) {
  if (!mailer) return false;
  const subject = `${mail.inviter} invited you to “${mail.workspace}”`;
  const text = [
    `${mail.inviter} invited you to join “${mail.workspace}” on Expense Tracker as ${roleWithArticle(mail.role)}.`,
    '',
    `Accept the invitation: ${mail.link}`,
    '',
    `The link works for ${INVITATION_DAYS} days. Sign in or create an account with this email address (${mail.to}) to accept.`,
  ].join('\n');
  const html = [
    `<p>${escapeHtml(mail.inviter)} invited you to join <strong>${escapeHtml(mail.workspace)}</strong> on Expense Tracker as ${roleWithArticle(mail.role)}.</p>`,
    `<p><a href="${escapeHtml(mail.link)}"><strong>Accept the invitation</strong></a></p>`,
    `<p style="color:#6b7280;font-size:12px">The link works for ${INVITATION_DAYS} days. Sign in or create an account with this email address (${escapeHtml(mail.to)}) to accept.</p>`,
  ].join('\n');
  try {
    await mailer.send({ to: mail.to, subject, text, html });
    return true;
  } catch (err) {
    logger?.warn({ err }, 'could not send invitation email');
    return false;
  }
}

interface InviteDeps {
  db: Db;
  mailer: Mailer | null;
  publicUrl: string;
  logger?: Logger;
}

export async function createInvitation(
  { db, mailer, publicUrl, logger }: InviteDeps,
  ws: WorkspaceCtx,
  inviter: SessionUser,
  input: { email: string; role: AssignableRole },
): Promise<InvitationCreated> {
  requireManager(ws);
  if (!canAssignRole(ws.role, input.role)) throw forbidden('You can’t give that role');
  const email = input.email.toLowerCase();
  const [existing] = await db
    .select({ id: user.id })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, ws.id), sql`lower(${user.email}) = ${email}`))
    .limit(1);
  if (existing) throw conflict('That person is already a member');

  const token = newToken();
  const values = {
    role: input.role,
    tokenHash: hashToken(token),
    invitedBy: inviter.id,
    expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
    createdAt: new Date(),
  };
  // Inviting the same address again replaces the open invitation (and its link).
  const [row] = await db
    .insert(invitations)
    .values({ id: uuidv7(), workspaceId: ws.id, email, ...values })
    .onConflictDoUpdate({
      target: [invitations.workspaceId, invitations.email],
      targetWhere: isNull(invitations.acceptedAt),
      set: values,
    })
    .returning();
  const link = inviteLink(publicUrl, token);
  const emailed = await sendInvitationEmail(mailer, logger, {
    to: email,
    inviter: inviter.name,
    workspace: ws.name,
    role: input.role,
    link,
  });
  return { invitation: toInvitationDto(row!, inviter.name), link, emailed };
}

/** A fresh link (and expiry) for an open invitation; the old link stops working. */
export async function renewInvitation(
  deps: InviteDeps,
  ws: WorkspaceCtx,
  inviter: SessionUser,
  id: string,
): Promise<InvitationCreated> {
  requireManager(ws);
  const [row] = await deps.db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, ws.id),
        eq(invitations.id, id),
        isNull(invitations.acceptedAt),
      ),
    );
  if (!row) throw notFound('Invitation');
  if (!canAssignRole(ws.role, row.role)) throw forbidden('You can’t give that role');
  return createInvitation(deps, ws, inviter, {
    email: row.email,
    role: row.role as AssignableRole,
  });
}

export async function revokeInvitation(db: Db, ws: WorkspaceCtx, id: string) {
  requireManager(ws);
  const deleted = await db
    .delete(invitations)
    .where(
      and(
        eq(invitations.workspaceId, ws.id),
        eq(invitations.id, id),
        isNull(invitations.acceptedAt),
      ),
    )
    .returning({ id: invitations.id });
  if (deleted.length === 0) throw notFound('Invitation');
}

async function findByToken(db: Executor, token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const inviter = alias(user, 'inviter');
  const [row] = await db
    .select({ invitation: invitations, workspace: workspaces.name, inviter: inviter.name })
    .from(invitations)
    .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
    .leftJoin(inviter, eq(inviter.id, invitations.invitedBy))
    .where(eq(invitations.tokenHash, hashToken(token)))
    .limit(1);
  return row ?? null;
}

/** What an invitation link is for, so the page can say who invited you to what. */
export async function previewInvitation(db: Db, token: string): Promise<InvitationPreview> {
  const found = await findByToken(db, token);
  if (!found) throw notFound('Invitation');
  const { invitation } = found;
  return {
    workspaceId: invitation.workspaceId,
    workspaceName: found.workspace,
    invitedByName: found.inviter,
    role: invitation.role,
    email: invitation.email,
    status: invitation.acceptedAt
      ? 'accepted'
      : invitation.expiresAt.getTime() <= Date.now()
        ? 'expired'
        : 'pending',
  };
}

export async function acceptInvitation(
  db: Db,
  token: string,
  accepter: SessionUser,
): Promise<Workspace> {
  return db.transaction(async (tx) => {
    const found = await findByToken(tx, token);
    if (!found) throw notFound('Invitation');
    const { invitation } = found;
    const [already] = await tx
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, invitation.workspaceId),
          eq(workspaceMembers.userId, accepter.id),
        ),
      );
    const [ws] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, invitation.workspaceId));
    // Opening the link again after joining just takes you there.
    if (already) return toWorkspaceDto(ws!, already.role);

    if (invitation.acceptedAt) throw conflict('This invitation has already been used');
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw conflict('This invitation has expired. Ask for a new one.');
    }
    if (accepter.email.toLowerCase() !== invitation.email) {
      throw forbidden(
        `This invitation is for ${invitation.email}. Sign in with that address to accept it.`,
      );
    }
    const claimed = await tx
      .update(invitations)
      .set({ acceptedAt: new Date(), acceptedBy: accepter.id })
      .where(
        and(
          eq(invitations.id, invitation.id),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .returning({ id: invitations.id });
    if (claimed.length === 0) throw conflict('This invitation has already been used');
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: invitation.workspaceId, userId: accepter.id, role: invitation.role });
    await tx
      .update(user)
      .set({ defaultWorkspaceId: invitation.workspaceId })
      .where(and(eq(user.id, accepter.id), isNull(user.defaultWorkspaceId)));
    return toWorkspaceDto(ws!, invitation.role);
  });
}
