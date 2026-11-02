import { describe, expect, it } from 'vitest';
import { agentFor, createCompany, createQuestion, createUser } from './helpers.js';
import { Answer, Question } from '../src/models/index.js';

async function setup() {
  const c = await createCompany('noon');
  const q = await createQuestion(c._id);
  const user = await createUser();
  const a = await agentFor(user);
  return { q, a, url: `/api/questions/${q._id}/answers` };
}
const tops = (s: { undo: { items: { action: string }[] }; redo: { items: { action: string }[] } }) => ({
  undo: s.undo.items.map((e) => e.action),
  redo: s.redo.items.map((e) => e.action),
});

describe('history: undo / redo stacks', () => {
  it('undoes and redoes create, edit and delete in stack order', async () => {
    const { q, a, url } = await setup();
    const post = (await a.post(url, { body: 'first' })).body;
    await a.patch(`/api/answers/${post.id}`, { body: 'second' });
    await a.delete(`/api/answers/${post.id}`);
    expect(tops((await a.get('/api/history/stacks')).body)).toEqual({
      undo: ['delete', 'edit', 'create'],
      redo: [],
    });

    // Undo delete → back, with counters restored.
    let s = (await a.post('/api/history/undo')).body;
    expect(tops(s)).toEqual({ undo: ['edit', 'create'], redo: ['delete'] });
    expect((await Answer.findById(post.id).lean())!.deletedAt).toBeNull();
    expect((await Question.findById(q._id).lean())!.answerCount).toBe(1);

    // Undo edit → old text.
    s = (await a.post('/api/history/undo')).body;
    expect((await Answer.findById(post.id).lean())!.body).toBe('first');
    expect(tops(s)).toEqual({ undo: ['create'], redo: ['edit', 'delete'] });

    // Redo edit → new text again.
    s = (await a.post('/api/history/redo')).body;
    expect((await Answer.findById(post.id).lean())!.body).toBe('second');
    expect(tops(s)).toEqual({ undo: ['edit', 'create'], redo: ['delete'] });

    // A new action clears the redo stack.
    await a.post(url, { body: 'another' });
    s = (await a.get('/api/history/stacks')).body;
    expect(tops(s)).toEqual({ undo: ['create', 'edit', 'create'], redo: [] });
    expect((await a.post('/api/history/redo')).status).toBe(400);

    // The log shows everything, including the undo/redo steps.
    const log = (await a.get('/api/history')).body.items.map((e: { action: string }) => e.action);
    expect(log).toEqual(['create', 'redo', 'undo', 'undo', 'delete', 'edit', 'create']);
  });

  it('skips a step when someone else changed the item since', async () => {
    const { a, url } = await setup();
    const mod = await agentFor(await createUser({ roles: ['Founder'] }));
    const post = (await a.post(url, { body: 'mine' })).body;
    await a.patch(`/api/answers/${post.id}`, { body: 'edited' });
    await mod.delete(`/api/answers/${post.id}`);
    const res = await a.post('/api/history/undo');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('history_stale');
    expect(tops((await a.get('/api/history/stacks')).body).undo).toEqual(['create']);
  });

  it('only logs.view sees everyone; moderation actions are logged', async () => {
    const { a, url } = await setup();
    await a.post(url, { body: 'hello' });
    const founder = await createUser({ roles: ['Founder'] });
    const f = await agentFor(founder);
    await f.post('/api/admin/roles', { name: 'Helper' });
    expect((await a.get('/api/history?scope=all')).status).toBe(403);
    const all = (await f.get('/api/history?scope=all')).body.items;
    expect(all[0]).toMatchObject({
      action: 'create',
      targetType: 'role',
      label: 'Helper',
      actor: { username: founder.username },
    });
    expect(all[1]).toMatchObject({ action: 'create', targetType: 'answer', label: 'hello' });
    expect((await f.get('/api/history')).body.items).toHaveLength(1);
  });
});
