import type { Types } from 'mongoose';
import { AuditRepository, UserRepository } from '../repositories/index.js';
import type { AuditLogDoc } from '../models/index.js';
import { authorOf } from '../serializers/index.js';
import { AppError, BadRequest, Forbidden } from '../errors/AppError.js';
import { offsetPage, pageWindow, type PageQuery } from '../lib/cursor.js';
import { AnswerService, CompanyCommentService } from './ThreadService.js';
import { audit, excerpt } from './audit.js';
import type { Permission } from '../shared/permissions.js';

type Id = Types.ObjectId;
const STACK = 20;

const services = { answer: AnswerService, comment: CompanyCommentService } as const;

function entryDto(e: AuditLogDoc, refs: Awaited<ReturnType<typeof UserRepository.publicRefs>>) {
  return {
    id: String(e._id),
    action: e.action,
    targetType: e.targetType,
    label: e.label,
    link: e.link,
    detail: e.detail,
    before: e.before == null ? null : excerpt(e.before, 300),
    after: e.after == null ? null : excerpt(e.after, 300),
    undo: e.undo ?? null,
    actor: authorOf(refs, e.actorId),
    createdAt: e.createdAt,
  };
}

async function dtos(rows: AuditLogDoc[]) {
  const refs = await UserRepository.publicRefs(rows.map((r) => r.actorId));
  return rows.map((r) => entryDto(r, refs));
}

/** What undoing (or redoing) an entry does to its post. */
function step(e: AuditLogDoc, dir: 'undo' | 'redo') {
  if (e.action === 'create') return dir === 'undo' ? 'delete' : 'restore';
  if (e.action === 'delete') return dir === 'undo' ? 'restore' : 'delete';
  return dir === 'undo'
    ? { body: e.before ?? '', expect: e.after ?? '' }
    : { body: e.after ?? '', expect: e.before ?? '' };
}

export const HistoryService = {
  async list(viewer: { _id: Id; perms: Set<Permission> }, scope: 'mine' | 'all', page: PageQuery) {
    if (scope === 'all' && !viewer.perms.has('logs.view')) throw new Forbidden();
    const w = pageWindow(page);
    const rows = await AuditRepository.list(scope === 'all' ? {} : { actorId: viewer._id }, w);
    const { items, nextCursor } = offsetPage(rows as AuditLogDoc[], page.limit, w.skip);
    return { items: await dtos(items), nextCursor };
  },

  /** The actor's two stacks, top first: what Undo and Redo would do next. */
  async stacks(actorId: Id) {
    const [undo, redo, undoTotal, redoTotal] = await Promise.all([
      AuditRepository.undoStack(actorId, STACK),
      AuditRepository.redoStack(actorId, STACK),
      AuditRepository.count(actorId, 'done'),
      AuditRepository.count(actorId, 'undone'),
    ]);
    return {
      undo: { items: await dtos(undo as AuditLogDoc[]), total: undoTotal },
      redo: { items: await dtos(redo as AuditLogDoc[]), total: redoTotal },
    };
  },

  /** Pops the top of one stack, applies it, and pushes it onto the other. */
  async move(actorId: Id, dir: 'undo' | 'redo') {
    const [top] = (
      dir === 'undo'
        ? await AuditRepository.undoStack(actorId, 1)
        : await AuditRepository.redoStack(actorId, 1)
    ) as AuditLogDoc[];
    if (!top) throw new BadRequest(dir === 'undo' ? 'Nothing to undo' : 'Nothing to redo');
    const svc = services[top.targetType as keyof typeof services];
    const ok = svc && top.targetId ? await svc.revert(top.targetId, step(top, dir)) : false;
    if (!ok) {
      // It changed since (e.g. a moderator deleted it): it leaves both stacks.
      await AuditRepository.setUndo(top._id, 'dropped');
      throw new AppError(409, 'history_stale', 'This item changed since, so that step was skipped');
    }
    await AuditRepository.setUndo(top._id, dir === 'undo' ? 'undone' : 'done');
    await audit.record(actorId, {
      action: dir,
      targetType: top.targetType,
      targetId: top.targetId,
      label: top.label,
      link: top.link,
      detail: top.action,
      refId: top._id,
    });
    return HistoryService.stacks(actorId);
  },
};
