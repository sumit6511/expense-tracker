import { z } from 'zod';
import { Id } from './schemas';

/**
 * Notifications: bills coming due, budgets running out, recurring items recorded automatically,
 * goals reached, and insights worth acting on (an account that may run dry, a price rise). Each person chooses which kinds they want, and whether to get them by
 * email too (when the server can send email).
 */
export const NOTIFICATION_KINDS = ['bill', 'budget', 'recurring', 'goal', 'insight'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NotificationSchema = z.object({
  id: Id,
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string(),
  /** In-app path to open, e.g. "/recurring". */
  link: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListSchema = z.object({
  items: z.array(NotificationSchema),
  unreadCount: z.number().int(),
});
export type NotificationList = z.infer<typeof NotificationListSchema>;

export const MarkNotificationsReadSchema = z
  .object({
    /** Mark these as read… */
    ids: z.array(Id).min(1).max(200).optional(),
    /** …or everything in this workspace. */
    workspaceId: Id.optional(),
  })
  .refine((v) => (v.ids ? 1 : 0) + (v.workspaceId ? 1 : 0) === 1, {
    error: 'Give either ids or workspaceId',
  });
export type MarkNotificationsRead = z.infer<typeof MarkNotificationsReadSchema>;

export const NotificationPrefsSchema = z.object({
  /** Also send by email (only when the server has email set up). */
  email: z.boolean(),
  bills: z.boolean(),
  budgets: z.boolean(),
  recurring: z.boolean(),
  goals: z.boolean(),
  insights: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

export const NotificationSettingsSchema = NotificationPrefsSchema.extend({
  /** Whether this server can send email at all. */
  emailAvailable: z.boolean(),
});
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

export const UpdateNotificationPrefsSchema = NotificationPrefsSchema.partial();
export type UpdateNotificationPrefs = z.infer<typeof UpdateNotificationPrefsSchema>;

/** Which preference switches a kind on or off. */
export const PREF_FOR_KIND: Record<NotificationKind, keyof Omit<NotificationPrefs, 'email'>> = {
  bill: 'bills',
  budget: 'budgets',
  recurring: 'recurring',
  goal: 'goals',
  insight: 'insights',
};
