import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { getApp } from './helpers.js';
import { User } from '../src/models/index.js';

async function client() {
  const agent = request.agent(getApp());
  const { body } = await agent.get('/api/auth/csrf');
  const post = (url: string, data: object) =>
    agent.post(url).set('x-csrf-token', body.token).send(data);
  return { agent, post };
}

describe('username + password auth', () => {
  it('registers, signs in immediately, and every sign-up is a plain Member', async () => {
    const a = await client();
    expect(
      (await a.post('/api/auth/register', { username: 'Calm_Owl-7', password: 'secret1' })).status,
    ).toBe(201);
    const me = (await a.agent.get('/api/me')).body.user;
    expect(me.username).toBe('calm_owl-7'); // stored lowercase
    expect(me.isFounder).toBe(false);
    expect(me.role).toEqual({ name: 'Member', kind: 'member' });
  });

  it('enforces username and password rules', async () => {
    const c = await client();
    const bad = ['ab', '1abc', 'has space', 'émoji', 'a'.repeat(21), 'dots.no'];
    for (const username of bad) {
      expect(
        (await c.post('/api/auth/register', { username, password: 'secret1' })).status,
        username,
      ).toBe(400);
    }
    for (const username of ['abc', '_abc', '-abc', 'a1_b-2']) {
      expect(
        (await c.post('/api/auth/register', { username, password: 'secret1' })).status,
        username,
      ).toBe(201);
    }
    expect(
      (await c.post('/api/auth/register', { username: 'shortpw', password: '12345' })).status,
    ).toBe(400);
  });

  it('rejects taken and reserved usernames, case-insensitively', async () => {
    const c = await client();
    await c.post('/api/auth/register', { username: 'sara', password: 'secret1' });
    expect(
      (await c.post('/api/auth/register', { username: 'SARA', password: 'secret1' })).status,
    ).toBe(409);
    expect(
      (await c.post('/api/auth/register', { username: 'admin', password: 'secret1' })).status,
    ).toBe(409);
    expect((await c.agent.get('/api/auth/username/check?u=Sara')).body).toEqual({
      available: false,
      reason: 'taken',
    });
    expect((await c.agent.get('/api/auth/username/check?u=9lives')).body).toEqual({
      available: false,
      reason: 'format',
    });
    expect((await c.agent.get('/api/auth/username/check?u=fresh_one')).body).toEqual({
      available: true,
    });
  });

  it('logs in with the same generic error for unknown user and wrong password', async () => {
    const c = await client();
    await c.post('/api/auth/register', { username: 'tester', password: 'secret1' });
    const ok = await (
      await client()
    ).post('/api/auth/login', { username: 'TESTER', password: 'secret1' });
    expect(ok.status).toBe(200);
    const wrong = await (
      await client()
    ).post('/api/auth/login', { username: 'tester', password: 'nope00' });
    const unknown = await (
      await client()
    ).post('/api/auth/login', { username: 'ghost', password: 'nope00' });
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('stores only a username and an argon2 hash', async () => {
    const c = await client();
    await c.post('/api/auth/register', { username: 'minimal', password: 'secret1' });
    const raw = await User.collection.findOne({ username: 'minimal' });
    expect(raw?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(raw).not.toHaveProperty('email');
    expect(raw).not.toHaveProperty('googleId');
  });
});
