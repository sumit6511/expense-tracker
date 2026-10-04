/**
 * Resets someone's password from the server, for when they've forgotten it and the server can't
 * send email (no SMTP_URL). Prints a new temporary password and signs them out everywhere.
 *
 *   pnpm --filter @et/api reset-password person@example.com     (development)
 *   docker compose exec app node dist/reset-password.js person@example.com
 */
import { randomBytes } from 'node:crypto';
import { uuidv7 } from '@et/shared';
import { and, eq, sql } from 'drizzle-orm';
import { hashPassword } from './auth';
import { createDb } from './db/client';
import { account, session, user } from './db/schema';

const email = process.argv[2]?.trim().toLowerCase();
if (!email?.includes('@')) {
  console.error('Usage: reset-password <email>');
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(2);
}

const { db, pool } = createDb(url, 1);
try {
  const [found] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(sql`lower(${user.email}) = ${email}`);
  if (!found) {
    console.error(`No account uses ${email}`);
    process.exitCode = 1;
  } else {
    // Easy to read out or type: letters and digits only, 16 characters.
    const password = randomBytes(12).toString('base64url').replace(/[-_]/g, 'x');
    const hashed = await hashPassword(password);
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(account)
        .set({ password: hashed, updatedAt: new Date() })
        .where(and(eq(account.userId, found.id), eq(account.providerId, 'credential')))
        .returning({ id: account.id });
      if (updated.length === 0) {
        // Someone who only ever used a passkey gets a password too.
        await tx.insert(account).values({
          id: uuidv7(),
          userId: found.id,
          providerId: 'credential',
          accountId: found.id,
          password: hashed,
        });
      }
      await tx.delete(session).where(eq(session.userId, found.id));
    });
    console.log(`New password for ${found.name} <${email}>: ${password}`);
    console.log(
      'They have been signed out everywhere. Ask them to change it under Settings → Profile.',
    );
  }
} finally {
  await pool.end();
}
