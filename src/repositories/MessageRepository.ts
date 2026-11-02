import type { Types } from 'mongoose';
import { Conversation, Message } from '../models/index.js';

type Id = Types.ObjectId | string;
/** Skip/take window from `pageWindow()`. */
type Win = { skip: number; take: number };

export const MessageRepository = {
  createConversation: (data: {
    kind: 'team' | 'direct';
    subject: string;
    starterId: Id;
    recipientId: Id | null;
  }) =>
    Conversation.create({
      ...data,
      lastAuthorId: data.starterId,
      reads: [{ userId: data.starterId, at: new Date() }],
    }),
  findConversation: (id: Id) => Conversation.findById(id).lean(),
  /** Conversations a user started or received. */
  mine: (userId: Id, w: Win = { skip: 0, take: 500 }) =>
    Conversation.find({ $or: [{ starterId: userId }, { recipientId: userId }] })
      .sort({ lastMessageAt: -1, _id: -1 })
      .skip(w.skip)
      .limit(w.take)
      .lean(),
  team: (w: Win = { skip: 0, take: 500 }) =>
    Conversation.find({ kind: 'team' })
      .sort({ lastMessageAt: -1, _id: -1 })
      .skip(w.skip)
      .limit(w.take)
      .lean(),
  addMessage: (data: { conversationId: Id; authorId: Id; body: string; asTeam: boolean }) =>
    Message.create(data),
  messages: (conversationId: Id) =>
    Message.find({ conversationId }).sort({ createdAt: 1 }).limit(500).lean(),
  findMessage: (id: Id) => Message.findById(id).lean(),
  touch: (id: Id, set: Record<string, unknown>) =>
    Conversation.updateOne({ _id: id }, { $set: set }),
  markRead: async (id: Id, userId: Id) => {
    await Conversation.updateOne({ _id: id }, { $pull: { reads: { userId } } });
    await Conversation.updateOne({ _id: id }, { $push: { reads: { userId, at: new Date() } } });
  },
};
