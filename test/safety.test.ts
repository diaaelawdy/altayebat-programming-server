import { describe, expect, it } from 'vitest';
import { agentFor, createCompany, createQuestion, createUser, getApp } from './helpers.js';
import request from 'supertest';
import { Report } from '../src/models/index.js';
import { setVpnRanges } from '../src/lib/vpn.js';

async function register(username: string, ip: string, extra: object = {}) {
  const agent = request.agent(getApp());
  const { body } = await agent.get('/api/auth/csrf').set('x-forwarded-for', ip);
  return agent
    .post('/api/auth/register')
    .set('x-forwarded-for', ip)
    .set('x-csrf-token', body.token)
    .send({ username, password: 'secret1', ...extra });
}

describe('bans', () => {
  it('a banned user sees only the ban notice and can still message the team', async () => {
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    const user = await createUser();
    const f = await agentFor(founder);
    const u = await agentFor(user);
    await f.put(`/api/admin/users/${user.id}/status`, {
      status: 'banned',
      reason: 'Insulted another member',
      link: '/c/noon?tab=feedback',
    });

    const me = (await u.get('/api/me')).body.user;
    expect(me.restriction).toMatchObject({
      type: 'banned',
      reason: 'Insulted another member',
      link: '/c/noon?tab=feedback',
    });
    expect(me.permissions).toEqual([]);
    expect((await u.get('/api/companies')).body.error.code).toBe('banned');

    const sent = await u.post('/api/messages', { subject: 'Appeal', body: 'Please review my ban' });
    expect(sent.status).toBe(201);
    const team = (await f.get('/api/messages?box=team')).body.items;
    expect(team[0]).toMatchObject({ subject: 'Appeal', with: { username: user.username } });
  });

  it('banning blocks every IP the account used, for new sign-ups and other accounts', async () => {
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    const user = await createUser();
    const other = await createUser();
    const f = await agentFor(founder, { ip: '10.9.9.1' });
    await agentFor(user, { ip: '10.9.9.9' });
    await f.put(`/api/admin/users/${user.id}/status`, { status: 'banned', reason: 'Spam' });

    const blocked = await register('fresh_one', '10.9.9.9');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('banned');
    const o = await agentFor(other, { ip: '10.9.9.9' });
    expect((await o.get('/api/me')).body.user.restriction).toMatchObject({
      type: 'banned',
      byIp: true,
    });
    expect((await register('elsewhere', '10.9.9.2')).status).toBe(201);

    await f.put(`/api/admin/users/${user.id}/status`, { status: 'active' });
    expect((await register('fresh_two', '10.9.9.9')).status).toBe(201);
  });

  it('a Founder cannot be banned, and nobody can ban themselves', async () => {
    const a = await createUser({ roles: ['Founder', 'Member'] });
    const b = await createUser({ roles: ['Founder', 'Member'] });
    const f = await agentFor(a);
    expect(
      (await f.put(`/api/admin/users/${b.id}/status`, { status: 'banned', reason: 'x y z' }))
        .status,
    ).toBe(400);
    expect(
      (await f.put(`/api/admin/users/${a.id}/status`, { status: 'banned', reason: 'x y z' }))
        .status,
    ).toBe(400);
  });
});

describe('disabled accounts and messaging', () => {
  it('a disabled account can browse but not post, and its IPs stay open', async () => {
    const founder = await createUser({ roles: ['Founder'] });
    const user = await createUser();
    await createCompany('noon');
    const f = await agentFor(founder, { ip: '10.8.8.1' });
    const u = await agentFor(user, { ip: '10.8.8.8' });
    await f.put(`/api/admin/users/${user.id}/status`, { status: 'disabled', reason: 'Cool off' });

    expect((await u.get('/api/me')).body.user.restriction).toMatchObject({
      type: 'disabled',
      reason: 'Cool off',
      canMessage: true,
    });
    expect((await u.get('/api/companies')).status).toBe(200);
    const post = await u.post('/api/companies/noon/comments', { body: 'hello' });
    expect(post.body.error.code).toBe('disabled');
    expect((await u.post('/api/messages', { subject: 'Why', body: 'Why me?' })).status).toBe(201);
    expect((await register('same_net', '10.8.8.8')).status).toBe(201);
  });

  it('messaging can be turned off: no sending, and only the team can write to them', async () => {
    const founder = await createUser({ roles: ['Founder'] });
    const user = await createUser();
    const f = await agentFor(founder);
    const u = await agentFor(user);
    const { body: role } = await f.post('/api/admin/roles', {
      name: 'Messenger',
      permissions: ['messages.send_any'],
    });
    const sender = await createUser();
    await f.put(`/api/admin/users/${sender.id}/role`, { roleId: role.id });
    const s = await agentFor(sender);
    const { body: conv } = await s.post('/api/messages', {
      subject: 'Hi',
      body: 'hello',
      to: user.username,
    });

    await f.put(`/api/admin/users/${user.id}/status`, {
      status: 'banned',
      reason: 'Spam in messages',
      canMessage: false,
    });
    const sent = await u.post('/api/messages', { subject: 'Appeal', body: 'Please' });
    expect(sent.body.error.code).toBe('messages_off');
    expect((await u.get('/api/messages')).status).toBe(200);
    const blocked = await s.post(`/api/messages/${conv.id}/reply`, { body: 'again' });
    expect(blocked.body.error.code).toBe('recipient_messages_off');
    expect(
      (await f.post('/api/messages', { subject: 'Ban', body: 'Read this', to: user.username }))
        .status,
    ).toBe(201);
  });
});

