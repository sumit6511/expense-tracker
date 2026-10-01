import { ImapFlow } from 'imapflow';
import { type EmailInDeps, receiveEmail } from './email-in';

/**
 * Reads email in from a mailbox over IMAP (e.g. a Gmail account with plus-addressing:
 * money+<token>@gmail.com all lands in money@gmail.com). Unread messages are handed to
 * receiveEmail and then marked read, so each is handled once.
 */
export async function pollMailbox(deps: EmailInDeps, url: string, folder = 'INBOX', max = 50) {
  const target = new URL(url);
  const secure = target.protocol === 'imaps:';
  const client = new ImapFlow({
    host: target.hostname,
    port: Number(target.port) || (secure ? 993 : 143),
    secure,
    auth: {
      user: decodeURIComponent(target.username),
      pass: decodeURIComponent(target.password),
    },
    logger: false,
  });
  await client.connect();
  let handled = 0;
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const unread = (await client.search({ seen: false }, { uid: true })) || [];
      for (const uid of unread.slice(0, max)) {
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        const source = message ? message.source : undefined;
        if (source) {
          try {
            await receiveEmail(deps, source);
          } catch (err) {
            deps.logger.warn({ err, uid }, 'could not read an email from the mailbox');
          }
        }
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        handled++;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return handled;
}
