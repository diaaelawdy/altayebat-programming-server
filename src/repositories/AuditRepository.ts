import type { Types } from 'mongoose';
import { AuditLog, type AuditLogDoc } from '../models/index.js';

type Id = Types.ObjectId | string;
export type AuditEntry = Pick<AuditLogDoc, 'action' | 'targetType'> &
  Partial<
    Pick<AuditLogDoc, 'targetId' | 'label' | 'link' | 'detail' | 'before' | 'after' | 'refId'>
  >;

export const AuditRepository = {
  create: (actorId: Id, e: AuditEntry & { undo?: 'done' | null }) =>
    AuditLog.create({ actorId, ...e }),
  /** A new undoable action empties the actor's redo stack. */
  clearRedo: (actorId: Id) =>
    AuditLog.updateMany({ actorId, undo: 'undone' }, { $set: { undo: 'dropped' } }),
  list: (filter: { actorId?: Id }, w: { skip: number; take: number }) =>
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(w.skip).limit(w.take).lean(),
  undoStack: (actorId: Id, limit: number) =>
    AuditLog.find({ actorId, undo: 'done' }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean(),
  redoStack: (actorId: Id, limit: number) =>
    AuditLog.find({ actorId, undo: 'undone' }).sort({ undoneAt: -1, _id: -1 }).limit(limit).lean(),
  count: (actorId: Id, undo: 'done' | 'undone') => AuditLog.countDocuments({ actorId, undo }),
  setUndo: (id: Id, undo: 'done' | 'undone' | 'dropped') =>
    AuditLog.updateOne(
      { _id: id },
      { $set: { undo, undoneAt: undo === 'undone' ? new Date() : null } },
    ),
};
