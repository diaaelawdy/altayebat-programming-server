import { Schema, model } from 'mongoose';

const reportSchema = new Schema(
  {
    targetType: {
      type: String,
      enum: ['answer', 'comment', 'review', 'question', 'message', 'user'],
      required: true,
    },
    targetId: { type: Schema.Types.ObjectId, required: true },
    // null when the profanity screen raised it.
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    source: { type: String, enum: ['user', 'system'], default: 'user' },
    reason: { type: String, default: '' },
    status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1, reporterId: 1 }, { unique: true });

export const Report = model('Report', reportSchema);
