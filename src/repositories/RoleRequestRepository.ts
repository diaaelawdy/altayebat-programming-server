import type { Types } from 'mongoose';
import { RoleRequest } from '../models/index.js';

type Id = Types.ObjectId | string;

export const RoleRequestRepository = {
  create: (data: { userId: Id; roleId: Id; reason: string }) => RoleRequest.create(data),
  findById: (id: Id) => RoleRequest.findById(id).lean(),
  findPendingFor: (userId: Id) => RoleRequest.findOne({ userId, status: 'pending' }).lean(),
  mine: (userId: Id, limit = 20) =>
    RoleRequest.find({ userId }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean(),
  pending: (w: { skip: number; take: number }) =>
    RoleRequest.find({ status: 'pending' })
      .sort({ createdAt: 1, _id: 1 })
      .skip(w.skip)
      .limit(w.take)
      .lean(),
  countPending: () => RoleRequest.countDocuments({ status: 'pending' }),
  /** Atomic: only a pending request can be handled, once. */
  handle: (id: Id, status: 'approved' | 'rejected', handledBy: Id, note = '') =>
    RoleRequest.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { $set: { status, handledBy, handledAt: new Date(), note } },
      { new: true },
    ).lean(),
  /** Back to pending, when applying the approval failed. */
  reopen: (id: Id) =>
    RoleRequest.updateOne(
      { _id: id },
      { $set: { status: 'pending', handledBy: null, handledAt: null, note: '' } },
    ),
};
