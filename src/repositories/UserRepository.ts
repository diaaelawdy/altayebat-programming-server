import { Types } from 'mongoose';
import { User } from '../models/index.js';
import { escapeRegex } from '../lib/text.js';
import { publicUserRef, type DisplayRole, type PublicUserRef } from '../serializers/index.js';
import { RoleRepository } from './RoleRepository.js';

type Id = Types.ObjectId | string;
export type UserStat =
  | 'questionsSubmitted'
  | 'questionsApproved'
  | 'questionsRejected'
  | 'answers'
  | 'comments'
  | 'reviews'
  | 'votesCast'
  | 'studied';

const AUTH_FIELDS = 'username roleIds status permissionsVersion ban';

/**
 * Picks the one role shown next to a username: Founder first, then a staff role
 * (any custom role, alphabetically), then the default Member role.
 */
export async function displayRoleResolver() {
  const roles = await RoleRepository.findAll();
  const byId = new Map(roles.map((r) => [String(r._id), r]));
  return (roleIds: Id[]): DisplayRole | null => {
    const mine = roleIds.map((id) => byId.get(String(id))).filter((r) => r !== undefined);
    const founder = mine.find((r) => r.isFounder);
    if (founder) return { name: founder.name, kind: 'founder' };
    const staff = mine.filter((r) => !r.isDefault).sort((a, b) => a.name.localeCompare(b.name))[0];
    if (staff) return { name: staff.name, kind: 'staff' };
    const member = mine.find((r) => r.isDefault);
    return member ? { name: member.name, kind: 'member' } : null;
  };
}

export const UserRepository = {
  findById: (id: Id) => User.findById(id).lean(),
  findAuthById: (id: Id) => User.findById(id).select(AUTH_FIELDS).lean(),
  findByUsernameWithPassword: (username: string) =>
    User.findOne({ username: username.toLowerCase() })
      .select(`${AUTH_FIELDS} +passwordHash`)
      .lean(),
  findByUsername: (username: string) => User.findOne({ username: username.toLowerCase() }).lean(),

  usernameTaken: async (username: string) => Boolean(await User.exists({ username })),

  create: (data: {
    username: string;
    passwordHash: string;
    roleIds: Id[];
    avatar: string;
    ipHashes: string[];
  }) => User.create({ ...data, roleIds: data.roleIds.map((r) => new Types.ObjectId(String(r))) }),

  setPreferences: (id: Id, preferences: Record<string, unknown>) =>
    User.findByIdAndUpdate(id, { $set: { preferences } }, { new: true }).lean(),

  /** Batch-loads public author refs with their display role (avoids N+1). */
  async publicRefs(ids: Id[]): Promise<Map<string, PublicUserRef>> {
    const unique = [...new Set(ids.filter(Boolean).map(String))];
    if (!unique.length) return new Map();
    const [users, roleOf] = await Promise.all([
      User.find({ _id: { $in: unique } })
        .select('username reputation roleIds avatar')
        .lean(),
      displayRoleResolver(),
    ]);
    return new Map(
      users.map((u) => [String(u._id), publicUserRef({ ...u, role: roleOf(u.roleIds ?? []) })]),
    );
  },

  /** Remembers the last 20 IP hashes of a user (for IP bans). */
  recordIp: (id: Id, hash: string) =>
    User.updateOne(
      { _id: id, ipHashes: { $ne: hash } },
      { $push: { ipHashes: { $each: [hash], $slice: -20 } } },
    ),
  ipHashesOf: async (id: Id) =>
    (await User.findById(id).select('+ipHashes').lean())?.ipHashes ?? [],
  setBan: (
    id: Id,
    status: 'active' | 'disabled' | 'banned',
    ban: { reason: string; link: string; by: Id | null; at: Date | null; canMessage: boolean },
  ) =>
    User.updateOne(
      { _id: id },
      {
        $set: { status, ban },
        $inc: { permissionsVersion: 1 },
      },
    ),
  setAvatar: (id: Id, avatar: string) => User.updateOne({ _id: id }, { $set: { avatar } }),

  incStat: (id: Id, stat: UserStat, by = 1) =>
    User.updateOne({ _id: id }, { $inc: { [`stats.${stat}`]: by } }),
  incReputation: (id: Id, by: number) => User.updateOne({ _id: id }, { $inc: { reputation: by } }),

  addBadge: (id: Id, key: string) =>
    User.updateOne(
      { _id: id, 'badges.key': { $ne: key } },
      { $push: { badges: { key, awardedAt: new Date() } } },
    ),

  setStreak: (id: Id, streak: { current: number; longest: number; lastDay: string }) =>
    User.updateOne({ _id: id }, { $set: { streak } }),

  setRoles: (id: Id, roleIds: Id[]) =>
    User.updateOne({ _id: id }, { $set: { roleIds }, $inc: { permissionsVersion: 1 } }),
  bumpPermissionsForRole: (roleId: Id) =>
    User.updateMany({ roleIds: roleId }, { $inc: { permissionsVersion: 1 } }),
  removeRoleEverywhere: (roleId: Id) =>
    User.updateMany(
      { roleIds: roleId },
      { $pull: { roleIds: roleId }, $inc: { permissionsVersion: 1 } },
    ),
  /** Active users other than `excludeId` holding any of these roles. */
  countActiveWithRoles: (roleIds: Id[], excludeId: Id) =>
    User.countDocuments({ roleIds: { $in: roleIds }, status: 'active', _id: { $ne: excludeId } }),
  countWithRole: (roleId: Id, extra: Record<string, unknown> = {}) =>
    User.countDocuments({ roleIds: roleId, ...extra }),
  count: () => User.estimatedDocumentCount(),

  /** Admin listing for the users page. */
  async listPrivate(opts: { q?: string; roleId?: string; skip: number; take: number }) {
    const filter: Record<string, unknown> = {};
    if (opts.roleId) filter.roleIds = new Types.ObjectId(opts.roleId);
    if (opts.q) {
      const rx = new RegExp(escapeRegex(opts.q.toLowerCase()), 'i');
      filter.username = rx;
    }
    const [items, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1, _id: -1 }).skip(opts.skip).limit(opts.take).lean(),
      User.countDocuments(filter),
    ]);
    return { items, total };
  },
};
