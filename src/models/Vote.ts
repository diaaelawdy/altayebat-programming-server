import { Schema, model } from 'mongoose';

export const VOTE_TARGETS = ['answer', 'comment', 'review'] as const;
export type VoteTarget = (typeof VOTE_TARGETS)[number];

const voteSchema = new Schema(
  {
    targetType: { type: String, enum: VOTE_TARGETS, required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    value: { type: Number, enum: [1, -1], required: true },
  },
  { timestamps: true },
);

voteSchema.index({ targetType: 1, targetId: 1, userId: 1 }, { unique: true });
voteSchema.index({ userId: 1, targetType: 1, targetId: 1 });

export const Vote = model('Vote', voteSchema);
