import type { Types } from 'mongoose';

type Id = Types.ObjectId | string;
const id = (v: Id | null | undefined) => (v ? String(v) : null);

/**
 * Serializer factory: every DTO is built from an explicit whitelist, so a field
 * added to a model never leaks by accident.
 */
export function defineSerializer<In, Out>(map: (input: In) => Out) {
  const one = (input: In) => map(input);
  const many = (inputs: In[]) => inputs.map(map);
  return Object.assign(one, { many });
}

/** The one role shown next to a username: Founder, else a staff role, else Member. */
export interface DisplayRole {
  name: string;
  kind: 'founder' | 'staff' | 'member';
}

export interface PublicUserRef {
  id: string;
  username: string;
  reputation: number;
  role: DisplayRole | null;
  avatar: string | null;
}

/** The only shape in which other users ever appear. Username only, no identity data. */
export const publicUserRef = defineSerializer(
  (u: {
    _id: Id;
    username?: string | null;
    reputation?: number;
    role?: DisplayRole | null;
    avatar?: string | null;
  }): PublicUserRef => ({
    id: String(u._id),
    username: u.username ?? 'anonymous',
    reputation: u.reputation ?? 0,
    role: u.role ?? null,
    avatar: u.avatar ?? null,
  }),
);

const DELETED_USER: PublicUserRef = {
  id: '',
  username: 'deleted',
  reputation: 0,
  role: null,
  avatar: null,
};
export function authorOf(map: Map<string, PublicUserRef>, authorId: Id | null | undefined) {
  return (authorId && map.get(String(authorId))) || DELETED_USER;
}

/** Who reviewed an item and when; only for viewers with `moderation.view_reviewer`. */
export function reviewInfo(
  doc: { reviewedBy?: Id | null; reviewedAt?: Date | null },
  refs: Map<string, PublicUserRef>,
) {
  return {
    by: doc.reviewedBy ? authorOf(refs, doc.reviewedBy) : null,
    at: doc.reviewedAt ?? null,
  };
}

/** Month precision only, so timestamps can't be used to correlate identities. */
export const monthOf = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 7) : null;

export const publicProfile = defineSerializer(
  (u: {
    _id: Id;
    username?: string | null;
    reputation?: number;
    badges?: { key?: string | null; awardedAt?: Date | null }[];
    stats?: { questionsApproved?: number; answers?: number } | null;
    createdAt?: Date;
    role?: DisplayRole | null;
    avatar?: string | null;
  }) => ({
    id: String(u._id),
    username: u.username ?? 'anonymous',
    reputation: u.reputation ?? 0,
    role: u.role ?? null,
    avatar: u.avatar ?? null,
    badges: (u.badges ?? []).map((b) => ({ key: b.key ?? '', awardedAt: monthOf(b.awardedAt) })),
    stats: {
      questionsApproved: u.stats?.questionsApproved ?? 0,
      answers: u.stats?.answers ?? 0,
    },
    joinedAt: monthOf(u.createdAt),
  }),
);

export const companyDto = defineSerializer(
  (c: {
    _id: Id;
    name: string;
    nameAr?: string | null;
    slug: string;
    logoUrl?: string | null;
    website?: string | null;
    linkedinUrl?: string | null;
    industry?: string | null;
    description?: string | null;
    questionCount?: number;
    commentCount?: number;
    lastUpdatedAt?: Date | null;
    status?: string;
    rating?: {
      count?: number;
      overall?: number;
      experience?: number;
      difficulty?: number;
      communication?: number;
      distribution?: number[];
    } | null;
  }) => ({
    id: String(c._id),
    name: c.name,
    nameAr: c.nameAr ?? '',
    slug: c.slug,
    logoUrl: c.logoUrl ?? '',
    website: c.website ?? '',
    linkedinUrl: c.linkedinUrl ?? '',
    industry: c.industry ?? '',
    description: c.description ?? '',
    questionCount: c.questionCount ?? 0,
    commentCount: c.commentCount ?? 0,
    lastUpdatedAt: c.lastUpdatedAt ?? null,
    status: c.status ?? 'approved',
    rating: {
      count: c.rating?.count ?? 0,
      overall: c.rating?.overall ?? 0,
      experience: c.rating?.experience ?? 0,
      difficulty: c.rating?.difficulty ?? 0,
      communication: c.rating?.communication ?? 0,
      distribution: c.rating?.distribution ?? [0, 0, 0, 0, 0],
    },
  }),
);

/** A suggested company as its author and the review queue see it. */
export function companySubmissionDto(
  c: Parameters<typeof companyDto>[0] & { rejectionReason?: string | null; createdAt?: Date },
  createdBy: PublicUserRef | null,
) {
  return {
    ...companyDto(c),
    rejectionReason: c.rejectionReason ?? '',
    createdAt: c.createdAt ?? null,
    createdBy,
  };
}

export interface QuestionLike {
  _id: Id;
  companyId: Id;
  slug: string;
  title: string;
  field?: string;
  specializations?: string[];
  levels?: string[];
  stage: string;
  difficulty: string;
  topics?: string[];
  timesAsked?: number;
  lastAskedAt?: Date | null;
  publishedAt?: Date | null;
  answerCount?: number;
  status?: string;
  rejectionReason?: string | null;
  createdAt?: Date;
  problem?: string;
  problemHtml?: string;
  examples?: { input?: string | null; output?: string | null; explanation?: string | null }[];
  constraints?: string[];
  lookFor?: string;
  lookForHtml?: string;
  followUps?: string[];
  authorId?: Id | null;
}

