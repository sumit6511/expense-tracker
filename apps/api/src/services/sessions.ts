import type { SessionInfo } from '@et/shared';
import { and, desc, eq, gt, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { session } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';

/**
 * Where you're signed in. Our own endpoints rather than Better Auth's list-sessions, which
 * returns every session's token to the browser; these only ever expose session ids.
 */
export async function listSessions(
  db: Db,
  userId: string,
  currentId: string | null,
): Promise<SessionInfo[]> {
  const rows = await db
    .select()
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
    .orderBy(desc(session.updatedAt));
  return rows
    .map((r) => ({
      id: r.id,
      current: r.id === currentId,
      userAgent: r.userAgent || null,
      ipAddress: r.ipAddress || null,
      createdAt: r.createdAt.toISOString(),
      lastActiveAt: r.updatedAt.toISOString(),
    }))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

/** Signs one of your other devices out. */
export async function revokeSession(db: Db, userId: string, currentId: string | null, id: string) {
  if (id === currentId) throw badRequest('To sign out of this device, use “Sign out”');
  const deleted = await db
    .delete(session)
    .where(and(eq(session.id, id), eq(session.userId, userId)))
    .returning({ id: session.id });
  if (deleted.length === 0) throw notFound('Session');
}

/** Signs out everywhere except this device; returns how many sessions ended. */
export async function revokeOtherSessions(db: Db, userId: string, currentId: string | null) {
  const deleted = await db
    .delete(session)
    .where(and(eq(session.userId, userId), currentId ? ne(session.id, currentId) : undefined))
    .returning({ id: session.id });
  return deleted.length;
}
