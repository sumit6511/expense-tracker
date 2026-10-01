import { z } from 'zod';

/*
 * Profile pictures: either one of these ready-made avatars or a photo the person uploads.
 * A user's `avatar` is "preset:<key>", the address of their photo, or null (initials).
 */

export const AVATAR_PRESETS = [
  'mountain',
  'rhododendron',
  'sun',
  'moon',
  'leaf',
  'bird',
  'panda',
  'cat',
  'dog',
  'rabbit',
  'turtle',
  'fish',
  'tea',
  'bike',
  'rocket',
  'music',
] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

/** What can be chosen through PATCH /me (a photo is uploaded separately). */
export const AvatarChoiceSchema = z.enum(AVATAR_PRESETS.map((k) => `preset:${k}` as const));

/** The largest photo the server keeps; the app shrinks photos to 256 × 256 before sending. */
export const MAX_AVATAR_BYTES = 512 * 1024;

/** The preset key of an avatar value, or null for a photo or none. */
export function avatarPreset(avatar: string | null | undefined): AvatarPreset | null {
  if (!avatar?.startsWith('preset:')) return null;
  const key = avatar.slice('preset:'.length);
  return (AVATAR_PRESETS as readonly string[]).includes(key) ? (key as AvatarPreset) : null;
}
