import { z } from 'zod';
import { Id, IsoDateSchema, TransactionSchema } from './schemas';

// ---------------------------------------------------------------------------------------------
// Change history
// ---------------------------------------------------------------------------------------------

export const TransactionChangeSchema = z.object({
  id: Id,
  action: z.enum(['update', 'delete', 'restore', 'reconcile']),
  at: z.string(),
  userName: z.string().nullable(),
  /**
   * field → [before, after]. Fields: date, amount, account (id), payee, notes, status, review,
   * categories ([[categoryId]] or split lines [[categoryId, amount], …]), tags (ids).
   */
  changes: z.record(z.string(), z.tuple([z.unknown(), z.unknown()])),
});
export type TransactionChange = z.infer<typeof TransactionChangeSchema>;

// ---------------------------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------------------------

export const ReconcileQuerySchema = z.object({
  /** Statement closing date: transactions after it are left out. Defaults to today. */
  statementDate: IsoDateSchema.optional(),
});

export const ReconciliationSchema = z.object({
  id: Id,
  accountId: Id,
  statementDate: z.string(),
  statementBalanceMinor: z.number(),
  adjustmentMinor: z.number(),
  transactionCount: z.number(),
  createdAt: z.string(),
});
export type Reconciliation = z.infer<typeof ReconciliationSchema>;

export const ReconcileStateSchema = z.object({
  currency: z.string(),
  /** Opening balance plus everything already reconciled. */
  reconciledBalanceMinor: z.number(),
  /** Transactions not yet reconciled, up to the statement date (oldest first). */
  candidates: z.array(TransactionSchema),
  last: ReconciliationSchema.nullable(),
});
export type ReconcileState = z.infer<typeof ReconcileStateSchema>;

export const FinishReconcileSchema = z.object({
  statementDate: IsoDateSchema,
  statementBalanceMinor: z.number().int().safe(),
  /** The transactions that appear on the statement. */
  transactionIds: z.array(Id).max(5000),
  /** Add a balancing transaction when the totals still differ. */
  adjust: z.boolean().default(false),
});
export type FinishReconcileInput = z.input<typeof FinishReconcileSchema>;

// ---------------------------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------------------------

export const ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/** A receipt photo or PDF statement sent to the AI helpers. */
export const MAX_AI_FILE_BYTES = 10 * 1024 * 1024;
/** A JSON backup to restore. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export const AttachmentSchema = z.object({
  id: Id,
  transactionId: Id,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;
