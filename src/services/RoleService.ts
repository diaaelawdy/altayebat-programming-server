import { isOwner } from '../config/env.js';
import { RoleRepository, UserRepository } from '../repositories/index.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../errors/AppError.js';
import { ALL_PERMISSIONS, isPermission } from '../shared/permissions.js';

function validPerms(perms: string[]) {
  const bad = perms.filter((p) => !isPermission(p));
  if (bad.length) throw new BadRequest(`Unknown permissions: ${bad.join(', ')}`);
  return [...new Set(perms)];
}

export const RoleService = {
  async list() {
    const roles = await RoleRepository.findAll();
    return Promise.all(
      roles.map(async (r) => ({
        id: String(r._id),
        name: r.name,
        description: r.description ?? '',
        permissions: r.isFounder ? ALL_PERMISSIONS : r.permissions,
        isSystem: r.isSystem,
        isDefault: r.isDefault,
        isFounder: r.isFounder,
        userCount: await UserRepository.countWithRole(r._id),
      })),
    );
  },

  async create(input: { name: string; description?: string; permissions?: string[] }) {
    if (await RoleRepository.findByName(input.name))
      throw new Conflict('A role with this name exists');
    // One role per user, so a new role starts from what every Member can do.
    const base = input.permissions ?? (await RoleRepository.findDefault())?.permissions ?? [];
    const role = await RoleRepository.create({
      ...input,
      permissions: validPerms(base),
    });
    return { id: String(role._id) };
  },

  async update(id: string, input: { name?: string; description?: string; permissions?: string[] }) {
    const role = await RoleRepository.findById(id);
    if (!role) throw new NotFound('Role not found');
    if (role.isFounder) throw new Forbidden('The Founder role cannot be changed');
    if (input.name && input.name !== role.name) {
      if (role.isSystem) throw new Forbidden('System roles cannot be renamed');
      const clash = await RoleRepository.findByName(input.name);
      if (clash && String(clash._id) !== id) throw new Conflict('A role with this name exists');
    }
    await RoleRepository.update(id, {
      ...input,
      ...(input.permissions ? { permissions: validPerms(input.permissions) } : {}),
    });
    await UserRepository.bumpPermissionsForRole(id);
  },

  async remove(id: string) {
    const role = await RoleRepository.findById(id);
    if (!role) throw new NotFound('Role not found');
    if (role.isSystem) throw new Forbidden('System roles cannot be deleted');
    await UserRepository.removeRoleEverywhere(id);
    await RoleRepository.delete(id);
  },

  /** Replace a user's roles. Members always keep the default role; at least one Founder must remain. */
  /** Sets a user's single role. Only a Founder can grant or remove Founder. */
  async assign(actor: { isFounder: boolean }, userId: string, roleId: string) {
    const user = await UserRepository.findAuthById(userId);
    if (!user) throw new NotFound('User not found');
    if (isOwner(user.username)) throw new Forbidden('The owner account’s role cannot be changed');
    const role = await RoleRepository.findById(roleId).catch(() => null);
    if (!role) throw new BadRequest('Unknown role');
    const founder = await RoleRepository.findFounder();
    const wasFounder = Boolean(
      founder && user.roleIds?.some((r) => String(r) === String(founder._id)),
    );
    if ((role.isFounder || wasFounder) && !actor.isFounder && role.isFounder !== wasFounder)
      throw new Forbidden('Only a Founder can grant or remove the Founder role');
    if (founder && wasFounder && !role.isFounder) {
      const founders = await UserRepository.countWithRole(founder._id, { status: 'active' });
      if (founders <= 1) throw new BadRequest('At least one Founder must exist');
    }
    await UserRepository.setRoles(userId, [role._id]);
  },
};
