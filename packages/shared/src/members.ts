import { z } from 'zod';
import { type Role, RoleSchema } from './schemas';

/**
 * Sharing a workspace: members, their roles, and invitations.
 *
 * - owner:  everything, including deleting the workspace and handing ownership to someone else
 * - admin:  settings and members (except the owner and other admins)
 * - editor: add and change transactions, budgets, accounts…
 * - viewer: read only
 */
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

/** Roles that can be given to someone by invitation or role change (ownership is handed over). */
export const ASSIGNABLE_ROLES = ['admin', 'editor', 'viewer'] as const;
export const AssignableRoleSchema = z.enum(ASSIGNABLE_ROLES);
export type AssignableRole = z.infer<typeof AssignableRoleSchema>;

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Everything, including deleting the workspace',
  admin: 'Everything except deleting the workspace; can manage members',
  editor: 'Add and change transactions, budgets and accounts',
  viewer: 'See everything, change nothing',
};

/** "an editor", "a viewer". */
export const roleWithArticle = (role: Role) => `${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role}`;

/** Can `actor` invite people or change members at all? */
export const canManageMembers = (actor: Role) => actor === 'owner' || actor === 'admin';

/**
 * Can `actor` change the role of, or remove, someone who has role `target`? Owners manage
 * everyone else; admins manage editors and viewers. Nobody manages the owner.
 */
export function canManageMember(actor: Role, target: Role) {
  if (target === 'owner') return false;
  if (actor === 'owner') return true;
  return actor === 'admin' && ROLE_RANK[target] < ROLE_RANK.admin;
}

/** Can `actor` give someone the role `role` (by invitation or change)? */
export function canAssignRole(actor: Role, role: Role) {
  if (role === 'owner') return false;
  if (actor === 'owner') return true;
  return actor === 'admin';
}

export const MemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: RoleSchema,
  joinedAt: z.string(),
  /** The person asking. */
  you: z.boolean(),
  /** Their profile picture: "preset:<key>", a photo's address, or null. */
  avatar: z.string().nullable(),
});
export type Member = z.infer<typeof MemberSchema>;

export const InvitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: RoleSchema,
  invitedByName: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  expired: z.boolean(),
});
export type Invitation = z.infer<typeof InvitationSchema>;

export const MembersSchema = z.object({
  members: z.array(MemberSchema),
  /** Pending invitations (only shown to people who can manage members). */
  invitations: z.array(InvitationSchema),
});
export type Members = z.infer<typeof MembersSchema>;

export const CreateInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email({ error: 'Enter an email address' })),
  role: AssignableRoleSchema.default('editor'),
});
export type CreateInvitationInput = z.input<typeof CreateInvitationSchema>;

export const InvitationCreatedSchema = z.object({
  invitation: InvitationSchema,
  /** The link to share. Only shown now: the server keeps just a hash of it. */
  link: z.string(),
  /** Whether it was also sent by email (only when the server can send email). */
  emailed: z.boolean(),
});
export type InvitationCreated = z.infer<typeof InvitationCreatedSchema>;

export const UpdateMemberSchema = z.object({ role: AssignableRoleSchema });
export const TransferOwnershipSchema = z.object({ userId: z.string().min(1).max(100) });

export const InvitationPreviewSchema = z.object({
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  invitedByName: z.string().nullable(),
  role: RoleSchema,
  email: z.string(),
  status: z.enum(['pending', 'expired', 'accepted']),
});
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;

/** Invitation links stop working after this many days. */
export const INVITATION_DAYS = 7;