describe('VPN and proxy detection', () => {
  it('signed-in users on a VPN can browse but not post; guests are unaffected', async () => {
    setVpnRanges('203.0.113.0/24\n198.51.100.7');
    await createCompany('noon');
    const u = await agentFor(await createUser(), { ip: '203.0.113.50' });
    expect((await u.get('/api/me')).body.user.restriction).toEqual({ type: 'vpn' });
    expect((await u.get('/api/companies')).status).toBe(200);
    const post = await u.post('/api/companies/noon/comments', { body: 'hello' });
    expect(post.status).toBe(403);
    expect(post.body.error.code).toBe('vpn');
    expect((await register('vpn_user', '198.51.100.7')).body.error.code).toBe('vpn');

    const g = await agentFor(undefined, { ip: '203.0.113.9' });
    expect((await g.get('/api/companies')).status).toBe(200);
  });
});

describe('four-eyes review', () => {
  it('a reviewer cannot approve their own question while someone else can', async () => {
    const a = await createUser({ roles: ['Founder', 'Member'] });
    const b = await createUser({ roles: ['Founder', 'Member'] });
    const c = await createCompany('noon');
    const q = await createQuestion(c._id, { status: 'pending', authorId: a.id, title: 'Mine' });
    const fa = await agentFor(a);
    const item = (await fa.get('/api/admin/review')).body.items[0];
    expect(item).toMatchObject({ own: true, canReview: false });
    expect((await fa.post(`/api/admin/review/${q._id}/approve`)).body.error.code).toBe(
      'self_review',
    );
    expect((await fa.post(`/api/admin/review/${q._id}/reject`, { reason: 'nope' })).status).toBe(
      403,
    );
    expect((await (await agentFor(b)).post(`/api/admin/review/${q._id}/approve`)).status).toBe(200);
  });

  it('banned reviewers do not count as "someone else"', async () => {
    const a = await createUser({ roles: ['Founder', 'Member'] });
    const b = await createUser({ roles: ['Founder'] });
    const c = await createCompany('noon');
    const q = await createQuestion(c._id, { status: 'pending', authorId: a.id, title: 'Solo' });
    const { User } = await import('../src/models/index.js');
    await User.updateOne({ _id: b.id }, { $set: { status: 'banned' } });
    expect((await (await agentFor(a)).post(`/api/admin/review/${q._id}/approve`)).status).toBe(200);
  });
});

describe('avatars', () => {
  it('are chosen at sign-up, changeable later, and shown next to the username', async () => {
    const res = await register('masked_one', '10.1.1.1', { avatar: 'venetian-mask:violet' });
    expect(res.status).toBe(201);
    expect((await register('bad_avatar', '10.1.1.2', { avatar: 'photo:me' })).status).toBe(400);

    const u = await agentFor({ username: 'masked_one' } as never).catch(() => null);
    expect(u).toBeNull(); // test password differs; sign in with the registered one instead
    const agent = request.agent(getApp());
    const { body } = await agent.get('/api/auth/csrf');
    await agent
      .post('/api/auth/login')
      .set('x-csrf-token', body.token)
      .send({ username: 'masked_one', password: 'secret1' });
    expect((await agent.get('/api/me')).body.user.avatar).toBe('venetian-mask:violet');
    await agent
      .put('/api/me/avatar')
      .set('x-csrf-token', body.token)
      .send({ avatar: 'ghost:green' });
    const profile = (await agent.get('/api/users/masked_one')).body;
    expect(profile.avatar).toBe('ghost:green');
  });

  it('sign-ups without a choice get a random anonymous avatar', async () => {
    await register('random_one', '10.1.1.3');
    const p = (await (await agentFor()).get('/api/users/random_one')).body;
    expect(p.avatar).toMatch(/^[a-z-]+:[a-z]+$/);
  });
});

