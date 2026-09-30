import {
  CreateInvitationSchema,
  InvitationCreatedSchema,
  InvitationPreviewSchema,
  MembersSchema,
  TransferOwnershipSchema,
  UpdateMemberSchema,
  WorkspaceSchema,
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
  WidIdParams,
  WidParams,
} from '../lib/openapi';
import {
  acceptInvitation,
  createInvitation,
  leaveWorkspace,
  listMembers,
  previewInvitation,
  removeMember,
  renewInvitation,
  revokeInvitation,
  transferOwnership,
  updateMemberRole,
} from '../services/members';

export const membersRouter = createRouter();

const tags = ['Members'];
const MemberParams = z.object({ wid: z.uuid(), userId: z.string().min(1).max(100) });
const TokenParams = z.object({ token: z.string().min(1).max(200) });

membersRouter.openapi(
  createRoute({
    method: 'get',
    path: '/workspaces/{wid}/members',
    tags,
    summary: 'Members, and open invitations (for owners and admins)',
    request: { params: WidParams },
    responses: { 200: jsonContent(MembersSchema), ...errorResponses },
  }),
  async (c) => c.json(await listMembers(c.get('deps').db, c.get('workspace')), 200),
);

membersRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/invitations',
    tags,
    summary: 'Invite someone by email; returns the link to share',
    request: { params: WidParams, ...jsonBody(CreateInvitationSchema) },
    responses: { 201: jsonContent(InvitationCreatedSchema, 'Created'), ...errorResponses },
  }),
  async (c) => {
    const { db, mailer, env, logger } = c.get('deps');
    const created = await createInvitation(
      { db, mailer, publicUrl: env.PUBLIC_URL, logger },
      c.get('workspace'),
      requireUser(c.get('user')),
      c.req.valid('json'),
    );
    return c.json(created, 201);
  },
);

membersRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/invitations/{id}/renew',
    tags,
    summary: 'Make a new link for an invitation (the old one stops working)',
    request: { params: WidIdParams },
    responses: { 200: jsonContent(InvitationCreatedSchema), ...errorResponses },
  }),
  async (c) => {
    const { db, mailer, env, logger } = c.get('deps');
    const renewed = await renewInvitation(
      { db, mailer, publicUrl: env.PUBLIC_URL, logger },
      c.get('workspace'),
      requireUser(c.get('user')),
      c.req.valid('param').id,
    );
    return c.json(renewed, 200);
  },
);

membersRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/invitations/{id}',
    tags,
    summary: 'Cancel an invitation',
    request: { params: WidIdParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await revokeInvitation(c.get('deps').db, c.get('workspace'), c.req.valid('param').id);
    return c.body(null, 204);
  },
);

membersRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/workspaces/{wid}/members/{userId}',
    tags,
    summary: 'Change a member’s role',
    request: { params: MemberParams, ...jsonBody(UpdateMemberSchema) },
    responses: { 200: jsonContent(MembersSchema), ...errorResponses },
  }),
  async (c) => {
    const { userId } = c.req.valid('param');
    const { role } = c.req.valid('json');
    return c.json(await updateMemberRole(c.get('deps').db, c.get('workspace'), userId, role), 200);
  },
);

membersRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/workspaces/{wid}/members/{userId}',
    tags,
    summary: 'Remove a member (their past transactions stay)',
    request: { params: MemberParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    await removeMember(c.get('deps').db, c.get('workspace'), c.req.valid('param').userId);
    return c.body(null, 204);
  },
);

membersRouter.openapi(
  createRoute({
    method: 'post',
    path: '/workspaces/{wid}/transfer-ownership',
    tags,
    summary: 'Make another member the owner (you become an admin)',
    request: { params: WidParams, ...jsonBody(TransferOwnershipSchema) },
    responses: { 200: jsonContent(MembersSchema), ...errorResponses },
  }),
  async (c) =>
    c.json(
      await transferOwnership(c.get('deps').db, c.get('workspace'), c.req.valid('json').userId),
      200,
    ),
);

// Outside /workspaces/{wid} so that viewers (who can't write there) can still leave.
membersRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/me/workspaces/{wid}',
    tags,
    summary: 'Leave a workspace',
    request: { params: WidParams },
    responses: { 204: NoContent, ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    await leaveWorkspace(c.get('deps').db, user.id, c.req.valid('param').wid);
    return c.body(null, 204);
  },
);

membersRouter.openapi(
  createRoute({
    method: 'get',
    path: '/invitations/{token}',
    tags,
    summary: 'What an invitation link is for (no sign-in needed)',
    request: { params: TokenParams },
    responses: { 200: jsonContent(InvitationPreviewSchema), ...errorResponses },
  }),
  async (c) => c.json(await previewInvitation(c.get('deps').db, c.req.valid('param').token), 200),
);

membersRouter.openapi(
  createRoute({
    method: 'post',
    path: '/invitations/{token}/accept',
    tags,
    summary: 'Join the workspace (signed in with the invited email address)',
    request: { params: TokenParams },
    responses: { 200: jsonContent(WorkspaceSchema), ...errorResponses },
  }),
  async (c) => {
    const user = requireUser(c.get('user'));
    return c.json(await acceptInvitation(c.get('deps').db, c.req.valid('param').token, user), 200);
  },
);
