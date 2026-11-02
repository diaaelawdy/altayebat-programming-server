/** Request schemas. Keep in sync with client/src/shared/schemas.ts. */
import { z } from 'zod';
import {
  DIFFICULTIES,
  FIELDS,
  HEX_RE,
  LEVELS,
  REVIEW_OUTCOMES,
  SPECIALIZATIONS,
  STAGES,
  TOPICS,
  USERNAME_RE,
  isAvatar,
  specializationsFit,
} from './constants.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const text = (max: number) => z.string().trim().max(max);
const limit = (max: number, def: number) => z.coerce.number().int().min(1).max(max).default(def);
/** Set after the author confirms a mild-profanity warning. */
const ack = { acknowledgeProfanity: z.boolean().optional() };
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .enum(values)
    .optional()
    .or(z.literal('').transform(() => undefined));

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USERNAME_RE, '3–20 letters, numbers, _ or -, not starting with a number');
export const passwordSchema = z.string().min(6, 'At least 6 characters').max(128);

export const avatarSchema = z.string().refine(isAvatar, 'Unknown avatar');
export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  avatar: avatarSchema.optional(),
});
export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(40),
  password: z.string().min(1).max(128),
});

const palette = z.object({
  bg: z.string().regex(HEX_RE).optional(),
  surface: z.string().regex(HEX_RE).optional(),
  fg: z.string().regex(HEX_RE).optional(),
});
export const preferencesSchema = z.object({
  locale: z.enum(['en', 'ar']).default('en'),
  mode: z.enum(['dark', 'light', 'system']).default('dark'),
  accent: z.string().regex(HEX_RE).nullable().default(null),
  dark: palette.default({}),
  light: palette.default({}),
});

const linkedinUrl = z
  .string()
  .trim()
  .url()
  .max(300)
  .refine(
    (u) => /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(u),
    'Must be a linkedin.com link',
  );

/** Full company fields, for reviewers and admins (they also set the logo). */
export const companyInputSchema = z.object({
  name: text(80).min(2),
  nameAr: text(80).optional(),
  logoUrl: z.string().url().max(500).optional().or(z.literal('')),
  website: z.string().url().max(300).optional().or(z.literal('')),
  linkedinUrl: linkedinUrl.optional().or(z.literal('')),
  industry: text(60).optional(),
  description: text(1000).optional(),
});

/** What members send when proposing a company: LinkedIn is required, no logo (a reviewer adds it). */
export const companySubmitSchema = companyInputSchema
  .omit({ logoUrl: true })
  .extend({ linkedinUrl });

/** Drops repeated picks, e.g. `['Junior', 'Junior']`. */
const distinct = <T>(values: T[]) => [...new Set(values)];

// A plain object (no cross-field refinement), so edits can use `.partial()`.
// The field ↔ specializations check runs on submit below and in QuestionService.
export const questionInputSchema = z.object({
  title: text(120).min(4),
  field: z.enum(FIELDS),
  specializations: z.array(z.enum(SPECIALIZATIONS)).max(3).transform(distinct).default([]),
  levels: z.array(z.enum(LEVELS)).min(1).max(3).transform(distinct),
  stage: z.enum(STAGES),
  difficulty: z.enum(DIFFICULTIES),
  topics: z.array(z.enum(TOPICS)).min(1).max(3).transform(distinct),
  problem: text(10_000).min(20),
  examples: z
    .array(
      z.object({
        input: text(2000).min(1),
        output: text(2000).min(1),
        explanation: text(1000).optional(),
      }),
    )
    .max(5)
    .default([]),
  constraints: z.array(text(300).min(1)).max(15).default([]),
  lookFor: text(5000).optional(),
  followUps: z.array(text(500).min(1)).max(10).default([]),
  askedMonth: month.optional(),
});

const fitSpecializations = (
  q: { field: (typeof FIELDS)[number]; specializations: (typeof SPECIALIZATIONS)[number][] },
  ctx: z.RefinementCtx,
) => {
  if (!specializationsFit(q.field, q.specializations))
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['specializations'],
      message: `Pick specializations that belong to ${q.field}`,
    });
};

export const submitQuestionSchema = questionInputSchema
  .extend({
    companyId: objectId.optional(),
    newCompany: companySubmitSchema.optional(),
    ...ack,
  })
  .superRefine(fitSpecializations);

/** Upload limit for sending several questions at once (one JSON file). */
export const BULK_MAX_QUESTIONS = 50;
export const bulkQuestionsSchema = z.object({
  companyId: objectId.optional(),
  newCompany: companySubmitSchema.optional(),
  questions: z
    .array(questionInputSchema.superRefine(fitSpecializations))
    .min(1)
    .max(BULK_MAX_QUESTIONS, `At most ${BULK_MAX_QUESTIONS} questions per upload`),
  ...ack,
});