describe('profanity', () => {
  it('refuses obscene text and warns on mild insults until confirmed, then reports it', async () => {
    await createCompany('noon');
    const u = await agentFor(await createUser());
    const severe = await u.post('/api/companies/noon/comments', { body: 'يا متناك' });
    expect(severe.status).toBe(422);
    expect(severe.body.error.code).toBe('profanity_blocked');

    const mild = await u.post('/api/companies/noon/comments', {
      body: 'the interviewer was an idiot',
    });
    expect(mild.body.error.code).toBe('profanity_warning');
    const ok = await u.post('/api/companies/noon/comments', {
      body: 'the interviewer was an idiot',
      acknowledgeProfanity: true,
    });
    expect(ok.status).toBe(201);
    const report = await Report.findOne({ targetId: ok.body.id }).lean();
    expect(report).toMatchObject({ source: 'system', targetType: 'comment', status: 'open' });
  });

  it('screens messages too', async () => {
    const u = await agentFor(await createUser());
    const res = await u.post('/api/messages', { subject: 'hey', body: 'fuck this' });
    expect(res.body.error.code).toBe('profanity_blocked');
  });
});

describe('reporting people', () => {
  it('anyone can report a user, with or without a reason; reviewers see it', async () => {
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    const bad = await createUser();
    const a = await agentFor(await createUser());
    expect((await a.post('/api/reports', { targetType: 'user', targetId: bad.id })).status).toBe(
      201,
    );
    const items = (await (await agentFor(founder)).get('/api/admin/reports')).body.items;
    expect(items[0]).toMatchObject({ targetType: 'user', reason: '' });
    expect(items[0].target.link).toBe(`/u/${bad.username}`);
    const self = await (
      await agentFor(bad)
    ).post('/api/reports', {
      targetType: 'user',
      targetId: bad.id,
    });
    expect(self.status).toBe(400);
  });
});

describe('messages', () => {
  it('team messages: every founder sees them; replies show as the site unless signed', async () => {
    const f1 = await createUser({ roles: ['Founder', 'Member'] });
    const f2 = await createUser({ roles: ['Founder', 'Member'] });
    const user = await createUser();
    const u = await agentFor(user);
    const a = await agentFor(f1);
    const b = await agentFor(f2);

    const { body: started } = await u.post('/api/messages', {
      subject: 'Bug report',
      body: 'The editor does not save',
    });
    for (const f of [a, b]) {
      const [c] = (await f.get('/api/messages?box=team')).body.items;
      expect(c).toMatchObject({ subject: 'Bug report', unread: true, status: 'open' });
    }
    expect((await u.get('/api/messages?box=team')).status).toBe(403);

    await a.post(`/api/messages/${started.id}/reply`, { body: 'Fixed, thanks!' });
    const seenByUser = (await u.get(`/api/messages/${started.id}`)).body;
    expect(seenByUser.messages[1].author).toEqual({ system: true });
    expect(seenByUser.answeredBy).toBeNull();
    expect((await u.get('/api/me')).body.user.unreadMessages).toBe(0);

    const seenByOtherFounder = (await b.get('/api/messages?box=team')).body.items[0];
    expect(seenByOtherFounder).toMatchObject({
      status: 'answered',
      answeredBy: { username: f1.username },
    });

    await b.post(`/api/messages/${started.id}/reply`, { body: 'Me here', asTeam: false });
    const later = (await u.get(`/api/messages/${started.id}`)).body.messages;
    expect(later[2].author).toMatchObject({
      username: f2.username,
      role: { kind: 'founder' },
    });

    await u.post(`/api/messages/${started.id}/reply`, { body: 'Still broken' });
    expect((await a.get('/api/messages?box=team')).body.items[0].status).toBe('open');
  });

  it('direct messages need messages.send_any and show the sender with their role', async () => {
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    const member = await createUser();
    const other = await createUser();
    const m = await agentFor(member);
    expect(
      (await m.post('/api/messages', { subject: 'Hi', body: 'yo', to: other.username })).status,
    ).toBe(403);

    const f = await agentFor(founder);
    const { body } = await f.post('/api/messages', {
      subject: 'About your post',
      body: 'Please add examples',
      to: member.username,
    });
    const conv = (await m.get(`/api/messages/${body.id}`)).body;
    expect(conv.messages[0].author).toMatchObject({
      username: founder.username,
      role: { kind: 'founder' },
    });
    expect((await m.post(`/api/messages/${body.id}/reply`, { body: 'Done' })).status).toBe(201);
    expect((await (await agentFor(other)).get(`/api/messages/${body.id}`)).status).toBe(404);
  });
});

describe('flagged content queue', () => {
  it('reviewers see profanity warnings separately, with their own count', async () => {
    await createCompany('noon');
    const founder = await createUser({ roles: ['Founder'] });
    const u = await agentFor(await createUser());
    await u.post('/api/companies/noon/comments', { body: 'احا بقى', acknowledgeProfanity: true });
    const f = await agentFor(founder);
    expect((await f.get('/api/admin/counts')).body).toMatchObject({
      flaggedContent: 1,
      openReports: 0,
    });
    const flagged = (await f.get('/api/admin/reports?source=system')).body.items;
    expect(flagged).toHaveLength(1);
    expect(flagged[0].target.body).toBe('احا بقى');
    expect((await f.get('/api/admin/reports?source=user')).body.items).toHaveLength(0);
  });
});
