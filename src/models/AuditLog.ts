import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

/**
 * One entry per action: who did what to which item, and when. Undoable entries
 * (a user's own answer/comment create, edit or delete) carry `undo`:
 * 'done' sits on the actor's undo stack, 'undone' on their redo stack, and
 * 'dropped' left both (a new action cleared the redo stack, or the item changed).
 */
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: Schema.Types.ObjectId, default: null },
    // Snapshot taken at the time, so deleted items still read well.
    label: { type: String, default: '' },
    link: { type: String, default: '' },
    detail: { type: String, default: '' },
    // Post bodies around the change, for undo/redo.
    before: { type: String, default: null },
    after: { type: String, default: null },
    undo: { type: String, enum: ['done', 'undone', 'dropped', null], default: null },
    undoneAt: { type: Date, default: null },
    // On undo/redo entries: the entry they acted on.
    refId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, undo: 1, createdAt: -1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export const AuditLog = model('AuditLog', auditLogSchema);
