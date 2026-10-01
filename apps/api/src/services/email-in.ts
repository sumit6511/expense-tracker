import { randomBytes } from 'node:crypto';
import {
  type Account,
  type CreateTransactionInput,
  CreateTransactionSchema,
  currencyDigits,
  type EmailIn,
  type EmailSenderInput,
  type InboundEmail,
  type InboundEmailStatus,
  MAX_ATTACHMENT_BYTES,
  parseBankSms,
  parseQuickText,
  type Role,
  uuidv7,
} from '@et/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { simpleParser } from 'mailparser';
import type { AiProvider } from '../ai/provider';
import type { WorkspaceCtx } from '../context';
import type { Db } from '../db/client';
import {
  emailSenders,
  inboundEmailFiles,
  inboundEmails,
  transactions,
  user,
  workspaceMembers,
  workspaces,
} from '../db/schema';
import type { Env } from '../env';
import { ApiError, forbidden, notFound } from '../lib/errors';
import type { Logger } from '../logger';
import { listAccounts } from './accounts';
import { draftFromText, scanReceipt } from './ai';
import { addAttachment, sniffType } from './attachments';
import { listCategoryGroups } from './categories';
import { commitImport, previewImport } from './imports';
import { createTransaction, getTransaction, workspaceToday } from './transactions';
import { isHidden, memberContext } from './visibility';

const MANAGERS: readonly Role[] = ['owner', 'admin'];
const WRITERS: readonly Role[] = ['owner', 'admin', 'editor'];
/** The secret in an address: "et" and 14 base-32 characters (70 random bits). */
const TOKEN_RE = /\bet[a-z2-7]{14}\b/g;
const MAX_FILES = 5;

export interface EmailInDeps {
  db: Db;
  env: Env;
  ai: AiProvider | null;
  logger: Logger;
}

function newToken() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  return `et${[...randomBytes(14)].map((b) => alphabet[b % 32]).join('')}`;
}

export const emailAddress = (env: Pick<Env, 'EMAIL_IN_ADDRESS'>, token: string) =>
  env.EMAIL_IN_ADDRESS?.replace('{token}', token) ?? null;

function requireManager(ws: WorkspaceCtx) {
  if (!MANAGERS.includes(ws.role)) throw forbidden('Only owners and admins can change email in');
}

/** The workspace's token, made the first time someone looks. */
async function ensureToken(db: Db, workspaceId: string) {
  const [row] = await db
    .select({ token: workspaces.emailInToken })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (row?.token) return row.token;
  const [made] = await db
    .update(workspaces)
    .set({ emailInToken: sql`coalesce(${workspaces.emailInToken}, ${newToken()})` })
    .where(eq(workspaces.id, workspaceId))
    .returning({ token: workspaces.emailInToken });
  return made!.token!;
}

export async function getEmailIn(db: Db, env: Env, ws: WorkspaceCtx): Promise<EmailIn> {
  const available = Boolean(env.EMAIL_IN_ADDRESS);
  const token = available ? await ensureToken(db, ws.id) : null;
  const [settings] = await db
    .select({ accountId: workspaces.emailInAccountId })
    .from(workspaces)
    .where(eq(workspaces.id, ws.id));
  const senders = await db
    .select()
    .from(emailSenders)
    .where(eq(emailSenders.workspaceId, ws.id))
    .orderBy(asc(emailSenders.sender));
  return {
    available,
    address: token ? emailAddress(env, token) : null,
    defaultAccountId: settings?.accountId ?? null,
    senders: senders.map((s) => ({
      id: s.id,
      sender: s.sender,
      accountId: s.accountId,
      createdAt: s.createdAt.toISOString(),
    })),
    messages: await listMessages(db, ws),
  };
}

async function listMessages(db: Db, ws: WorkspaceCtx): Promise<InboundEmail[]> {
  const rows = await db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.workspaceId, ws.id))
    .orderBy(desc(inboundEmails.receivedAt), desc(inboundEmails.id))
    .limit(50);
  // Mail about someone's private account is theirs alone.
  const visible = rows.filter((r) => !isHidden(ws, r.accountId));
  const files = visible.length
    ? await db
        .select({
          id: inboundEmailFiles.id,
          emailId: inboundEmailFiles.inboundEmailId,
          fileName: inboundEmailFiles.fileName,
          contentType: inboundEmailFiles.contentType,
          sizeBytes: inboundEmailFiles.sizeBytes,
        })
        .from(inboundEmailFiles)
        .where(
          inArray(
            inboundEmailFiles.inboundEmailId,
            visible.map((r) => r.id),
          ),
        )
    : [];
  return visible.map((r) => ({
    id: r.id,
    from: r.fromAddress,
    fromName: r.fromName,
    subject: r.subject,
    receivedAt: r.receivedAt.toISOString(),
    status: r.status,
    detail: r.detail,
    transactionIds: r.transactionIds,
    files: files.filter((f) => f.emailId === r.id).map(({ emailId: _, ...f }) => f),
    draft: (r.draft as InboundEmail['draft']) ?? null,
  }));
}

