import request from 'supertest';
import argon2 from 'argon2';
import { createApp } from '../src/app.js';
import { Company, Question, Role, User } from '../src/models/index.js';
import { renderMarkdown } from '../src/lib/markdown.js';

let app: ReturnType<typeof createApp> | null = null;
export const getApp = () => (app ??= createApp());

let n = 0;
export async function createUser(
  opts: { roles?: ('Founder' | 'Member' | string)[]; username?: string } = {},
) {
  n += 1;
  const username = opts.username ?? `user${n}_${Math.floor(Math.random() * 1e4)}`;
  // One role per user: the first name given (['Founder', 'Member'] → Founder).
  const roleNames = (opts.roles ?? ['Member']).slice(0, 1);
  const roles = await Role.find({ name: { $in: roleNames } }).lean();
  const user = await User.create({
    username,
    passwordHash: await argon2.hash('password123'),
    roleIds: roles.map((r) => r._id),
  });
  return { id: String(user._id), username };
}

/** A supertest agent that is signed in and sends the CSRF header on writes. */
export async function agentFor(user?: { username: string }, opts: { ip?: string } = {}) {
  const agent = request.agent(getApp());
  // `trust proxy` is on, so X-Forwarded-For sets req.ip: lets tests act from distinct IPs.
  const ip =
    opts.ip ?? `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const withIp = <T extends { set: (k: string, v: string) => T }>(req: T) =>
    req.set('x-forwarded-for', ip);
  const { body } = await withIp(agent.get('/api/auth/csrf'));
  const token = body.token as string;
  if (user) {
    const r = await withIp(agent.post('/api/auth/login'))
      .set('x-csrf-token', token)
      .send({ username: user.username, password: 'password123' });
    if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const withCsrf = <T extends { set: (k: string, v: string) => T }>(req: T) =>
    withIp(req).set('x-csrf-token', token);
  return {
    ip,
    get: (url: string) => withIp(agent.get(url)),
    post: (url: string, data?: object) => withCsrf(agent.post(url)).send(data ?? {}),
    put: (url: string, data?: object) => withCsrf(agent.put(url)).send(data ?? {}),
    patch: (url: string, data?: object) => withCsrf(agent.patch(url)).send(data ?? {}),
    delete: (url: string) => withCsrf(agent.delete(url)),
    raw: agent,
  };
}

export async function createCompany(name = 'noon') {
  return Company.create({
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    status: 'approved',
  });
}

export async function createQuestion(
  companyId: unknown,
  opts: {
    authorId?: string;
    status?: string;
    title?: string;
    tags?: Partial<Record<'field' | 'stage' | 'difficulty', string>> &
      Partial<Record<'specializations' | 'levels' | 'topics', string[]>>;
  } = {},
) {
  const title = opts.title ?? `Question ${Math.random().toString(36).slice(2, 7)}`;
  return Question.create({
    companyId,
    slug: title.toLowerCase().replace(/\W+/g, '-'),
    title,
    field: 'Software',
    specializations: [],
    levels: ['Junior'],
    stage: 'Phone Screen',
    difficulty: 'Easy',
    topics: ['Problem Solving (DSA)'],
    ...opts.tags,
    problem: 'Do the thing in O(n).',
    problemHtml: renderMarkdown('Do the thing in O(n).'),
    status: opts.status ?? 'approved',
    authorId: opts.authorId ?? null,
    publishedAt: new Date(),
  });
}

export const validQuestion = {
  title: 'Two Sum Variant',
  field: 'Software',
  specializations: ['Backend'],
  levels: ['Junior', 'Mid'],
  stage: 'Phone Screen',
  difficulty: 'Easy',
  topics: ['Problem Solving (DSA)'],
  problem: 'Given an array and a target, return indices of two numbers that add up to target.',
  examples: [{ input: '[2,7,11], 9', output: '[0,1]' }],
  constraints: ['n ≤ 10^5'],
  followUps: ['What if the array is sorted?'],
  askedMonth: '2026-09',
};
