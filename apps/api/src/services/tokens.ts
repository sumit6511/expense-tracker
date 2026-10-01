import { createHash, randomBytes } from 'node:crypto';
import {
  type ApiToken,
  type CreateApiToken,
  type CreatedApiToken,
  type Role,
  TOKEN_PREFIX,
  type TokenScope,
  uuidv7,
} from '@et/shared';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { WorkspaceCtx } from '../context';
import type { Executor } from '../db/client';
import { apiTokens, user, workspaceMembers } from '../db/schema';
import { forbidden, notFound } from '../lib/errors';

const ADMIN_ROLES: readonly Role[] = ['owner', 'admin'];
const WRITE_ROLES: readonly Role[] = ['owner', 'admin', 'editor'];

/** What a request made with a token may do. */
export interface TokenCtx {
  id: string;
  workspaceId: string;
  scope: TokenScope;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Tokens are long and random, so a plain SHA-256 is enough to keep them safe at rest. */
function newToken() {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token), hint: token.slice(0, TOKEN_PREFIX.length + 6) };
}

function toApi(
  row: typeof apiTokens.$inferSelect & { userName: string },
  viewerId: string,
): ApiToken {
  return {
    id: row.id,
    name: row.name,
    hint: row.hint,
    scope: row.scope,
    user: { id: row.userId, name: row.userName },
    mine: row.userId === viewerId,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

/** Your tokens in this workspace; owners and admins see everyone's. */
export async function listTokens(db: Executor, ws: WorkspaceCtx): Promise<ApiToken[]> {
  const rows = await db
    .select({ token: apiTokens, userName: user.name })
    .from(apiTokens)
    .innerJoin(user, eq(user.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.workspaceId, ws.id),
        ADMIN_ROLES.includes(ws.role) ? undefined : eq(apiTokens.userId, ws.userId),
      ),
    )
    .orderBy(desc(apiTokens.createdAt));
  return rows.map((r) => toApi({ ...r.token, userName: r.userName }, ws.userId));
}

export async function createToken(
  db: Executor,
  ws: WorkspaceCtx,
  input: CreateApiToken,
): Promise<CreatedApiToken> {
  // Viewers can make read-only tokens; a token never does more than its person may.
  if (input.scope === 'write' && !WRITE_ROLES.includes(ws.role)) {
    throw forbidden('You have read-only access, so your tokens can only read');
  }
  const { token, hash, hint } = newToken();
  const expiresAt =
    input.expiresInDays === null ? null : new Date(Date.now() + input.expiresInDays * 86_400_000);
  const [row] = await db
    .insert(apiTokens)
    .values({
      id: uuidv7(),
      workspaceId: ws.id,
      userId: ws.userId,
      name: input.name,
      tokenHash: hash,
      hint,
      scope: input.scope,
      expiresAt,
    })
    .returning();
  const [me] = await db.select({ name: user.name }).from(user).where(eq(user.id, ws.userId));
  return { ...toApi({ ...row!, userName: me?.name ?? '' }, ws.userId), token };
}

/** Revoke your own token, or (owners and admins) anyone's in the workspace. */
export async function revokeToken(db: Executor, ws: WorkspaceCtx, id: string) {
  const deleted = await db
    .delete(apiTokens)
    .where(
      and(
        eq(apiTokens.id, id),
        eq(apiTokens.workspaceId, ws.id),
        ADMIN_ROLES.includes(ws.role) ? undefined : eq(apiTokens.userId, ws.userId),
      ),
    )
    .returning({ id: apiTokens.id });
  if (deleted.length === 0) throw notFound('Token');
}

/**
 * Looks up the person behind a bearer token. Returns null for unknown or expired tokens (and
 * for tokens whose person is no longer a member, since those are deleted with the membership).
 */
export async function authenticateToken(db: Executor, token: string) {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 100) return null;
  const now = new Date();
  const [row] = await db
    .select({
      token: apiTokens,
      user: { id: user.id, email: user.email, name: user.name },
    })
    .from(apiTokens)
    .innerJoin(user, eq(user.id, apiTokens.userId))
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, apiTokens.workspaceId),
        eq(workspaceMembers.userId, apiTokens.userId),
      ),
    )
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(token)),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    )
    .limit(1);
  if (!row) return null;
  // Note when it was last used, at most once a minute, so reads don't all turn into writes.
  if (!row.token.lastUsedAt || now.getTime() - row.token.lastUsedAt.getTime() > 60_000) {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiTokens.id, row.token.id),
          or(
            isNull(apiTokens.lastUsedAt),
            lt(apiTokens.lastUsedAt, new Date(now.getTime() - 60_000)),
          ),
        ),
      );
  }
  const ctx: TokenCtx = {
    id: row.token.id,
    workspaceId: row.token.workspaceId,
    scope: row.token.scope,
  };
  return { user: row.user, token: ctx };
}
