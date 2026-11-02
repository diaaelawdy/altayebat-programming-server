import { describe, expect, it } from 'vitest';
import { agentFor, createCompany, createQuestion, createUser } from './helpers.js';
import { Answer, User, Vote } from '../src/models/index.js';

async function setup() {
  const c = await createCompany('noon');
  const q = await createQuestion(c._id);
  const author = await createUser();
  const a = await agentFor(author);
  const answer = (await a.post(`/api/questions/${q._id}/answers`, { body: 'answer' })).body;
  return { q, author, a, answer };
}

describe('voting', () => {
  it('up, remove, switch — one vote per user, score denormalized', async () => {
    const { answer, author } = await setup();
    const v = await agentFor(await createUser());
    const vote = (value: number) =>
      v.put('/api/votes', { targetType: 'answer', targetId: answer.id, value });

    expect((await vote(1)).body).toEqual({ score: 1, myVote: 1 });
    expect((await vote(1)).body).toEqual({ score: 1, myVote: 1 }); // idempotent
    expect((await vote(-1)).body).toEqual({ score: -1, myVote: -1 }); // switch
    expect((await vote(0)).body).toEqual({ score: 0, myVote: 0 }); // remove
    expect(await Vote.countDocuments()).toBe(0);
    const doc = await Answer.findById(answer.id);
    expect([doc!.upvotes, doc!.downvotes, doc!.score]).toEqual([0, 0, 0]);
    expect((await User.findById(author.id))!.reputation).toBe(0);
  });

  it('cannot vote on own post', async () => {
    const { a, answer } = await setup();
    expect(
      (await a.put('/api/votes', { targetType: 'answer', targetId: answer.id, value: 1 })).status,
    ).toBe(400);
  });

  it('concurrent votes are counted exactly', async () => {
    const { answer, author } = await setup();
    const voters = await Promise.all(
      Array.from({ length: 12 }, async () => agentFor(await createUser())),
    );
    await Promise.all(
      voters.map((v) =>
        v.put('/api/votes', { targetType: 'answer', targetId: answer.id, value: 1 }),
      ),
    );
    // The same user double-clicking concurrently still counts once.
    await Promise.all(
      [1, 2, 3].map(() =>
        voters[0]!.put('/api/votes', { targetType: 'answer', targetId: answer.id, value: 1 }),
      ),
    );
    const doc = await Answer.findById(answer.id);
    expect(doc!.score).toBe(12);
    expect(await Vote.countDocuments({ targetId: answer.id })).toBe(12);
    expect((await User.findById(author.id))!.reputation).toBe(60);
  });

  it('answers sort by score, then newest', async () => {
    const { q } = await setup();
    const p = await agentFor(await createUser());
    const low = (await p.post(`/api/questions/${q._id}/answers`, { body: 'low' })).body;
    const high = (await p.post(`/api/questions/${q._id}/answers`, { body: 'high' })).body;
    const v = await agentFor(await createUser());
    await v.put('/api/votes', { targetType: 'answer', targetId: high.id, value: 1 });
    await v.put('/api/votes', { targetType: 'answer', targetId: low.id, value: -1 });
    const thread = (await v.get(`/api/questions/${q._id}/answers`)).body.items.map(
      (i: { body: string; myVote: number }) => [i.body, i.myVote],
    );
    expect(thread).toEqual([
      ['high', 1],
      ['answer', 0],
      ['low', -1],
    ]);
  });

  it('cursor pagination walks every answer exactly once', async () => {
    const { q } = await setup();
    const p = await agentFor(await createUser());
    for (let i = 0; i < 7; i++) await p.post(`/api/questions/${q._id}/answers`, { body: `a${i}` });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/api/questions/${q._id}/answers?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const page = (await p.get(url)).body;
      seen.push(...page.items.map((i: { id: string }) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });
});

describe('study & gamification', () => {
  it('bookmarks, studied, progress and badges', async () => {
    const c = await createCompany('noon');
    const qs = await Promise.all([1, 2].map(() => createQuestion(c._id)));
    const { CompanyService } = await import('../src/services/CompanyService.js');
    await CompanyService.refreshCounters(c._id);
    const user = await createUser();
    const u = await agentFor(user);
    await u.put(`/api/questions/${qs[0]!._id}/bookmark`);
    expect((await u.get('/api/me/bookmarks')).body.items).toHaveLength(1);
    for (const q of qs) await u.put(`/api/questions/${q._id}/studied`);
    const progress = (await u.get('/api/me/progress')).body.items;
    expect(progress[0]).toMatchObject({ studied: 2, total: 2 });
    const me = (await u.get('/api/me')).body.user;
    expect(me.badges.map((b: { key: string }) => b.key)).toContain('company_complete');
    expect(me.streak.current).toBe(1);
    expect((await u.get('/api/companies/noon')).body.studied).toBe(2);
  });
});
