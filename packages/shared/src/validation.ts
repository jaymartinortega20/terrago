import { z } from 'zod';
import { ACCOUNT } from './constants';
import { BODY_TYPES, EYE_COLORS, HAIR_COLORS, HAIR_STYLES, OUTFITS, SKIN_TONES } from './appearance';
import { isOffensiveName } from './profanity';
import { CLASS_IDS } from './types';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long.')
  .email('Enter a valid email address.');

export const passwordSchema = z
  .string()
  .min(ACCOUNT.passwordMinLength, `Password must be at least ${ACCOUNT.passwordMinLength} characters.`)
  .max(ACCOUNT.passwordMaxLength, `Password must be at most ${ACCOUNT.passwordMaxLength} characters.`)
  .refine((p) => new Set(p).size >= 4, 'Password is too repetitive.');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(ACCOUNT.passwordMaxLength),
});

/** Names may not start with these (staff impersonation). */
const RESERVED_PREFIXES = ['admin', 'moderator', 'gamemaster', 'official', 'terrago', 'system'];
/** Names may not be exactly these, or these followed by an underscore ("GM_Bob"). */
const RESERVED_WORDS = ['gm', 'mod', 'staff', 'support', 'server', 'npc', 'dev', 'owner', 'help'];

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

/**
 * Character names: 3–16 characters, start with a letter, letters/digits and
 * single underscores, no staff-impersonating prefixes, no profanity.
 */
export function checkCharacterName(raw: unknown): NameCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'Name is required.' };
  const name = raw.trim();
  if (name.length < 3 || name.length > 16) return { ok: false, reason: 'Name must be 3–16 characters.' };
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    return { ok: false, reason: 'Use letters, numbers and underscores, starting with a letter.' };
  }
  if (/__/.test(name) || name.endsWith('_')) return { ok: false, reason: 'Underscores must sit between letters or numbers.' };
  if ((name.match(/[0-9]/g) ?? []).length > 4) return { ok: false, reason: 'Too many numbers in the name.' };
  const lower = name.toLowerCase();
  if (
    RESERVED_PREFIXES.some((p) => lower.startsWith(p)) ||
    RESERVED_WORDS.some((w) => lower === w || lower.startsWith(`${w}_`))
  ) {
    return { ok: false, reason: 'That name is reserved.' };
  }
  if (isOffensiveName(name)) return { ok: false, reason: 'That name is not allowed.' };
  return { ok: true, name };
}

const idx = (len: number) => z.number().int().min(0).max(len - 1);

export const appearanceSchema = z.object({
  bodyType: z.enum(BODY_TYPES),
  skinTone: idx(SKIN_TONES.length),
  hairStyle: idx(HAIR_STYLES.length),
  hairColor: idx(HAIR_COLORS.length),
  eyeColor: idx(EYE_COLORS.length),
  outfit: idx(OUTFITS.length),
});

export const createCharacterSchema = z.object({
  name: z.string().superRefine((v, ctx) => {
    const r = checkCharacterName(v);
    if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.reason });
  }),
  classId: z.enum(CLASS_IDS),
  appearance: appearanceSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;

/** First human-readable message from a zod error. */
export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input.';
}
