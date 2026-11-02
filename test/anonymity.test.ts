import { describe, expect, it } from 'vitest';
import { agentFor, createCompany, createQuestion, createUser } from './helpers.js';

const IDENTITY_KEYS = ['email', 'googleId', 'passwordHash'];
import { User } from '../src/models/index.js';

function findIdentityKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findIdentityKeys(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(IDENTITY_KEYS.includes(k) ? [`${path}.${k}`] : []),
      ...findIdentityKeys(v, `${path}.${k}`),
    ]);
  }
  return [];
}

/**
 * Builds a world with every kind of user-generated content, then crawls every
 * public and self-service endpoint and asserts no identity data ever appears.
 */
describe('anonymity', () => {
  it('never returns identity data or password hashes from any endpoint', async () => {
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    const alice = await createUser();
    const bob = await createUser();
    const company = await createCompany('noon');
    const q = await createQuestion(company._id, { authorId: alice.id, title: 'Cart Merge' });

    const a = await agentFor(alice);
    const b = await agentFor(bob);
    const f = await agentFor(founder);

    const answer = (await a.post(`/api/questions/${q._id}/answers`, { body: 'Use a **map**.' }))
      .body;
    const reply = (
      await b.post(`/api/questions/${q._id}/answers`, { body: 'Nice', parentId: answer.id })
    ).body;
    expect(reply.id).toBeTruthy();
    await b.put('/api/votes', { targetType: 'answer', targetId: answer.id, value: 1 });
    const comment = (await a.post('/api/companies/noon/comments', { body: 'Friendly process' }))
      .body;
    await b.post('/api/companies/noon/comments', { body: 'Agreed', parentId: comment.id });
    const review = (
      await b.put('/api/companies/noon/reviews/mine', {
        overall: 4,
        experience: 4,
        difficulty: 3,
        communication: 5,
        body: 'Good',
      })
    ).body;
    await a.put('/api/votes', { targetType: 'review', targetId: review.id, value: 1 });
    await b.post(`/api/questions/${q._id}/asked`, {
      month: '2026-09',
      specialization: 'Backend',
      level: 'Junior',
    });
    await b.post('/api/reports', {
      targetType: 'answer',
      targetId: answer.id,
      reason: 'Spam test',
    });
    const sub = await a.post('/api/questions', {
      title: 'Pending one',
      field: 'Data',
      levels: ['Senior'],
      stage: 'Onsite',
      difficulty: 'Hard',
      topics: ['SQL & Databases'],
      problem: 'A long enough problem statement here.',
      companyId: String(company._id),
    });
    expect(sub.status).toBe(201);

    const guest = await agentFor();
    const urls = [
      '/api/me',
      '/api/companies',
      '/api/companies/noon',
      '/api/companies/noon/questions',
      '/api/companies/noon/questions/cart-merge',
      '/api/companies/noon/comments',
      '/api/companies/noon/reviews',
      `/api/questions/${q._id}/answers`,
      `/api/questions/${q._id}/related`,
      '/api/questions/recent',
      '/api/questions/daily',
      '/api/questions/search?q=cart',
      `/api/users/${alice.username}`,
      `/api/users/${bob.username}`,
      '/api/meta',
    ];
    const selfUrls = [
      '/api/me',
      '/api/me/submissions',
      '/api/me/answers',
      '/api/me/bookmarks',
      '/api/me/progress',
      '/api/me/notifications',
      '/api/me/activity',
    ];
    // Moderator-facing endpoints must stay anonymous too.
    const modUrls = [
      '/api/admin/review',
      '/api/admin/reports',
      '/api/admin/roles',
      '/api/admin/companies',
      `/api/admin/user-lookup?q=${alice.username}`,
    ];

    const hashes = await User.find().select('+passwordHash').lean();
    const secrets = hashes.map((u) => u.passwordHash);
    expect(secrets).toHaveLength(3);
    const check = async (agent: Awaited<ReturnType<typeof agentFor>>, url: string) => {
      const res = await agent.get(url);
      expect(res.status, url).toBeLessThan(400);
      const text = JSON.stringify(res.body);
      for (const s of secrets) expect(text, `${url} leaks ${s}`).not.toContain(s);
      expect(findIdentityKeys(res.body), url).toEqual([]);
    };

    for (const url of urls) await check(guest, url);
    for (const url of [...urls, ...selfUrls]) await check(a, url);
    for (const url of [...urls, ...selfUrls, ...modUrls]) await check(f, url);

    // Write responses are anonymous too.
    for (const body of [answer, reply, comment, review]) {
      for (const s of secrets) expect(JSON.stringify(body)).not.toContain(s);
    }
  });

  it('the users admin page needs users.view_private and leaks no hashes', async () => {
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    const member = await createUser();
    const f = await agentFor(founder);
    const m = await agentFor(member);

    const list = await f.get('/api/admin/users');
    expect(list.status).toBe(200);
    expect(findIdentityKeys(list.body)).toEqual([]);
    const detail = await f.get(`/api/admin/users/${member.id}`);
    expect(detail.body.username).toBe(member.username);
    expect(findIdentityKeys(detail.body)).toEqual([]);
    expect(detail.headers['cache-control']).toBe('no-store');

    expect((await m.get('/api/admin/users')).status).toBe(403);
    expect((await m.get(`/api/admin/users/${founder.id}`)).status).toBe(403);
    expect((await (await agentFor()).get('/api/admin/users')).status).toBe(401);
  });

  it('public profiles list questions, answers, feedback and companies, never reviews', async () => {
    const u = await createUser();
    await createCompany('noon');
    const a = await agentFor(u);
    await a.put('/api/companies/noon/reviews/mine', {
      overall: 2,
      experience: 2,
      difficulty: 4,
      communication: 1,
    });
    await a.post('/api/companies/noon/comments', { body: 'They ghosted me' });
    const g = await agentFor();
    const profile = (await g.get(`/api/users/${u.username}`)).body;
    expect(Object.keys(profile).sort()).toEqual(
      [
        'avatar',
        'badges',
        'counts',
        'id',
        'joinedAt',
        'reputation',
        'role',
        'stats',
        'username',
      ].sort(),
    );
    expect(profile.counts).toEqual({ questions: 0, answers: 0, feedback: 1, companies: 0 });
    expect(profile.role).toEqual({ name: 'Member', kind: 'member' });
    const feedback = (await g.get(`/api/users/${u.username}/feedback`)).body;
    expect(feedback.items.map((f: { excerpt: string }) => f.excerpt)).toEqual(['They ghosted me']);
    // Reviews are never a profile tab.
    expect((await g.get(`/api/users/${u.username}/reviews`)).status).toBe(400);
    expect(profile.joinedAt).toMatch(/^\d{4}-\d{2}$/); // month precision only
  });
});
