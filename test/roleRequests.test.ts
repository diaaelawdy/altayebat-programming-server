import { describe, expect, it } from 'vitest';
import { agentFor, createCompany, createQuestion, createUser } from './helpers.js';
import { Notification, Role, User } from '../src/models/index.js';

const REASON = 'I review interview questions for my team every week.';
const roleId = async (name: string) => String((await Role.findOne({ name }))!._id);

describe('Reviewer role', () => {
  it('can review questions and companies but not manage users', async () => {
    const reviewer = await agentFor(await createUser({ roles: ['Reviewer'] }));
    const author = await createUser();
    const c = await createCompany('noon');
    const q = await createQuestion(c._id, { authorId: author.id, status: 'pending' });
    expect((await reviewer.get('/api/admin/review')).status).toBe(200);
    expect((await reviewer.get('/api/admin/company-review')).status).toBe(200);
    expect((await reviewer.post(`/api/admin/review/${q._id}/approve`, {})).status).toBe(200);
    expect((await reviewer.get('/api/admin/users')).status).toBe(403);
    expect((await reviewer.get('/api/admin/role-requests')).status).toBe(403);
    // Still a regular member otherwise.
    expect((await reviewer.post('/api/companies/noon/comments', { body: 'hello' })).status).toBe(
      201,
    );
  });
});

describe('Role requests', () => {
  it('lists requestable roles without Founder or Member', async () => {
    const m = await agentFor(await createUser());
    const names = (await m.get('/api/roles/requestable')).body.items.map(
      (r: { name: string }) => r.name,
    );
    expect(names).toContain('Reviewer');
    expect(names).not.toContain('Founder');
    expect(names).not.toContain('Member');
  });

  it('member requests, founder approves, role applies and member is notified', async () => {
    const member = await createUser();
    const m = await agentFor(member);
    const reviewerId = await roleId('Reviewer');

    expect(
      (await m.post('/api/role-requests', { roleId: reviewerId, reason: 'short' })).status,
    ).toBe(400);
    expect(
      (await m.post('/api/role-requests', { roleId: reviewerId, reason: REASON })).status,
    ).toBe(201);
    expect(
      (await m.post('/api/role-requests', { roleId: reviewerId, reason: REASON })).status,
    ).toBe(409);
    expect((await m.get('/api/me/role-requests')).body.items[0]).toMatchObject({
      role: 'Reviewer',
      status: 'pending',
    });

    const f = await agentFor(await createUser({ roles: ['Founder'] }));
    expect((await f.get('/api/admin/counts')).body.roleRequests).toBe(1);
    const queue = (await f.get('/api/admin/role-requests')).body.items;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ role: 'Reviewer', reason: REASON });
    expect(queue[0].user.username).toBe(member.username);

    expect((await f.post(`/api/admin/role-requests/${queue[0].id}/approve`, {})).status).toBe(200);
    expect((await f.post(`/api/admin/role-requests/${queue[0].id}/approve`, {})).status).toBe(404);

    const u = await User.findById(member.id).lean();
    expect(u!.roleIds.map(String)).toEqual([reviewerId]);
    expect((await m.get('/api/admin/review')).status).toBe(200);
    expect(await Notification.countDocuments({ userId: member.id, type: 'role.approved' })).toBe(1);
    expect((await m.get('/api/me/role-requests')).body.items[0].status).toBe('approved');
  });

  it('rejects with a note, and the member can ask again', async () => {
    const member = await createUser();
    const m = await agentFor(member);
    const reviewerId = await roleId('Reviewer');
    await m.post('/api/role-requests', { roleId: reviewerId, reason: REASON });
    const f = await agentFor(await createUser({ roles: ['Founder'] }));
    const [rq] = (await f.get('/api/admin/role-requests')).body.items;
    expect(
      (await f.post(`/api/admin/role-requests/${rq.id}/reject`, { note: 'Not yet' })).status,
    ).toBe(200);
    expect((await m.get('/api/me/role-requests')).body.items[0]).toMatchObject({
      status: 'rejected',
      note: 'Not yet',
    });
    expect(await Notification.countDocuments({ userId: member.id, type: 'role.rejected' })).toBe(1);
    expect(
      (await m.post('/api/role-requests', { roleId: reviewerId, reason: REASON })).status,
    ).toBe(201);
  });

  it('refuses Founder, the current role, and guests', async () => {
    const m = await agentFor(await createUser({ roles: ['Reviewer'] }));
    expect(
      (await m.post('/api/role-requests', { roleId: await roleId('Founder'), reason: REASON }))
        .status,
    ).toBe(400);
    expect(
      (await m.post('/api/role-requests', { roleId: await roleId('Reviewer'), reason: REASON }))
        .status,
    ).toBe(400);
    const g = await agentFor();
    expect(
      (await g.post('/api/role-requests', { roleId: await roleId('Reviewer'), reason: REASON }))
        .status,
    ).toBe(401);
  });
});
