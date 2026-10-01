import { avatarPreset, MAX_AVATAR_BYTES } from '@et/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { user, userAvatars, workspaceMembers } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';

/*
 * Profile pictures. `user.image` holds "preset:<key>" for a ready-made avatar or
 * "photo:<version>" when a photo is stored in `user_avatars`; the API hands out
 * "preset:<key>" or the photo's address (the version changes when the photo does, so the
 * browser can keep it cached).
 */

/** What the API shows for a user's `image`. */
export function avatarValue(userId: string, image: string | null): string | null {
  if (!image) return null;
  if (avatarPreset(image)) return image;
  if (image.startsWith('photo:')) {
    return `/api/v1/avatars/${encodeURIComponent(userId)}?v=${image.slice('photo:'.length)}`;
  }
  return null;
}

/** JPEG, PNG or WebP, judged by the bytes rather than what the browser claims. */
function imageType(data: Buffer): string | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export async function setAvatarPhoto(db: Db, userId: string, data: Buffer): Promise<void> {
  if (data.length === 0) throw badRequest('The photo is empty');
  if (data.length > MAX_AVATAR_BYTES) throw badRequest('The photo is too large (at most 512 KB)');
  const contentType = imageType(data);
  if (!contentType) throw badRequest('Use a JPG, PNG or WebP photo');
  await db.transaction(async (tx) => {
    await tx
      .insert(userAvatars)
      .values({ userId, contentType, data })
      .onConflictDoUpdate({
        target: userAvatars.userId,
        set: { contentType, data, updatedAt: sql`now()` },
      });
    await tx
      .update(user)
      .set({ image: `photo:${Date.now().toString(36)}` })
      .where(eq(user.id, userId));
  });
}

/** A ready-made avatar, or none; either way an uploaded photo is let go. */
export async function setAvatarChoice(db: Db, userId: string, choice: string | null) {
  await db.transaction(async (tx) => {
    await tx.delete(userAvatars).where(eq(userAvatars.userId, userId));
    await tx.update(user).set({ image: choice }).where(eq(user.id, userId));
  });
}

/** Someone's photo, for themselves or anyone who shares a workspace with them. */
export async function getAvatarPhoto(db: Db, viewerId: string, userId: string) {
  if (viewerId !== userId) {
    const theirs = db
      .select({ id: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));
    const [shared] = await db
      .select({ id: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.userId, viewerId),
          sql`${workspaceMembers.workspaceId} in ${theirs}`,
        ),
      )
      .limit(1);
    if (!shared) throw notFound('Photo');
  }
  const [row] = await db.select().from(userAvatars).where(eq(userAvatars.userId, userId));
  if (!row) throw notFound('Photo');
  return row;
}
