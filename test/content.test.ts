import { describe, expect, it } from 'vitest';
import { agentFor, createCompany, createQuestion, createUser, validQuestion } from './helpers.js';
import { Company, Question, User } from '../src/models/index.js';

describe('moderation', () => {
  it('pending submissions are hidden until approved', async () => {
    const author = await createUser();
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    const company = await createCompany('noon');
    const a = await agentFor(author);
    const f = await agentFor(founder);
    const g = await agentFor();

    const sub = await a.post('/api/questions', {
      ...validQuestion,
      companyId: String(company._id),
    });
    expect(sub.status).toBe(201);
    expect((await g.get('/api/companies/noon/questions')).body.items).toHaveLength(0);
    expect((await g.get('/api/companies/noon/questions/two-sum-variant')).status).toBe(404);

    const queue = await f.get('/api/admin/review');
    expect(queue.body.items).toHaveLength(1);
    expect((await f.post(`/api/admin/review/${sub.body.id}/approve`, {})).status).toBe(200);

    const list = await g.get('/api/companies/noon/questions');
    expect(list.body.items.map((q: { title: string }) => q.title)).toEqual(['Two Sum Variant']);
    expect((await Company.findById(company._id))!.questionCount).toBe(1);
    expect((await User.findById(author.id))!.reputation).toBe(15);
    expect((await f.post(`/api/admin/review/${sub.body.id}/approve`, {})).status).toBe(409);
  });

  it('rejection reason is visible to the author', async () => {
    const author = await createUser();
    const f = await agentFor(await createUser({ roles: ['Founder', 'Member'] }));
    const company = await createCompany('noon');
    const a = await agentFor(author);
    const sub = await a.post('/api/questions', {
      ...validQuestion,
      companyId: String(company._id),
    });
    await f.post(`/api/admin/review/${sub.body.id}/reject`, {
      reason: 'Duplicate of an existing question',
    });
    const mine = await a.get('/api/me/submissions');
    expect(mine.body.items[0]).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Duplicate of an existing question',
    });
  });

  it('a proposed company is approved together with its first question', async () => {
    const a = await agentFor(await createUser());
    const f = await agentFor(await createUser({ roles: ['Founder', 'Member'] }));
    const sub = await a.post('/api/questions', {
      ...validQuestion,
      newCompany: { name: 'Acme Labs', linkedinUrl: 'https://linkedin.com/company/acme' },
    });
    expect(sub.status).toBe(201);
    expect((await (await agentFor()).get('/api/companies/acme-labs')).status).toBe(404);
    await f.post(`/api/admin/review/${sub.body.id}/approve`, {});
    const c = await (await agentFor()).get('/api/companies/acme-labs');
    expect(c.status).toBe(200);
    expect(c.body.questionCount).toBe(1);
  });
});

