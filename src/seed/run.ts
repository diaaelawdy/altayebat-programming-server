import { Company, Question, Role, User } from '../models/index.js';
import {
  ALL_PERMISSIONS,
  FOUNDER_ROLE,
  MEMBER_PERMISSIONS,
  MEMBER_ROLE,
  REVIEWER_PERMISSIONS,
  REVIEWER_ROLE,
} from '../shared/permissions.js';
import { slugify } from '../lib/text.js';
import { CompanyService } from '../services/CompanyService.js';
import { companies, logoFor } from './companies.js';

/** Seeds system roles. Founder holds every permission implicitly (`isFounder`). */
export async function seedRoles() {
  await Role.findOneAndUpdate(
    { isFounder: true },
    {
      $set: {
        name: FOUNDER_ROLE,
        description: 'Owns the platform. Has every permission.',
        isSystem: true,
        isFounder: true,
        permissions: [],
      },
    },
    { upsert: true },
  );
  await Role.findOneAndUpdate(
    { isDefault: true },
    {
      $set: {
        name: MEMBER_ROLE,
        isSystem: true,
        isDefault: true,
        description: 'Every signed-up user.',
      },
      // Keep any extra permissions an admin granted Members; ensure the baseline.
      $addToSet: { permissions: { $each: MEMBER_PERMISSIONS } },
    },
    { upsert: true },
  );
  // Created once; after that admins may edit its permissions like any other role.
  await Role.updateOne(
    { name: REVIEWER_ROLE },
    {
      $set: { isSystem: true },
      $setOnInsert: {
        name: REVIEWER_ROLE,
        description: 'A member who can also review new companies and questions.',
        permissions: REVIEWER_PERMISSIONS,
      },
    },
    { upsert: true },
  );
  // Drop permission keys that no longer exist.
  await Role.updateMany({}, { $pull: { permissions: { $nin: ALL_PERMISSIONS } } });
  await collapseToOneRole();
}

/**
 * Users used to hold several roles; now each has exactly one. Keep Founder, else a
 * staff role (alphabetically), else Member.
 */
async function collapseToOneRole() {
  const roles = await Role.find().lean();
  const byId = new Map(roles.map((r) => [String(r._id), r]));
  const member = roles.find((r) => r.isDefault);
  const users = await User.find({
    $or: [{ 'roleIds.1': { $exists: true } }, { roleIds: { $size: 0 } }],
  })
    .select('roleIds')
    .lean();
  for (const u of users) {
    const mine = (u.roleIds ?? []).map((id) => byId.get(String(id))).filter((r) => r !== undefined);
    const keep =
      mine.find((r) => r.isFounder) ??
      mine.filter((r) => !r.isDefault).sort((a, b) => a.name.localeCompare(b.name))[0] ??
      member;
    if (keep)
      await User.updateOne(
        { _id: u._id },
        { $set: { roleIds: [keep._id] }, $inc: { permissionsVersion: 1 } },
      );
  }
}

/** Idempotent: safe to run repeatedly. */
export async function seedAll() {
  await seedRoles();

  for (const c of companies) {
    await Company.updateOne(
      { slug: slugify(c.name) },
      { $set: { ...c, status: 'approved' }, $setOnInsert: { slug: slugify(c.name) } },
      { upsert: true },
    );
  }

  // Fill missing logos from each site's icon; never overwrite one a reviewer set.
  for (const c of await Company.find({ logoUrl: '' }).select('slug website').lean()) {
    const logoUrl = logoFor(c.slug, c.website ?? '');
    if (logoUrl) await Company.updateOne({ _id: c._id, logoUrl: '' }, { $set: { logoUrl } });
  }

  for (const c of await Company.find().select('_id').lean())
    await CompanyService.refreshCounters(c._id);

  return {
    roles: await Role.countDocuments(),
    companies: await Company.countDocuments(),
    questions: await Question.countDocuments(),
  };
}
