import type { Types } from 'mongoose';
import { Role } from '../models/index.js';

type Id = Types.ObjectId | string;

export const RoleRepository = {
  findAll: () => Role.find().sort({ isSystem: -1, name: 1 }).lean(),
  findById: (id: Id) => Role.findById(id).lean(),
  findByIds: (ids: Id[]) => Role.find({ _id: { $in: ids } }).lean(),
  /** Roles that grant a permission (Founder grants all). */
  findGranting: (perm: string) =>
    Role.find({ $or: [{ isFounder: true }, { permissions: perm }] }).lean(),
  findFounder: () => Role.findOne({ isFounder: true }).lean(),
  findDefault: () => Role.findOne({ isDefault: true }).lean(),
  findByName: (name: string) =>
    Role.findOne({
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    }).lean(),
  create: (data: { name: string; description?: string; permissions: string[] }) =>
    Role.create(data),
  update: (id: Id, data: { name?: string; description?: string; permissions?: string[] }) =>
    Role.findByIdAndUpdate(id, { $set: data }, { new: true }).lean(),
  delete: (id: Id) => Role.deleteOne({ _id: id }),
  upsertSystem: (filter: Record<string, unknown>, data: Record<string, unknown>) =>
    Role.findOneAndUpdate(filter, { $set: data }, { upsert: true, new: true }).lean(),
};
