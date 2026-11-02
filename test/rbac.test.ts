import { describe, expect, it } from 'vitest';
import { agentFor, createCompany, createQuestion, createUser } from './helpers.js';
import { Role } from '../src/models/index.js';

describe('RBAC', () => {
  it('Member gets 403 on review, roles, users and company admin endpoints', async () => {
    const m = await agentFor(await createUser());
    const other = await createUser();
    const memberRole = await Role.findOne({ isDefault: true });
    const checks: [string, () => Promise<{ status: number }>][] = [
      ['review queue', () => m.get('/api/admin/review')],
      ['approve', () => m.post('/api/admin/review/507f1f77bcf86cd799439011/approve', {})],
      [
        'reject',
        () => m.post('/api/admin/review/507f1f77bcf86cd799439011/reject', { reason: 'nope' }),
      ],
      ['roles list', () => m.get('/api/admin/roles')],
      [
        'create role',
        () => m.post('/api/admin/roles', { name: 'Hacker', permissions: ['roles.manage'] }),
      ],
      [
        'edit role',
        () => m.patch(`/api/admin/roles/${memberRole!._id}`, { permissions: ['roles.manage'] }),
      ],
      ['users list', () => m.get('/api/admin/users')],
      ['assign roles', () => m.put(`/api/admin/users/${other.id}/role`, { roleId: other.id })],
      ['ban', () => m.put(`/api/admin/users/${other.id}/status`, { status: 'banned' })],
      ['reports', () => m.get('/api/admin/reports')],
      ['company review queue', () => m.get('/api/admin/company-review')],
      ['delete question', () => m.delete('/api/questions/507f1f77bcf86cd799439011')],
    ];
    for (const [name, call] of checks) expect((await call()).status, name).toBe(403);
  });

  it('guests get 401 on writes', async () => {
    await createCompany('noon');
    const g = await agentFor();
    expect((await g.post('/api/companies/noon/comments', { body: 'hi' })).status).toBe(401);
    expect(
      (
        await g.put('/api/votes', {
          targetType: 'answer',
          targetId: '507f1f77bcf86cd799439011',
          value: 1,
        })
      ).status,
    ).toBe(401);
  });

  it('rejects writes without a CSRF token', async () => {
    const u = await createUser();
    const a = await agentFor(u);
    await createCompany('noon');
    const res = await a.raw.post('/api/companies/noon/comments').send({ body: 'no token' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });

  it('role changes apply immediately, without a new login', async () => {
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    const user = await createUser();
    const f = await agentFor(founder);
    const u = await agentFor(user);

    expect((await u.get('/api/admin/review')).status).toBe(403);
    const role = await f.post('/api/admin/roles', {
      name: 'Moderator',
      permissions: ['questions.review'],
    });
    expect(role.status).toBe(201);
    expect((await f.put(`/api/admin/users/${user.id}/role`, { roleId: role.body.id })).status).toBe(
      200,
    );

    expect((await u.get('/api/admin/review')).status).toBe(200);
    const me = await u.get('/api/me');
    expect(me.body.user.permissions).toContain('questions.review');
    expect(me.body.user.role).toEqual({ name: 'Moderator', kind: 'staff' });

    // Editing the role's permissions also propagates live.
    await f.patch(`/api/admin/roles/${role.body.id}`, { permissions: [] });
    expect((await u.get('/api/admin/review')).status).toBe(403);
  });

  it('protects the Founder role and keeps at least one Founder', async () => {
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    const f = await agentFor(founder);
    const founderRole = await Role.findOne({ isFounder: true });
    const memberRole = await Role.findOne({ isDefault: true });

    expect(
      (await f.patch(`/api/admin/roles/${founderRole!._id}`, { permissions: [] })).status,
    ).toBe(403);
    expect((await f.delete(`/api/admin/roles/${founderRole!._id}`)).status).toBe(403);
    expect((await f.delete(`/api/admin/roles/${memberRole!._id}`)).status).toBe(403);
    const demote = await f.put(`/api/admin/users/${founder.id}/role`, {
      roleId: String(memberRole!._id),
    });
    expect(demote.status).toBe(400);
  });

  it('Founder has every permission, including ones added later', async () => {
    const f = await agentFor(await createUser({ roles: ['Founder', 'Member'] }));
    const { ALL_PERMISSIONS } = await import('../src/shared/permissions.js');
    const me = await f.get('/api/me');
    expect(new Set(me.body.user.permissions)).toEqual(new Set(ALL_PERMISSIONS));
  });

  it('a non-Founder with users.assign_roles cannot grant Founder', async () => {
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    const f = await agentFor(founder);
    const role = (
      await f.post('/api/admin/roles', { name: 'Admin', permissions: ['users.assign_roles'] })
    ).body;
    const admin = await createUser();
    await f.put(`/api/admin/users/${admin.id}/role`, { roleId: role.id });
    const target = await createUser();
    const founderRole = await Role.findOne({ isFounder: true });
    const a = await agentFor(admin);
    const res = await a.put(`/api/admin/users/${target.id}/role`, {
      roleId: String(founderRole!._id),
    });
    expect(res.status).toBe(403);
  });

  it('banned users lose access immediately', async () => {
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    const user = await createUser();
    await createCompany('noon');
    const f = await agentFor(founder);
    const u = await agentFor(user);
    expect((await u.post('/api/companies/noon/comments', { body: 'hello' })).status).toBe(201);
    expect((await f.put(`/api/admin/users/${user.id}/status`, { status: 'banned' })).status).toBe(
      400, // a reason is required
    );
    await f.put(`/api/admin/users/${user.id}/status`, { status: 'banned', reason: 'Spam' });
    const res = await u.post('/api/companies/noon/comments', { body: 'again' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('banned');
  });

  it('guests can read everything public', async () => {
    const c = await createCompany('noon');
    const q = await createQuestion(c._id, { title: 'Open Question' });
    const g = await agentFor();
    expect((await g.get('/api/companies/noon/questions/open-question')).status).toBe(200);
    expect((await g.get(`/api/questions/${q._id}/answers`)).status).toBe(200);
  });
});

describe('one role per user', () => {
  it('assigning a role replaces the old one; new roles start with Member permissions', async () => {
    const f = await agentFor(await createUser({ roles: ['Founder'] }));
    const user = await createUser();
    const { body: role } = await f.post('/api/admin/roles', { name: 'Mentor' });
    const created = (await f.get('/api/admin/roles')).body.items.find(
      (r: { id: string }) => r.id === role.id,
    );
    const { MEMBER_PERMISSIONS } = await import('../src/shared/permissions.js');
    expect(new Set(created.permissions)).toEqual(new Set(MEMBER_PERMISSIONS));

    await f.put(`/api/admin/users/${user.id}/role`, { roleId: role.id });
    const detail = (await f.get(`/api/admin/users/${user.id}`)).body;
    expect(detail.role).toEqual({ id: role.id, name: 'Mentor' });
    const { User } = await import('../src/models/index.js');
    expect((await User.findById(user.id).lean())!.roleIds).toHaveLength(1);
  });
});

describe('owner account', () => {
  it('always has every permission and can never be banned, disabled or demoted', async () => {
    const owner = await createUser({ username: 'the_owner' });
    const f = await agentFor(await createUser({ roles: ['Founder'] }));
    const memberRole = await Role.findOne({ isDefault: true });
    for (const status of ['banned', 'disabled'])
      expect(
        (await f.put(`/api/admin/users/${owner.id}/status`, { status, reason: 'try it' })).status,
      ).toBe(403);
    expect(
      (await f.put(`/api/admin/users/${owner.id}/role`, { roleId: String(memberRole!._id) }))
        .status,
    ).toBe(403);
    const { User } = await import('../src/models/index.js');
    await User.updateOne({ _id: owner.id }, { $set: { status: 'banned' } });
    const me = (await (await agentFor(owner)).get('/api/me')).body.user;
    expect(me.restriction).toBeNull();
    const { ALL_PERMISSIONS } = await import('../src/shared/permissions.js');
    expect(new Set(me.permissions)).toEqual(new Set(ALL_PERMISSIONS));
  });

  it('analytics: founders and roles granted analytics.view only', async () => {
    const member = await agentFor(await createUser());
    expect((await member.get('/api/admin/analytics')).status).toBe(403);
    const founder = await agentFor(await createUser({ roles: ['Founder', 'Member'] }));
    const res = await founder.get('/api/admin/analytics');
    expect(res.status).toBe(200);
    expect(res.body.users.total).toBe(2);
    expect(res.body.questions).toMatchObject({ submitted: 0, approved: 0 });
    await Role.create({ name: 'Analyst', permissions: ['analytics.view'] });
    const analyst = await agentFor(await createUser({ roles: ['Analyst'] }));
    expect((await analyst.get('/api/admin/analytics')).status).toBe(200);
  });
});
