import {
  MarkNotificationsReadSchema,
  NotificationListSchema,
  NotificationSettingsSchema,
  UpdateNotificationPrefsSchema,
} from '@et/shared';
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  createRouter,
  errorResponses,
  jsonBody,
  jsonContent,
  requireUser,
  WidParams,
} from '../lib/openapi';
import {
  getNotificationSettings,
  listNotifications,
  markRead,
  refreshNotifications,
  updateNotificationSettings,
} from '../services/notifications';

export const notificationsRouter = createRouter();

const tags = ['Notifications'];

notificationsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/notifications',
    tags,
    summary: 'Your latest notifications in this workspace (checks for new ones first)',
    request: { params: WidParams },
    responses: { 200: jsonContent(NotificationListSchema), ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    const { db, logger } = c.get('deps');
    const ws = c.get('workspace');
    try {
      await refreshNotifications(db, ws);
    } catch (err) {
      // Still show what's already there.
      logger.warn({ err, workspaceId: ws.id }, 'could not check for new notifications');
    }
    return c.json(await listNotifications(db, user.id, ws.id), 200);
  },
);

notificationsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/me/notifications/read',
    tags,
    summary: 'Mark notifications as read (by id, or all in a workspace)',
    request: jsonBody(MarkNotificationsReadSchema),
    responses: { 200: jsonContent(z.object({ updated: z.number().int() })), ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    return c.json({ updated: await markRead(c.get('deps').db, user.id, c.req.valid('json')) }, 200);
  },
);

notificationsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/me/notification-settings',
    tags,
    summary: 'What you want to be notified about',
    responses: { 200: jsonContent(NotificationSettingsSchema), 401: errorResponses[401] },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    const { db, mailer } = c.get('deps');
    return c.json(await getNotificationSettings(db, user.id, mailer), 200);
  },
);

notificationsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/me/notification-settings',
    tags,
    summary: 'Change what you want to be notified about',
    request: jsonBody(UpdateNotificationPrefsSchema),
    responses: { 200: jsonContent(NotificationSettingsSchema), ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    const { db, mailer } = c.get('deps');
    return c.json(await updateNotificationSettings(db, user.id, c.req.valid('json'), mailer), 200);
  },
);