describe('bulk question upload', () => {
  it('submits several questions for one company, all pending', async () => {
    const a = await agentFor(await createUser());
    const company = await createCompany();
    const res = await a.post('/api/questions/bulk', {
      companyId: String(company._id),
      questions: [validQuestion, { ...validQuestion, title: 'Second question here' }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ count: 2, status: 'pending' });
    expect((await a.get('/api/me/submissions')).body.items).toHaveLength(2);
  });

  it('rejects more than 50 questions, invalid items, and a new company without LinkedIn', async () => {
    const a = await agentFor(await createUser());
    const company = await createCompany();
    const many = Array.from({ length: 51 }, (_, i) => ({
      ...validQuestion,
      title: `Question ${i}`,
    }));
    expect(
      (await a.post('/api/questions/bulk', { companyId: String(company._id), questions: many }))
        .status,
    ).toBe(400);
    expect(
      (
        await a.post('/api/questions/bulk', {
          companyId: String(company._id),
          questions: [{ ...validQuestion, problem: 'short' }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await a.post('/api/questions/bulk', {
          newCompany: { name: 'Acme' },
          questions: [validQuestion],
        })
      ).status,
    ).toBe(400);
    expect((await a.get('/api/me/submissions')).body.items).toHaveLength(0);
  });
});

describe('question tags', () => {
  it('validates the tags on submit', async () => {
    const a = await agentFor(await createUser());
    const post = (tags: object) => a.post('/api/questions', { ...validQuestion, ...tags });
    expect((await post({ topics: ['Not a topic'] })).status).toBe(400);
    expect((await post({ levels: [] })).status).toBe(400);
    expect((await post({ levels: ['Intern', 'Junior', 'Mid', 'Senior'] })).status).toBe(400);
    // Backend is a Software specialization.
    expect((await post({ field: 'Data', specializations: ['Backend'] })).status).toBe(400);
  });

  it('filters by field, specialization, level and topic', async () => {
    const company = await createCompany('noon');
    await createQuestion(company._id, {
      title: 'Backend junior',
      tags: { specializations: ['Backend'], levels: ['Junior'] },
    });
    await createQuestion(company._id, {
      title: 'Backend senior design',
      tags: { specializations: ['Backend'], levels: ['Senior'], topics: ['System Design'] },
    });
    await createQuestion(company._id, {
      title: 'Data sql',
      tags: {
        field: 'Data',
        specializations: ['Data Analysis'],
        levels: ['Mid'],
        topics: ['SQL & Databases'],
      },
    });
    const g = await agentFor();
    const titles = async (query: string) =>
      (await g.get(`/api/companies/noon/questions?${query}`)).body.items
        .map((q: { title: string }) => q.title)
        .sort();
    expect(await titles('field=Software')).toEqual(['Backend junior', 'Backend senior design']);
    expect(await titles('specialization=Backend&level=Senior')).toEqual(['Backend senior design']);
    expect(await titles('level=Junior')).toEqual(['Backend junior']);
    expect(await titles(`topic=${encodeURIComponent('SQL & Databases')}`)).toEqual(['Data sql']);
  });

  it('keeps specializations inside the field on edits', async () => {
    const f = await agentFor(await createUser({ roles: ['Founder', 'Member'] }));
    const company = await createCompany('noon');
    const q = await createQuestion(company._id, { tags: { specializations: ['Backend'] } });
    expect((await f.patch(`/api/questions/${q._id}`, { field: 'Data' })).status).toBe(400);
    const ok = await f.patch(`/api/questions/${q._id}`, {
      field: 'Data',
      specializations: ['Data Science'],
      levels: ['Senior'],
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      field: 'Data',
      specializations: ['Data Science'],
      levels: ['Senior'],
    });
  });
});

describe('"I was asked this too"', () => {
  it('increments frequency once per user and updates last asked', async () => {
    const c = await createCompany('noon');
    const q = await createQuestion(c._id);
    await Question.updateOne({ _id: q._id }, { lastAskedAt: new Date('2026-01-10') });
    const a = await agentFor(await createUser());
    const r1 = await a.post(`/api/questions/${q._id}/asked`, { month: '2026-09', stage: 'Onsite' });
    expect(r1.status).toBe(200);
    expect(r1.body.timesAsked).toBe(2);
    expect(r1.body.lastAskedAt).toMatch(/^2026-09/);
    expect((await a.post(`/api/questions/${q._id}/asked`, { month: '2026-10' })).status).toBe(409);
  });
});

describe('threads', () => {
  it('nested replies load in one request and counters stay consistent', async () => {
    const c = await createCompany('noon');
    const q = await createQuestion(c._id);
    const a = await agentFor(await createUser());
    const root = (await a.post(`/api/questions/${q._id}/answers`, { body: 'root' })).body;
    const r1 = (await a.post(`/api/questions/${q._id}/answers`, { body: 'r1', parentId: root.id }))
      .body;
    const r2 = (await a.post(`/api/questions/${q._id}/answers`, { body: 'r2', parentId: r1.id }))
      .body;
    expect(r2.depth).toBe(2);
    const thread = (await a.get(`/api/questions/${q._id}/answers`)).body;
    expect(thread.items).toHaveLength(1);
    expect(thread.items[0].replies.map((r: { id: string }) => r.id)).toEqual([r1.id, r2.id]);
    expect((await Question.findById(q._id))!.answerCount).toBe(1);
  });

  it('company feedback supports unlimited depth', async () => {
    await createCompany('noon');
    const a = await agentFor(await createUser());
    let parentId: string | undefined;
    for (let i = 0; i < 8; i++) {
      const r = await a.post('/api/companies/noon/comments', { body: `level ${i}`, parentId });
      expect(r.status).toBe(201);
      parentId = r.body.id;
    }
    const thread = (await a.get('/api/companies/noon/comments')).body;
    expect(thread.items[0].replies).toHaveLength(7);
    expect(thread.items[0].replies.at(-1).depth).toBe(7);
  });

  it('sanitizes markdown (no XSS)', async () => {
    const c = await createCompany('noon');
    const q = await createQuestion(c._id);
    const a = await agentFor(await createUser());
    const r = await a.post(`/api/questions/${q._id}/answers`, {
      body: '<img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1)) `ok`',
    });
    expect(r.body.bodyHtml).not.toMatch(/onerror|<script|javascript:/i);
    expect(r.body.bodyHtml).toContain('<code>ok</code>');
  });

  it('only authors or moderators can delete', async () => {
    const c = await createCompany('noon');
    const q = await createQuestion(c._id);
    const a = await agentFor(await createUser());
    const b = await agentFor(await createUser());
    const post = (await a.post(`/api/questions/${q._id}/answers`, { body: 'mine' })).body;
    expect((await b.delete(`/api/answers/${post.id}`)).status).toBe(403);
    expect((await a.delete(`/api/answers/${post.id}`)).status).toBe(204);
  });

  it('deleted posts disappear unless a live reply sits under them', async () => {
    const c = await createCompany('noon');
    const q = await createQuestion(c._id);
    const a = await agentFor(await createUser());
    const url = `/api/questions/${q._id}/answers`;
    const root = (await a.post(url, { body: 'root' })).body;
    const mid = (await a.post(url, { body: 'mid', parentId: root.id })).body;
    const leaf = (await a.post(url, { body: 'leaf', parentId: mid.id })).body;
    const lone = (await a.post(url, { body: 'lone' })).body;

    await a.delete(`/api/answers/${lone.id}`);
    await a.delete(`/api/answers/${mid.id}`);
    let items = (await a.get(url)).body.items;
    expect(items.map((r: { id: string }) => r.id)).toEqual([root.id]);
    expect(
      items[0].replies.map((r: { id: string; deleted: boolean }) => [r.id, r.deleted]),
    ).toEqual([
      [mid.id, true],
      [leaf.id, false],
    ]);

    await a.delete(`/api/answers/${leaf.id}`);
    await a.delete(`/api/answers/${root.id}`);
    items = (await a.get(url)).body.items;
    expect(items).toEqual([]);
  });
});

describe('ratings', () => {
  it('one review per user per company, averages update', async () => {
    await createCompany('noon');
    const a = await agentFor(await createUser());
    const b = await agentFor(await createUser());
    await a.put('/api/companies/noon/reviews/mine', {
      overall: 5,
      experience: 4,
      difficulty: 2,
      communication: 4,
    });
    await b.put('/api/companies/noon/reviews/mine', {
      overall: 2,
      experience: 2,
      difficulty: 4,
      communication: 2,
    });
    await b.put('/api/companies/noon/reviews/mine', {
      overall: 3,
      experience: 3,
      difficulty: 4,
      communication: 3,
    });
    const c = (await a.get('/api/companies/noon')).body;
    expect(c.rating).toMatchObject({
      count: 2,
      overall: 4,
      experience: 3.5,
      distribution: [0, 0, 1, 0, 1],
    });
    const list = (await b.get('/api/companies/noon/reviews')).body;
    expect(list.items).toHaveLength(2);
    expect(list.mine.overall).toBe(3);
    expect(
      (
        await a.put('/api/companies/noon/reviews/mine', {
          overall: 9,
          experience: 1,
          difficulty: 1,
          communication: 1,
        })
      ).status,
    ).toBe(400);
  });
});
