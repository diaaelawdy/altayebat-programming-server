import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

/**
 * A conversation is either sent to the team (every holder of `messages.team_inbox`
 * sees it) or direct between two users.
 */
const conversationSchema = new Schema(
  {
    kind: { type: String, enum: ['team', 'direct'], required: true },
    subject: { type: String, required: true },
    starterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lastMessageAt: { type: Date, default: () => new Date() },
    lastAuthorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['open', 'answered'], default: 'open' },
    answeredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reads: [{ userId: Schema.Types.ObjectId, at: Date, _id: false }],
  },
  { timestamps: true },
);
conversationSchema.index({ starterId: 1, lastMessageAt: -1 });
conversationSchema.index({ recipientId: 1, lastMessageAt: -1 });
conversationSchema.index({ kind: 1, lastMessageAt: -1 });

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
    // Sent on behalf of the team: the other side sees the site name, not the author.
    asTeam: { type: Boolean, default: false },
  },
  { timestamps: true },
);
messageSchema.index({ conversationId: 1, createdAt: 1 });

export type ConversationDoc = InferSchemaType<typeof conversationSchema> & { _id: Types.ObjectId };
export type MessageDoc = InferSchemaType<typeof messageSchema> & { _id: Types.ObjectId };
export const Conversation = model('Conversation', conversationSchema);
export const Message = model('Message', messageSchema);
