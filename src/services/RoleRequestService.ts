import type { Types } from 'mongoose';
import { BadRequest, Conflict, NotFound } from '../errors/AppError.js';
import { offsetPage, pageWindow, type PageQuery } from '../lib/cursor.js';
import { RoleRepository, RoleRequestRepository, UserRepository } from '../repositories/index.js';
import { NotificationService } from './NotificationService.js';
import { RoleService } from './RoleService.js';

type Id = Types.ObjectId;

/** Roles a member can ask for: everything except Founder and the default Member role. */
async function requestableRoles() {
  return (await RoleRepository.findAll()).filter((r) => !r.isFounder && !r.isDefault);
}

export const RoleRequestService = {
  async requestable() {
    return (await requestableRoles()).map((r) => ({
      id: String(r._id),
      name: r.name,
      description: r.description ?? '',
    }));
  },

  async create(userId: Id, roleId: string, reason: string) {
    const role = (await requestableRoles()).find((r) => String(r._id) === roleId);
    if (!role) throw new BadRequest('This role cannot be requested');
    const user = await UserRepository.findAuthById(userId);
    if (!user) throw new NotFound();
    if (user.roleIds?.some((r) => String(r) === roleId))
      throw new BadRequest('You already have this role');
    if (await RoleRequestRepository.findPendingFor(userId))
      throw new Conflict('You already have a pending request');
    try {
      await RoleRequestRepository.create({ userId, roleId, reason });
    } catch (e) {
      if ((e as { code?: number }).code === 11000)
        throw new Conflict('You already have a pending request');
      throw e;
    }
  },

  async mine(userId: Id) {
    const rows = await RoleRequestRepository.mine(userId);
    const roles = new Map((await RoleRepository.findAll()).map((r) => [String(r._id), r.name]));
    return {
      items: rows.map((r) => ({
        id: String(r._id),
        role: roles.get(String(r.roleId)) ?? '',
        reason: r.reason,
        status: r.status,
        note: r.note ?? '',
        createdAt: r.createdAt,
        handledAt: r.handledAt,
      })),
    };
  },

  async pending(page: PageQuery) {
    const w = pageWindow(page);
    const { items: rows, nextCursor } = offsetPage(
      await RoleRequestRepository.pending(w),
      page.limit,
      w.skip,
    );
    const [users, roles] = await Promise.all([
      UserRepository.publicRefs(rows.map((r) => r.userId)),
      RoleRepository.findAll(),
    ]);
    const roleName = new Map(roles.map((r) => [String(r._id), r.name]));
    return {
      items: rows.map((r) => ({
        id: String(r._id),
        user: users.get(String(r.userId)) ?? null,
        roleId: String(r.roleId),
        role: roleName.get(String(r.roleId)) ?? '',
        reason: r.reason,
        createdAt: r.createdAt,
      })),
      nextCursor,
    };
  },

  async approve(actor: { _id: Id; isFounder: boolean }, id: string) {
    const req = await RoleRequestRepository.handle(id, 'approved', actor._id).catch(() => null);
    if (!req) throw new NotFound('Request not found or already handled');
    try {
      await RoleService.assign(actor, String(req.userId), String(req.roleId));
    } catch (e) {
      await RoleRequestRepository.reopen(id);
      throw e;
    }
    const role = await RoleRepository.findById(req.roleId);
    await NotificationService.notify(req.userId, 'role.approved', { role: role?.name ?? '' });
  },

  async reject(actor: { _id: Id }, id: string, note: string) {
    const req = await RoleRequestRepository.handle(id, 'rejected', actor._id, note).catch(
      () => null,
    );
    if (!req) throw new NotFound('Request not found or already handled');
    const role = await RoleRepository.findById(req.roleId);
    await NotificationService.notify(req.userId, 'role.rejected', {
      role: role?.name ?? '',
      reason: note,
    });
  },
};
