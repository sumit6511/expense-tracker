import { type Attachment, MAX_ATTACHMENT_BYTES, uuidv7 } from '@et/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { attachments, transactions } from '../db/schema';
import { ApiError, badRequest, notFound } from '../lib/errors';

/** Per workspace, so one account can't fill the disk. */
export const WORKSPACE_ATTACHMENT_QUOTA = 1024 * 1024 * 1024;
const MAX_PER_TRANSACTION = 10;

/**
 * The file's real type from its first bytes. The name and the browser's claimed type are not
 * trusted, so a renamed HTML file can't be served as an image.
 */
export function sniffType(data: Uint8Array): { type: string; ext: string } | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return { type: 'image/jpeg', ext: 'jpg' };
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    return { type: 'image/png', ext: 'png' };
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  )
    return { type: 'image/webp', ext: 'webp' };
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return { type: 'application/pdf', ext: 'pdf' };
  return null;
}

/** A safe display name: no path, no control characters, the right extension. */
export function cleanFileName(name: string, ext: string) {
  const base = (name.split(/[\\/]/).pop() ?? '')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .replace(/\.[^.]*$/, '')
    .trim()
    .slice(0, 100);
  return `${base || 'receipt'}.${ext}`;
}

function toDto(
  a: Omit<typeof attachments.$inferSelect, 'data' | 'workspaceId' | 'createdBy'>,
): Attachment {
  return {
    id: a.id,
    transactionId: a.transactionId,
    fileName: a.fileName,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt.toISOString(),
  };
}

const listColumns = {
  id: attachments.id,
  transactionId: attachments.transactionId,
  fileName: attachments.fileName,
  contentType: attachments.contentType,
  sizeBytes: attachments.sizeBytes,
  createdAt: attachments.createdAt,
};

async function requireLiveTransaction(db: Db, workspaceId: string, transactionId: string) {
  const [tx] = await db
    .select({ id: transactions.id, deletedAt: transactions.deletedAt })
    .from(transactions)
    .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.id, transactionId)));
  if (!tx || tx.deletedAt) throw notFound('Transaction');
}

export async function listAttachments(db: Db, workspaceId: string, transactionId: string) {
  await requireLiveTransaction(db, workspaceId, transactionId);
  const rows = await db
    .select(listColumns)
    .from(attachments)
    .where(
      and(eq(attachments.workspaceId, workspaceId), eq(attachments.transactionId, transactionId)),
    )
    .orderBy(asc(attachments.createdAt));
  return rows.map(toDto);
}

export async function addAttachment(
  db: Db,
  workspaceId: string,
  userId: string,
  transactionId: string,
  file: { name: string; data: Buffer },
): Promise<Attachment> {
  await requireLiveTransaction(db, workspaceId, transactionId);
  if (file.data.length === 0) throw badRequest('The file is empty');
  if (file.data.length > MAX_ATTACHMENT_BYTES)
    throw new ApiError(413, 'too_large', 'Files can be at most 5 MB');
  const kind = sniffType(file.data);
  if (!kind) throw badRequest('Attach a photo (JPEG, PNG or WebP) or a PDF');

  const id = uuidv7();
  await db.transaction(async (tx) => {
    // One upload at a time per workspace, so the quota can't be overshot by parallel uploads.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);
    const [usage] = await tx
      .select({
        total: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)::bigint`,
        onThis: sql<number>`count(*) filter (where ${attachments.transactionId} = ${transactionId})::int`,
      })
      .from(attachments)
      .where(eq(attachments.workspaceId, workspaceId));
    if (Number(usage?.onThis ?? 0) >= MAX_PER_TRANSACTION)
      throw badRequest(`A transaction can have at most ${MAX_PER_TRANSACTION} files`);
    if (Number(usage?.total ?? 0) + file.data.length > WORKSPACE_ATTACHMENT_QUOTA)
      throw new ApiError(413, 'quota', 'This workspace is out of space for attachments (1 GB)');
    await tx.insert(attachments).values({
      id,
      workspaceId,
      transactionId,
      fileName: cleanFileName(file.name, kind.ext),
      contentType: kind.type,
      sizeBytes: file.data.length,
      data: file.data,
      createdBy: userId,
    });
  });
  const [row] = await db.select(listColumns).from(attachments).where(eq(attachments.id, id));
  return toDto(row!);
}

export async function getAttachmentFile(db: Db, workspaceId: string, id: string) {
  const [row] = await db
    .select({ ...listColumns, data: attachments.data })
    .from(attachments)
    .where(and(eq(attachments.workspaceId, workspaceId), eq(attachments.id, id)));
  if (!row) throw notFound('Attachment');
  return row;
}

export async function deleteAttachment(db: Db, workspaceId: string, id: string) {
  const deleted = await db
    .delete(attachments)
    .where(and(eq(attachments.workspaceId, workspaceId), eq(attachments.id, id)))
    .returning({ id: attachments.id });
  if (deleted.length === 0) throw notFound('Attachment');
}
