import { Schema, model } from 'mongoose';

export const NOTIFICATION_TYPES = [
  'answer.reply',
  'question.answered',
  'comment.reply',
  'vote.up',
  'question.approved',
  'question.rejected',
  'company.approved',
  'company.rejected',
  'message.new',
  'message.reply',
  'badge.awarded',
  'role.approved',
  'role.rejected',
] as const;

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    // Only usernames and public slugs go in here — never identity data.
    data: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });

export const Notification = model('Notification', notificationSchema);
