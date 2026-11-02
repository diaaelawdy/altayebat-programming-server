import { Schema } from 'mongoose';

/** Common fields for threaded, votable posts (answers and feedback comments). */
export const threadFields = {
  parentId: { type: Schema.Types.ObjectId, default: null },
  rootId: { type: Schema.Types.ObjectId, default: null }, // top-level ancestor; null for roots
  ancestors: [{ type: Schema.Types.ObjectId }],
  depth: { type: Number, default: 0 },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true },
  bodyHtml: { type: String, required: true },
  score: { type: Number, default: 0 },
  upvotes: { type: Number, default: 0 },
  downvotes: { type: Number, default: 0 },
  replyCount: { type: Number, default: 0 },
  deletedAt: { type: Date, default: null },
};