async function requireVisibleAccount(db: Db, ws: WorkspaceCtx, accountId: string | null) {
  if (accountId === null) return;
  const account = (await listAccounts(db, ws)).find((a) => a.id === accountId);
  if (!account || account.archived) throw notFound('Account');
}

export async function updateEmailIn(
  db: Db,
  env: Env,
  ws: WorkspaceCtx,
  input: { defaultAccountId: string | null },
) {
  requireManager(ws);
  await requireVisibleAccount(db, ws, input.defaultAccountId);
  await db
    .update(workspaces)
    .set({ emailInAccountId: input.defaultAccountId })
    .where(eq(workspaces.id, ws.id));
  return getEmailIn(db, env, ws);
}

/** A new address; mail to the old one is no longer read. */
export async function newEmailAddress(db: Db, env: Env, ws: WorkspaceCtx) {
  requireManager(ws);
  if (!env.EMAIL_IN_ADDRESS) throw new ApiError(409, 'unavailable', 'Email in isn’t set up');
  await db.update(workspaces).set({ emailInToken: newToken() }).where(eq(workspaces.id, ws.id));
  return getEmailIn(db, env, ws);
}

export async function addSender(db: Db, env: Env, ws: WorkspaceCtx, input: EmailSenderInput) {
  requireManager(ws);
  await requireVisibleAccount(db, ws, input.accountId);
  await db
    .insert(emailSenders)
    .values({ id: uuidv7(), workspaceId: ws.id, sender: input.sender, accountId: input.accountId })
    .onConflictDoUpdate({
      target: [emailSenders.workspaceId, emailSenders.sender],
      set: { accountId: input.accountId },
    });
  return getEmailIn(db, env, ws);
}

export async function removeSender(db: Db, env: Env, ws: WorkspaceCtx, id: string) {
  requireManager(ws);
  const gone = await db
    .delete(emailSenders)
    .where(and(eq(emailSenders.workspaceId, ws.id), eq(emailSenders.id, id)))
    .returning({ id: emailSenders.id });
  if (gone.length === 0) throw notFound('Sender');
  return getEmailIn(db, env, ws);
}

async function requireMessage(db: Db, ws: WorkspaceCtx, id: string) {
  const [row] = await db
    .select()
    .from(inboundEmails)
    .where(and(eq(inboundEmails.workspaceId, ws.id), eq(inboundEmails.id, id)));
  if (!row || isHidden(ws, row.accountId)) throw notFound('Email');
  return row;
}

export async function getInboundFile(db: Db, ws: WorkspaceCtx, emailId: string, fileId: string) {
  await requireMessage(db, ws, emailId);
  const [file] = await db
    .select()
    .from(inboundEmailFiles)
    .where(and(eq(inboundEmailFiles.inboundEmailId, emailId), eq(inboundEmailFiles.id, fileId)));
  if (!file) throw notFound('File');
  return file;
}

/** Forget an email (and any files kept from it). */
export async function dismissEmail(db: Db, ws: WorkspaceCtx, id: string) {
  if (!WRITERS.includes(ws.role)) throw forbidden();
  await requireMessage(db, ws, id);
  await db.delete(inboundEmails).where(eq(inboundEmails.id, id));
}

/** Records the transaction a person filled in for an email, with the email's files attached. */
export async function recordFromEmail(
  db: Db,
  ws: WorkspaceCtx,
  id: string,
  input: CreateTransactionInput,
) {
  if (!WRITERS.includes(ws.role)) throw forbidden();
  const message = await requireMessage(db, ws, id);
  if (message.status !== 'needs_review') {
    throw new ApiError(409, 'already_handled', 'This email has already been dealt with');
  }
  const { transaction } = await createTransaction(
    db,
    ws,
    ws.userId,
    CreateTransactionSchema.parse(input),
  );
  await attachFiles(db, ws, ws.userId, message.id, transaction.id);
  await db
    .update(inboundEmails)
    .set({
      status: 'recorded',
      detail: 'Added by hand',
      transactionIds: [transaction.id],
      accountId: transaction.accountId,
    })
    .where(eq(inboundEmails.id, message.id));
  return getTransaction(db, ws, transaction.id);
}

