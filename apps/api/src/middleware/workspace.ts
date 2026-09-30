import type { Role } from '@et/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';
import { accounts, workspaceMembers, workspaces } from '../db/schema';
import { forbidden, notFound, unauthorized } from '../lib/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITE_ROLES: readonly Role[] = ['owner', 'admin', 'editor'];

/**
 * Resolves /workspaces/:wid/* to a workspace the signed-in user belongs to. Non-members get 404,
 * so workspace ids can't be probed. Viewers may only read.
 */
export const loadWorkspace: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user) throw unauthorized();
  const wid = c.req.param('wid');
  // Not a workspace id (e.g. POST /workspaces/restore): let routing and validation handle it.
  if (!wid || !UUID_RE.test(wid)) return next();

  const { db } = c.get('deps');
  const [row] = await db
    .select({
      workspace: workspaces,
      role: workspaceMembers.role,
      hidden: sql<string[]>`array(
        select a.id::text from ${accounts} a
        where a.workspace_id = ${workspaces.id} and a.visibility = 'private'
          and a.owner_user_id is distinct from ${user.id}
      )`,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.workspaceId, wid), eq(workspaceMembers.userId, user.id)))
    .limit(1);
  if (!row) throw notFound('Workspace');

  if (!['GET', 'HEAD'].includes(c.req.method) && !WRITE_ROLES.includes(row.role)) {
    throw forbidden('You have read-only access to this workspace');
  }
  const ws = row.workspace;
  c.set('workspace', {
    id: ws.id,
    name: ws.name,
    baseCurrency: ws.baseCurrency,
    calendar: ws.calendar,
    monthStartDay: ws.monthStartDay,
    weekStart: ws.weekStart,
    timezone: ws.timezone,
    budgetMode: ws.budgetMode,
    envelopeSince: ws.envelopeSince,
    userId: user.id,
    role: row.role,
    hiddenAccountIds: row.hidden,
    createdAt: ws.createdAt,
  });
  await next();
};

export function requireRole(roles: readonly Role[], role: Role): void {
  if (!roles.includes(role)) throw forbidden();
}
