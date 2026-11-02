import type { Types } from 'mongoose';
import { Notification } from '../models/index.js';
import { afterCursor, decodeCursor, pageOf } from '../lib/cursor.js';

type Id = Types.ObjectId | string;

export const NotificationRepository = {
  create: (userId: Id, type: string, data: Record<string, unknown>) =>
    Notification.create({ userId, type, data }),
  async list(userId: Id, limit: number, cursor?: string) {
    const rows = await Notification.find({ userId, ...afterCursor('_id', decodeCursor(cursor)) })
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    return pageOf(rows, limit, '_id');
  },
  unreadCount: (userId: Id) => Notification.countDocuments({ userId, readAt: null }),
  markAllRead: (userId: Id) =>
    Notification.updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } }),
};
