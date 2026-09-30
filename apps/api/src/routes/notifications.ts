import {
  Id,
  MarkNotificationsReadSchema,
  NotificationListSchema,
  NotificationSettingsSchema,
  PushDeviceSchema,
  PushEndpointSchema,
  PushSettingsSchema,
  PushSubscribeSchema,
  UpdateNotificationPrefsSchema,
} from '@et/shared';
import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  createRouter,
  errorResponses,
  jsonBody,
  jsonContent,
  NoContent,
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
import {
  pushSettings,
  removePushDevice,
  sendTestPush,
  subscribePush,
  unsubscribePush,
} from '../services/push';

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

// Web Push ------------------------------------------------------------------------------------

notificationsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/me/push',
    tags,
    summary: 'Whether push notifications are available, and your devices that get them',
    responses: { 200: jsonContent(PushSettingsSchema), 401: errorResponses[401] },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    const { db, pusher } = c.get('deps');
    return c.json(await pushSettings(db, user.id, pusher), 200);
  },
);

notificationsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/me/push/subscriptions',
    tags,
    summary: 'Get push notifications on this device',
    request: jsonBody(PushSubscribeSchema),
    responses: { 201: jsonContent(PushDeviceSchema, 'Subscribed'), ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    const { db, env, pusher } = c.get('deps');
    return c.json(await subscribePush(db, env, pusher, user.id, c.req.valid('json')), 201);
  },
);

notificationsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/me/push/unsubscribe',
    tags,
    summary: 'Stop push notifications on this device',
    request: jsonBody(PushEndpointSchema),
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    await unsubscribePush(c.get('deps').db, user.id, c.req.valid('json').endpoint);
    return c.body(null, 204);
  },
);

notificationsRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/me/push/subscriptions/{id}',
    tags,
    summary: 'Stop push notifications on one of your devices',
    request: { params: z.object({ id: Id }) },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    await removePushDevice(c.get('deps').db, user.id, c.req.valid('param').id);
    return c.body(null, 204);
  },
);

notificationsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/me/push/test',
    tags,
    summary: 'Send a test notification to your devices',
    responses: {
      200: jsonContent(z.object({ sent: z.number() })),
      ...errorResponses,
    },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    const { db, pusher } = c.get('deps');
    return c.json(await sendTestPush(db, pusher, user.id), 200);
  },
);