export const questionSummary = defineSerializer((q: QuestionLike) => ({
  id: String(q._id),
  companyId: String(q.companyId),
  slug: q.slug,
  title: q.title,
  field: q.field ?? '',
  specializations: q.specializations ?? [],
  levels: q.levels ?? [],
  stage: q.stage,
  difficulty: q.difficulty,
  topics: q.topics ?? [],
  timesAsked: q.timesAsked ?? 0,
  lastAskedAt: q.lastAskedAt ?? null,
  publishedAt: q.publishedAt ?? null,
  answerCount: q.answerCount ?? 0,
}));

export function questionDetail(q: QuestionLike, author: PublicUserRef | null) {
  return {
    ...questionSummary(q),
    problem: q.problem ?? '',
    problemHtml: q.problemHtml ?? '',
    examples: (q.examples ?? []).map((e) => ({
      input: e.input ?? '',
      output: e.output ?? '',
      explanation: e.explanation ?? '',
    })),
    constraints: q.constraints ?? [],
    lookFor: q.lookFor ?? '',
    lookForHtml: q.lookForHtml ?? '',
    followUps: q.followUps ?? [],
    author,
  };
}

/** For the author's own submissions and the review queue. */
export function submissionDto(q: QuestionLike, author: PublicUserRef | null) {
  return {
    ...questionDetail(q, author),
    status: q.status ?? 'pending',
    rejectionReason: q.rejectionReason ?? '',
    createdAt: q.createdAt ?? null,
  };
}

export interface ThreadPostLike {
  _id: Id;
  parentId?: Id | null;
  rootId?: Id | null;
  depth?: number;
  authorId: Id;
  bodyHtml: string;
  body: string;
  score?: number;
  replyCount?: number;
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export function threadPostDto(
  p: ThreadPostLike,
  authors: Map<string, PublicUserRef>,
  myVotes: Map<string, number>,
) {
  const deleted = Boolean(p.deletedAt);
  return {
    id: String(p._id),
    parentId: id(p.parentId),
    rootId: id(p.rootId),
    depth: p.depth ?? 0,
    author: deleted ? null : authorOf(authors, p.authorId),
    body: deleted ? '' : p.body,
    bodyHtml: deleted ? '' : p.bodyHtml,
    score: p.score ?? 0,
    replyCount: p.replyCount ?? 0,
    myVote: myVotes.get(String(p._id)) ?? 0,
    deleted,
    createdAt: p.createdAt ?? null,
    edited: Boolean(p.updatedAt && p.createdAt && +p.updatedAt - +p.createdAt > 60_000),
  };
}

export function reviewDto(
  r: {
    _id: Id;
    authorId: Id;
    overall: number;
    experience: number;
    difficulty: number;
    communication: number;
    outcome?: string | null;
    specialization?: string | null;
    level?: string | null;
    title?: string | null;
    body?: string | null;
    score?: number;
    createdAt?: Date;
  },
  authors: Map<string, PublicUserRef>,
  myVotes: Map<string, number>,
) {
  return {
    id: String(r._id),
    author: authorOf(authors, r.authorId),
    overall: r.overall,
    experience: r.experience,
    difficulty: r.difficulty,
    communication: r.communication,
    outcome: r.outcome ?? '',
    specialization: r.specialization ?? '',
    level: r.level ?? '',
    title: r.title ?? '',
    body: r.body ?? '',
    score: r.score ?? 0,
    myVote: myVotes.get(String(r._id)) ?? 0,
    month: monthOf(r.createdAt),
  };
}

/** Admin shape for the users page (`users.view_private`). */
export function privateUserDto(
  u: {
    _id: Id;
    username?: string | null;
    roleIds?: Id[];
    status?: string;
    ban?: {
      reason?: string | null;
      link?: string | null;
      at?: Date | null;
      canMessage?: boolean | null;
    } | null;
    avatar?: string | null;
    reputation?: number;
    stats?: Record<string, number | undefined> | null;
    createdAt?: Date;
  },
  roleNames: Map<string, string>,
) {
  return {
    id: String(u._id),
    username: u.username ?? null,
    // One role per user.
    role: u.roleIds?.[0]
      ? { id: String(u.roleIds[0]), name: roleNames.get(String(u.roleIds[0])) ?? '?' }
      : null,
    status: u.status ?? 'active',
    ban: u.ban?.at
      ? {
          reason: u.ban.reason ?? '',
          link: u.ban.link ?? '',
          at: u.ban.at,
          canMessage: u.ban.canMessage !== false,
        }
      : null,
    avatar: u.avatar ?? null,
    reputation: u.reputation ?? 0,
    stats: {
      questionsSubmitted: u.stats?.questionsSubmitted ?? 0,
      questionsApproved: u.stats?.questionsApproved ?? 0,
      questionsRejected: u.stats?.questionsRejected ?? 0,
      answers: u.stats?.answers ?? 0,
      comments: u.stats?.comments ?? 0,
      reviews: u.stats?.reviews ?? 0,
      votesCast: u.stats?.votesCast ?? 0,
    },
    createdAt: u.createdAt ?? null,
  };
}
