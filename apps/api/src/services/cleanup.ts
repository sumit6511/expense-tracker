import { and, isNull, lt, sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { apiTokens, invitations, session, verification } from '../db/schema';

/** How long expired invitations and tokens stay, so the app can still say "this has expired". */
const KEEP_EXPIRED_DAYS = 30;

/**
 * Deletes sign-in data nobody can use any more: expired sessions and one-time codes or links,
 * and invitations and access tokens that expired over a month ago. Runs nightly.
 */
export async function pruneExpiredAuthData(db: Executor) {
  const now = new Date();
  const longAgo = new Date(now.getTime() - KEEP_EXPIRED_DAYS * 86_400_000);
  const count = async (rows: Promise<unknown[]>) => (await rows).length;
  return {
    sessions: await count(
      db.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id }),
    ),
    verifications: await count(
      db
        .delete(verification)
        .where(lt(verification.expiresAt, now))
        .returning({ id: verification.id }),
    ),
    invitations: await count(
      db
        .delete(invitations)
        .where(and(isNull(invitations.acceptedAt), lt(invitations.expiresAt, longAgo)))
        .returning({ id: invitations.id }),
    ),
    tokens: await count(
      db
        .delete(apiTokens)
        .where(sql`${apiTokens.expiresAt} is not null and ${lt(apiTokens.expiresAt, longAgo)}`)
        .returning({ id: apiTokens.id }),
    ),
  };
}