/** Marks an email as handled by a transaction someone added themselves (its files go). */
export async function linkEmail(db: Db, ws: WorkspaceCtx, id: string, transactionId: string) {
  if (!WRITERS.includes(ws.role)) throw forbidden();
  const message = await requireMessage(db, ws, id);
  const transaction = await getTransaction(db, ws, transactionId);
  await db.delete(inboundEmailFiles).where(eq(inboundEmailFiles.inboundEmailId, message.id));
  await db
    .update(inboundEmails)
    .set({
      status: 'recorded',
      detail: 'Added by hand',
      transactionIds: [transaction.id],
      accountId: transaction.accountId,
    })
    .where(eq(inboundEmails.id, message.id));
}

/** Moves an email's kept files onto a transaction. Returns notes about files that didn't fit. */
async function attachFiles(
  db: Db,
  ws: WorkspaceCtx,
  userId: string,
  emailId: string,
  transactionId: string,
) {
  const files = await db
    .select()
    .from(inboundEmailFiles)
    .where(eq(inboundEmailFiles.inboundEmailId, emailId));
  const problems: string[] = [];
  for (const f of files) {
    try {
      await addAttachment(db, ws, userId, transactionId, { name: f.fileName, data: f.data });
    } catch (err) {
      problems.push(`${f.fileName}: ${err instanceof Error ? err.message : 'not attached'}`);
    }
  }
  await db.delete(inboundEmailFiles).where(eq(inboundEmailFiles.inboundEmailId, emailId));
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------------------------

/** Words that make a forwarded email look like a bank or wallet alert. */
const ALERT_WORDS =
  /\b(debit(ed)?|credit(ed)?|withdrawn|deposit(ed)?|transferred|a\/c|account\s+no)\b/i;

const plain = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');

function senderMatches(pattern: string, from: string) {
  return pattern.startsWith('@') ? from.endsWith(pattern) : pattern === from;
}

interface Draft {
  accountId: string | null;
  date: string | null;
  /** Signed: negative = money out. */
  amountMinor: number | null;
  currency: string | null;
  payee: string | null;
  notes: string | null;
  categoryId: string | null;
  externalId: string | null;
  how: string;
}

/**
 * Takes one raw email (RFC 822) and does what it says for every workspace it's addressed to.
 * `envelopeTo` is the address the mail service delivered it to, when it says.
 */
export async function receiveEmail(
  deps: EmailInDeps,
  raw: Buffer | string,
  envelopeTo?: string,
): Promise<Array<{ workspaceId: string; status: InboundEmailStatus }>> {
  const { db, logger } = deps;
  const mail = await simpleParser(raw);
  // The token can be in To, Cc, Delivered-To (auto-forwarded mail) or the envelope.
  const headerText = [...mail.headerLines.map((h) => h.line), envelopeTo ?? '']
    .join('\n')
    .toLowerCase();
  const tokens = [...new Set(headerText.match(TOKEN_RE) ?? [])];
  if (tokens.length === 0) return [];
  const targets = await db
    .select({ id: workspaces.id, accountId: workspaces.emailInAccountId })
    .from(workspaces)
    .where(inArray(workspaces.emailInToken, tokens));

  const from = mail.from?.value[0]?.address?.toLowerCase() ?? '';
  const fromName = (mail.from?.value[0]?.name ?? '').slice(0, 120);
  const subject = (mail.subject ?? '').trim().slice(0, 300);
  const messageId = mail.messageId?.slice(0, 500) ?? null;
  const text = (mail.text ?? (typeof mail.html === 'string' ? plain(mail.html) : ''))
    .replace(/[ \t]+/g, ' ')
    .slice(0, 20_000);
  const files = mail.attachments.filter((a) => sniffType(a.content) !== null).slice(0, MAX_FILES);

  const results: Array<{ workspaceId: string; status: InboundEmailStatus }> = [];
  for (const target of targets) {
    if (messageId) {
      const [seen] = await db
        .select({ id: inboundEmails.id })
        .from(inboundEmails)
        .where(
          and(eq(inboundEmails.workspaceId, target.id), eq(inboundEmails.messageId, messageId)),
        );
      if (seen) continue; // delivered twice
    }
    try {
      const status = await receiveFor(deps, target, {
        from,
        fromName,
        subject,
        messageId,
        text,
        files: files.map((f) => ({
          name: f.filename ?? 'receipt',
          data: f.content,
          mediaType: sniffType(f.content)!.type,
        })),
      });
      results.push({ workspaceId: target.id, status });
    } catch (err) {
      logger.error({ err, workspaceId: target.id }, 'could not read an incoming email');
    }
  }
  return results;
}

interface Received {
  from: string;
  fromName: string;
  subject: string;
  messageId: string | null;
  text: string;
  files: Array<{ name: string; data: Buffer; mediaType: string }>;
}

async function receiveFor(
  deps: EmailInDeps,
  target: { id: string; accountId: string | null },
  mail: Received,
): Promise<InboundEmailStatus> {
  const { db } = deps;
  const people = await db
    .select({ userId: workspaceMembers.userId, email: user.email, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, target.id));
  const member = people.find((p) => p.email.toLowerCase() === mail.from);
  const senders = await db
    .select()
    .from(emailSenders)
    .where(eq(emailSenders.workspaceId, target.id));
  const trusted = senders
    .filter((s) => senderMatches(s.sender, mail.from))
    // An exact address beats a whole domain.
    .sort((a, b) => Number(a.sender.startsWith('@')) - Number(b.sender.startsWith('@')))[0];

  const log = (
    values: Partial<typeof inboundEmails.$inferInsert> & { status: InboundEmailStatus },
  ) =>
    db
      .insert(inboundEmails)
      .values({
        id: uuidv7(),
        workspaceId: target.id,
        messageId: mail.messageId,
        fromAddress: mail.from,
        fromName: mail.fromName,
        subject: mail.subject,
        userId: member?.userId ?? null,
        ...values,
      })
      .returning({ id: inboundEmails.id });

  if (!member && !trusted) {
    await log({
      status: 'ignored',
      detail: 'Not from a member or a trusted sender',
    });
    return 'ignored';
  }

  // Work as the member who sent it; a bank's mail is handled as the owner (and added by nobody).
  const actor = member ?? people.find((p) => p.role === 'owner') ?? people[0]!;
  const ws = (await memberContext(db, target.id, actor.userId))!;
  const today = workspaceToday(ws);
  const accounts = (await listAccounts(db, ws)).filter((a) => !a.archived);
  const fallback =
    accounts.find((a) => a.id === (trusted?.accountId ?? target.accountId)) ??
    accounts.find((a) => ['cash', 'checking', 'e_wallet', 'credit_card'].includes(a.type)) ??
    accounts[0] ??
    null;
  const subjectWords = mail.subject.replace(/^((re|fwd?|fw)\s*:\s*)+/i, '').trim();
  const notes: string[] = [];

  let draft: Draft | null = null;
  // 1. A member's own words: "lunch 450 eSewa" as the subject.
  if (member && subjectWords) {
    const groups = await listCategoryGroups(db, ws);
    const q = parseQuickText(subjectWords, {
      today,
      digits: currencyDigits(fallback?.currency ?? ws.baseCurrency),
      accounts,
      categories: groups.flatMap((g) =>
        g.categories.map((c) => ({ id: c.id, name: c.name, kind: g.kind })),
      ),
    });
    if (q.amountMinor !== null) {
      draft = {
        accountId: q.accountId,
        date: q.date,
        amountMinor: q.direction === 'income' ? q.amountMinor : -q.amountMinor,
        currency: null,
        payee: q.payee,
        notes: q.notes,
        categoryId: q.categoryId,
        externalId: null,
        how: 'Read from the subject',
      };
    }
  }
  // 2. A bank or wallet alert (from a trusted sender, or forwarded by a member).
  const alertText = `${subjectWords}. ${mail.text}`.replace(/\s+/g, ' ');
  if (!draft && (trusted || ALERT_WORDS.test(alertText))) {
    const [row] = parseBankSms(alertText, {
      today,
      digits: currencyDigits(fallback?.currency ?? ws.baseCurrency),
    }).rows;
    if (row) {
      draft = {
        accountId: null,
        date: row.date,
        amountMinor: row.amountMinor,
        currency: row.currency,
        payee: row.payee || null,
        notes: null,
        categoryId: null,
        externalId: row.externalId,
        how: 'Read as a bank alert',
      };
    }
  }
  // 3. The AI helpers, when the workspace uses them: the receipt, else the text.
  if (!draft && deps.ai && ws.aiEnabled && (mail.files.length || mail.text.trim())) {
    try {
      const ai = mail.files[0]
        ? await scanReceipt(deps, ws, mail.files[0])
        : await draftFromText(deps, ws, {
            text: `${subjectWords}\n${mail.text}`.slice(0, 4000),
            accountId: fallback?.id ?? null,
          });
      if (ai.amountMinor !== null) {
        draft = {
          accountId: ai.accountId,
          date: ai.date,
          amountMinor: ai.direction === 'income' ? ai.amountMinor : -ai.amountMinor,
          currency: ai.currency,
          payee: ai.payee,
          notes: ai.notes,
          categoryId: ai.categoryId,
          externalId: null,
          how: 'Read with AI help',
        };
      }
    } catch (err) {
      notes.push(`AI couldn’t read it (${err instanceof Error ? err.message : 'failed'})`);
    }
  }

  // Which account: the one named, else the sender's or the default; it must match the currency.
  let account: Account | null = accounts.find((a) => a.id === draft?.accountId) ?? fallback ?? null;
  if (draft?.currency && account && account.currency !== draft.currency) {
    account = accounts.find((a) => a.currency === draft!.currency) ?? null;
    if (!account) notes.push(`It’s in ${draft.currency} and there’s no ${draft.currency} account`);
  }

  if (!draft || draft.amountMinor === null || !account) {
    if (!draft) {
      notes.unshift(
        mail.files.length && !(deps.ai && ws.aiEnabled)
          ? 'No amount in the subject; turn on AI helpers to read receipts'
          : 'Couldn’t find an amount',
      );
    }
    const [row] = await log({
      status: 'needs_review',
      detail: notes.join('. '),
      accountId: account?.id ?? null,
      draft: {
        accountId: account?.id ?? null,
        date: draft?.date ?? null,
        amountMinor: draft?.amountMinor ?? null,
        payee: draft?.payee ?? null,
        notes: draft?.notes ?? (subjectWords || null),
      },
    });
    for (const f of mail.files) {
      if (f.data.length > MAX_ATTACHMENT_BYTES) continue;
      await db.insert(inboundEmailFiles).values({
        id: uuidv7(),
        inboundEmailId: row!.id,
        fileName: f.name.slice(0, 200),
        contentType: f.mediaType,
        sizeBytes: f.data.length,
        data: f.data,
      });
    }
    return 'needs_review';
  }

  const row = {
    date: draft.date ?? today,
    amountMinor: draft.amountMinor,
    payee: draft.payee ?? '',
    description: mail.subject.slice(0, 500),
    notes: draft.notes ?? '',
    externalId: draft.externalId,
  };
  const [preview] = (await previewImport(db, ws, account.id, [row])).rows;
  if (preview?.duplicateOfId) {
    await log({
      status: 'duplicate',
      detail: 'You already have this transaction',
      accountId: account.id,
      transactionIds: [preview.duplicateOfId],
    });
    return 'duplicate';
  }
  const batch = await commitImport(db, ws, member?.userId ?? null, {
    accountId: account.id,
    fileName: `Email: ${mail.subject || mail.from}`.slice(0, 200),
    source: 'email',
    rows: [
      {
        ...row,
        ...(draft.categoryId ? { categoryId: draft.categoryId } : {}),
        skip: false,
      },
    ],
  });
  const created = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.importBatchId, batch.id));
  if (created.length === 0) {
    await log({
      status: 'duplicate',
      detail: 'You already have this transaction (same reference)',
      accountId: account.id,
    });
    return 'duplicate';
  }
  const [inserted] = await log({
    status: 'recorded',
    detail: [draft.how, ...notes].join('. '),
    accountId: account.id,
    transactionIds: created.map((c) => c.id),
  });
  // Receipts go on the transaction (the inbound row only keeps them while it waits).
  for (const f of mail.files) {
    try {
      await addAttachment(db, ws, actor.userId, created[0]!.id, { name: f.name, data: f.data });
    } catch (err) {
      notes.push(`${f.name} wasn’t attached: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }
  if (notes.length) {
    await db
      .update(inboundEmails)
      .set({ detail: [draft.how, ...notes].join('. ') })
      .where(eq(inboundEmails.id, inserted!.id));
  }
  return 'recorded';
}

/** Forgets old mail: files after 30 days, the log after 90. */
export async function pruneInboundEmails(db: Db) {
  await db.execute(sql`
    delete from inbound_email_files f using inbound_emails e
    where f.inbound_email_id = e.id and e.received_at < now() - interval '30 days'
  `);
  await db.execute(sql`delete from inbound_emails where received_at < now() - interval '90 days'`);
}
