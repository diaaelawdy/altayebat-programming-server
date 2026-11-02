import type { Types } from 'mongoose';
import {
  AnswerRepository,
  CompanyCommentRepository,
  CompanyRepository,
  QuestionRepository,
  UserRepository,
  VoteRepository,
  type ThreadDoc,
  type ThreadSort,
} from '../repositories/index.js';
import { threadPostDto } from '../serializers/index.js';
import { BadRequest, Forbidden, NotFound } from '../errors/AppError.js';
import { events } from '../events/bus.js';
import { renderMarkdown } from '../lib/markdown.js';
import { audit, excerpt } from './audit.js';

type Id = Types.ObjectId;
type Repo = typeof AnswerRepository;

interface ThreadConfig {
  repo: Repo;
  scopeField: 'questionId' | 'companyId';
  voteTarget: 'answer' | 'comment';
  deletePermission: 'answers.delete_any' | 'comments.delete_any';
  assertScope: (scopeId: string) => Promise<Id>;
  onCreated: (doc: ThreadDoc & Record<string, unknown>) => Promise<void>;
  onDeleted: (doc: ThreadDoc & Record<string, unknown>) => Promise<void>;
  onRestored: (doc: ThreadDoc & Record<string, unknown>) => Promise<void>;
  /** Where the post lives, for the activity log. */
  linkOf: (doc: ThreadDoc & Record<string, unknown>) => Promise<string>;
}

/** Factory for threaded discussions: question answers and company feedback share it. */
function createThreadService(cfg: ThreadConfig) {
  return {
    async list(
      scopeId: string,
      sort: ThreadSort,
      limit: number,
      cursor: string | undefined,
      viewerId?: Id | null,
    ) {
      const scope = await cfg.assertScope(scopeId);
      const page = await cfg.repo.listRoots(scope, sort, limit, cursor);
      const replies = page.items.length
        ? await cfg.repo.descendantsOf(page.items.map((r) => r._id))
        : [];
      const all = [...page.items, ...replies];
      const [authors, myVotes] = await Promise.all([
        UserRepository.publicRefs(all.map((p) => p.authorId)),
        VoteRepository.mine(
          cfg.voteTarget,
          all.map((p) => p._id),
          viewerId,
        ),
      ]);
      // A deleted post stays (as a placeholder) only while a live reply sits under it.
      const needed = new Set<string>();
      for (const r of replies)
        if (!r.deletedAt) for (const a of r.ancestors ?? []) needed.add(String(a));
      const byRoot = new Map<string, ReturnType<typeof threadPostDto>[]>();
      for (const r of replies) {
        if (r.deletedAt && !needed.has(String(r._id))) continue;
        const key = String(r.rootId);
        const arr = byRoot.get(key) ?? [];
        arr.push(threadPostDto(r, authors, myVotes));
        byRoot.set(key, arr);
      }
      return {
        items: page.items
          .filter((r) => !r.deletedAt || needed.has(String(r._id)))
          .map((r) => ({
            ...threadPostDto(r, authors, myVotes),
            replies: byRoot.get(String(r._id)) ?? [],
          })),
        nextCursor: page.nextCursor,
      };
    },

    async create(scopeId: string, authorId: Id, body: string, parentId?: string | null) {
      const scope = await cfg.assertScope(scopeId);
      let tree = {
        parentId: null as Id | null,
        rootId: null as Id | null,
        ancestors: [] as Id[],
        depth: 0,
      };
      if (parentId) {
        const parent = await cfg.repo.findById(parentId);
        if (!parent || String(parent[cfg.scopeField]) !== String(scope))
          throw new BadRequest('Invalid parent');
        if (parent.deletedAt) throw new BadRequest('Cannot reply to a deleted post');
        tree = {
          parentId: parent._id,
          rootId: parent.rootId ?? parent._id,
          ancestors: [...parent.ancestors, parent._id],
          depth: parent.depth + 1,
        };
      }
      const doc = await cfg.repo.create({
        [cfg.scopeField]: scope,
        ...tree,
        authorId,
        body,
        bodyHtml: renderMarkdown(body),
      });
      const lean = doc.toObject() as ThreadDoc & Record<string, unknown>;
      await cfg.onCreated(lean);
      await logPost(lean, authorId, 'create', { after: body });
      const authors = await UserRepository.publicRefs([authorId]);
      return { ...threadPostDto(lean, authors, new Map()), replies: [] };
    },

    async edit(id: string, userId: Id, body: string) {
      const post = await cfg.repo.findById(id);
      if (!post || post.deletedAt) throw new NotFound();
      if (String(post.authorId) !== String(userId))
        throw new Forbidden('You can only edit your own posts');
      const updated = await cfg.repo.update(id, { body, bodyHtml: renderMarkdown(body) });
      if (post.body !== body) await logPost(post, userId, 'edit', { before: post.body, after: body });
      const authors = await UserRepository.publicRefs([userId]);
      return threadPostDto(
        updated!,
        authors,
        await VoteRepository.mine(cfg.voteTarget, [id], userId),
      );
    },

    async remove(id: string, user: { _id: Id; perms: Set<string> }) {
      const post = await cfg.repo.findById(id);
      if (!post || post.deletedAt) throw new NotFound();
      const own = String(post.authorId) === String(user._id);
      if (!own && !user.perms.has(cfg.deletePermission)) throw new Forbidden();
      await cfg.repo.update(id, { deletedAt: new Date() });
      await cfg.onDeleted(post);
      await logPost(post, user._id, 'delete', {
        before: post.body,
        detail: own ? '' : 'moderation',
      });
    },

    /**
     * Undo/redo of a logged change. `expect` is the state the post must still be in;
     * otherwise someone changed it since, and the step is refused.
     */
    async revert(
      id: Id | string,
      op: 'delete' | 'restore' | { body: string; expect: string },
    ): Promise<boolean> {
      const post = await cfg.repo.findById(id);
      if (!post) return false;
      if (op === 'delete') {
        if (post.deletedAt) return false;
        await cfg.repo.update(id, { deletedAt: new Date() });
        await cfg.onDeleted(post);
      } else if (op === 'restore') {
        if (!post.deletedAt) return false;
        await cfg.repo.update(id, { deletedAt: null });
        await cfg.onRestored(post);
      } else {
        if (post.deletedAt || post.body !== op.expect) return false;
        await cfg.repo.update(id, { body: op.body, bodyHtml: renderMarkdown(op.body) });
      }
      return true;
    },
  };

  async function logPost(
    post: ThreadDoc & Record<string, unknown>,
    actorId: Id,
    action: 'create' | 'edit' | 'delete',
    extra: { before?: string; after?: string; detail?: string },
  ) {
    await audit.record(
      actorId,
      {
        action,
        targetType: cfg.voteTarget,
        targetId: post._id,
        label: excerpt(extra.after ?? extra.before ?? post.body),
        link: await cfg.linkOf(post).catch(() => ''),
        ...extra,
      },
      { undoable: true },
    );
  }
}