export const rejectSchema = z.object({ reason: text(500).min(3) });
export const companyApproveSchema = z.object({ edits: companyInputSchema.partial().optional() });
export const approveSchema = z.object({ edits: questionInputSchema.partial().optional() });

export const askedSchema = z.object({
  month,
  specialization: optionalEnum(SPECIALIZATIONS),
  level: optionalEnum(LEVELS),
  stage: optionalEnum(STAGES),
  note: text(300).optional(),
});

export const postSchema = z.object({
  body: text(20_000).min(1),
  parentId: objectId.nullable().optional(),
  ...ack,
});
export const editPostSchema = z.object({ body: text(20_000).min(1), ...ack });

export const startMessageSchema = z.object({
  subject: text(150).min(2),
  body: text(10_000).min(1),
  to: z.string().trim().toLowerCase().max(20).optional(),
  asTeam: z.boolean().optional(),
  ...ack,
});
export const replyMessageSchema = z.object({
  body: text(10_000).min(1),
  asTeam: z.boolean().optional(),
  ...ack,
});
export const messagesQuery = z.object({
  box: z.enum(['mine', 'team']).default('mine'),
  cursor: z.string().max(500).optional(),
  limit: limit(50, 20),
});

export const voteSchema = z.object({
  targetType: z.enum(['answer', 'comment', 'review']),
  targetId: objectId,
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});

const star = z.number().int().min(1).max(5);
export const reviewSchema = z.object({
  overall: star,
  experience: star,
  difficulty: star,
  communication: star,
  outcome: optionalEnum(REVIEW_OUTCOMES),
  specialization: optionalEnum(SPECIALIZATIONS),
  level: optionalEnum(LEVELS),
  title: text(120).optional(),
  body: text(4000).optional(),
  ...ack,
});

export const REPORT_TARGETS = [
  'answer',
  'comment',
  'review',
  'question',
  'message',
  'user',
] as const;
export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: objectId,
  // Optional: people can report without explaining.
  reason: text(500).optional().default(''),
});
export const handleReportSchema = z.object({ status: z.enum(['resolved', 'dismissed']) });

export const roleSchema = z.object({
  name: text(40).min(2),
  description: text(200).optional(),
  // Omitted on create: the new role starts with Member's permissions.
  permissions: z.array(z.string()).optional(),
});
/** A member asking for a role says why. */
export const roleRequestSchema = z.object({ roleId: objectId, reason: text(1000).min(10) });
export const rejectRoleRequestSchema = z.object({ note: text(500).optional().default('') });
/** Every user has exactly one role. */
export const assignRoleSchema = z.object({ roleId: objectId });
// A restriction always says why; a link to the offending post/message is optional.
const restrictionFields = {
  reason: text(500).min(3),
  link: z.string().max(500).optional().default(''),
  canMessage: z.boolean().optional().default(true),
};
export const userStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('active') }),
  z.object({ status: z.literal('disabled'), ...restrictionFields }),
  z.object({ status: z.literal('banned'), ...restrictionFields }),
]);
export const listNameSchema = z.object({ name: text(60).min(1) });

export const questionListQuery = z.object({
  field: optionalEnum(FIELDS),
  specialization: optionalEnum(SPECIALIZATIONS),
  level: optionalEnum(LEVELS),
  stage: optionalEnum(STAGES),
  topic: optionalEnum(TOPICS),
  difficulty: optionalEnum(DIFFICULTIES),
  q: text(100).optional(),
  sort: z.enum(['lastAsked', 'frequent', 'newest']).default('lastAsked'),
  cursor: z.string().max(500).optional(),
  limit: limit(50, 20),
});
export const companyListQuery = z.object({
  q: text(80).optional(),
  sort: z.enum(['popular', 'name', 'rating', 'recent']).default('popular'),
  cursor: z.string().max(500).optional(),
  limit: limit(100, 20),
});
export const threadQuery = z.object({
  sort: z.enum(['top', 'newest']).default('top'),
  cursor: z.string().max(500).optional(),
  limit: limit(50, 20),
});
export const reviewQuery = z.object({
  sort: z.enum(['helpful', 'newest']).default('helpful'),
  cursor: z.string().max(500).optional(),
  limit: limit(50, 20),
});
export const cursorQuery = z.object({
  cursor: z.string().max(500).optional(),
  limit: limit(50, 20),
});
export const usersQuery = z.object({
  q: text(80).optional(),
  roleId: objectId.optional(),
  cursor: z.string().max(500).optional(),
  limit: limit(100, 20),
});

export const pageQuery = z.object({
  cursor: z.string().max(500).optional(),
  limit: limit(50, 20),
});
export const historyQuery = z.object({
  cursor: z.string().max(500).optional(),
  limit: limit(50, 20),
  scope: z.enum(['mine', 'all']).optional().default('mine'),
});
export const reportsQuery = z.object({
  cursor: z.string().max(500).optional(),
  limit: limit(50, 20),
  source: z.enum(['user', 'system']).optional(),
});
