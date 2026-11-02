import type { Types } from 'mongoose';
import { Report } from '../models/index.js';

type Id = Types.ObjectId | string;

export const ReportRepository = {
  create: (data: {
    targetType: string;
    targetId: Id;
    reporterId: Id | null;
    reason: string;
    source?: 'user' | 'system';
  }) =>
    Report.updateOne(
      { targetType: data.targetType, targetId: data.targetId, reporterId: data.reporterId },
      { $setOnInsert: { reason: data.reason, status: 'open', source: data.source ?? 'user' } },
      { upsert: true },
    ),
  open: (w: { skip: number; take: number }, source?: 'user' | 'system') =>
    Report.find({ status: 'open', ...(source ? { source } : {}) })
      .sort({ createdAt: -1, _id: -1 })
      .skip(w.skip)
      .limit(w.take)
      .lean(),
  countOpen: (source?: 'user' | 'system') =>
    Report.countDocuments({ status: 'open', ...(source ? { source } : {}) }),
  findById: (id: Id) => Report.findById(id).lean(),
  resolveTarget: (
    targetType: string,
    targetId: Id,
    status: 'resolved' | 'dismissed',
    handledBy: Id,
  ) => Report.updateMany({ targetType, targetId, status: 'open' }, { $set: { status, handledBy } }),
};
