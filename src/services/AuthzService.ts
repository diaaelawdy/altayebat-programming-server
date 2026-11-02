import type { Types } from 'mongoose';
import { ALL_PERMISSIONS, isPermission, type Permission } from '../shared/permissions.js';
import { RoleRepository, UserRepository } from '../repositories/index.js';
import { AppError } from '../errors/AppError.js';

class SelfReview extends AppError {
  constructor() {
    super(403, 'self_review', 'Someone else has to review your own submission');
  }
}

interface AuthUser {
  _id: Types.ObjectId;
  roleIds?: Types.ObjectId[] | null;
  permissionsVersion?: number | null;
  status?: string | null;
}

/**
 * Effective permissions, cached per user and keyed by `permissionsVersion`.
 * Any role change bumps that version, so the next request recomputes — no re-login needed.
 */
const cache = new Map<string, { version: number; perms: Set<Permission>; isFounder: boolean }>();

export const AuthzService = {
  async resolve(user: AuthUser): Promise<{ perms: Set<Permission>; isFounder: boolean }> {
    if (user.status === 'banned' || user.status === 'disabled') return { perms: new Set(), isFounder: false };
    const key = String(user._id);
    const version = user.permissionsVersion ?? 0;
    const hit = cache.get(key);
    if (hit && hit.version === version) return hit;

    const roles = await RoleRepository.findByIds(user.roleIds ?? []);
    const isFounder = roles.some((r) => r.isFounder);
    const perms = new Set<Permission>(
      isFounder ? ALL_PERMISSIONS : roles.flatMap((r) => r.permissions.filter(isPermission)),
    );
    const entry = { version, perms, isFounder };
    cache.set(key, entry);
    if (cache.size > 10_000) cache.delete(cache.keys().next().value!);
    return entry;
  },
  clearCache: () => cache.clear(),

  /**
   * Four-eyes rule: nobody reviews their own submission, unless no other active
   * user can review it.
   */
  async assertNotSelfReview(perm: Permission, authorId: unknown, reviewerId: Types.ObjectId) {
    if (!authorId || String(authorId) !== String(reviewerId)) return;
    const roles = await RoleRepository.findGranting(perm);
    const others = await UserRepository.countActiveWithRoles(
      roles.map((r) => r._id),
      reviewerId,
    );
    if (others > 0) throw new SelfReview();
  },

  /** Whether `userId` may review an item they authored (no other reviewer exists). */
  async canSelfReview(perm: Permission, userId: Types.ObjectId) {
    const roles = await RoleRepository.findGranting(perm);
    return (
      (await UserRepository.countActiveWithRoles(
        roles.map((r) => r._id),
        userId,
      )) === 0
    );
  },
};