export const AnswerService = createThreadService({
  repo: AnswerRepository,
  scopeField: 'questionId',
  voteTarget: 'answer',
  deletePermission: 'answers.delete_any',
  async assertScope(questionId) {
    const q = await QuestionRepository.findById(questionId).catch(() => null);
    if (!q || q.status !== 'approved') throw new NotFound('Question not found');
    return q._id;
  },
  onCreated: (a) =>
    events.emit('answer.created', {
      answerId: a._id,
      questionId: a.questionId as Id,
      parentId: a.parentId,
      authorId: a.authorId,
    }),
  onDeleted: (a) =>
    events.emit('answer.deleted', {
      answerId: a._id,
      questionId: a.questionId as Id,
      parentId: a.parentId,
      authorId: a.authorId,
    }),
  onRestored: (a) =>
    events.emit('answer.restored', {
      answerId: a._id,
      questionId: a.questionId as Id,
      parentId: a.parentId,
      authorId: a.authorId,
    }),
  async linkOf(a) {
    const q = await QuestionRepository.findById(String(a.questionId));
    const c = q && (await CompanyRepository.findById(q.companyId));
    return q && c ? `/c/${c.slug}/${q.slug}` : '';
  },
});

export const CompanyCommentService = createThreadService({
  repo: CompanyCommentRepository,
  scopeField: 'companyId',
  voteTarget: 'comment',
  deletePermission: 'comments.delete_any',
  async assertScope(slug) {
    const c = await CompanyRepository.findBySlug(slug);
    if (!c) throw new NotFound('Company not found');
    return c._id;
  },
  onCreated: (c) =>
    events.emit('comment.created', {
      commentId: c._id,
      companyId: c.companyId as Id,
      parentId: c.parentId,
      authorId: c.authorId,
    }),
  onDeleted: (c) =>
    events.emit('comment.deleted', {
      commentId: c._id,
      companyId: c.companyId as Id,
      parentId: c.parentId,
    }),
  onRestored: (c) =>
    events.emit('comment.restored', {
      commentId: c._id,
      companyId: c.companyId as Id,
      parentId: c.parentId,
    }),
  async linkOf(c) {
    const company = await CompanyRepository.findById(c.companyId as Id);
    return company ? `/c/${company.slug}?tab=feedback` : '';
  },
});
