import type { Types } from 'mongoose';
import { NotificationRepository } from '../repositories/index.js';

type Id = Types.ObjectId;

export const NotificationService = {
  async notify(userId: Id | null | undefined, type: string, data: Record<string, unknown>) {
    if (!userId) return;
    await NotificationRepository.create(userId, type, data);
  },
  async list(userId: Id, limit: number, cursor?: string) {
    const page = await NotificationRepository.list(userId, limit, cursor);
    return {
      items: page.items.map((n) => ({
        id: String(n._id),
        type: n.type,
        data: n.data,
        read: Boolean(n.readAt),
        createdAt: n.createdAt,
      })),
      nextCursor: page.nextCursor,
    };
  },
  unreadCount: (userId: Id) => NotificationRepository.unreadCount(userId),
  markAllRead: (userId: Id) => NotificationRepository.markAllRead(userId),
};
