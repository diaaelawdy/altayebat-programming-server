import { describe, expect, it } from 'vitest';
import { agentFor, createCompany, createQuestion, createUser } from './helpers.js';
import { Role } from '../src/models/index.js';

const suggestion = {
  name: 'Swvl',
  website: 'https://swvl.com',
  linkedinUrl: 'https://www.linkedin.com/company/swvl',
  industry: 'Transport',
};

describe('company suggestions', () => {
  it('members suggest companies; they stay hidden until a reviewer approves', async () => {
    const member = await createUser();
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    const m = await agentFor(member);
    const f = await agentFor(founder);

    const created = await m.post('/api/companies', suggestion);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');
    expect((await m.get('/api/companies/swvl')).status).toBe(404);
    expect((await m.get('/api/me/companies')).body.items[0].status).toBe('pending');

    const queue = (await f.get('/api/admin/company-review')).body.items;
    expect(queue).toHaveLength(1);
    expect(queue[0].createdBy.username).toBe(member.username);
    expect((await f.get('/api/admin/counts')).body.pendingCompanies).toBe(1);

    expect((await f.post(`/api/admin/company-review/${created.body.id}/approve`)).status).toBe(204);
    const page = (await (await agentFor()).get('/api/companies/swvl')).body;
    expect(page.linkedinUrl).toBe(suggestion.linkedinUrl);
    expect(page.createdBy).toMatchObject({
      username: member.username,
      role: { name: 'Member', kind: 'member' },
    });

    const tab = (await (await agentFor()).get(`/api/users/${member.username}/companies`)).body;
    expect(tab.items.map((c: { slug: string }) => c.slug)).toEqual(['swvl']);
  });

  it('a reviewer cannot approve their own company while another reviewer exists', async () => {
    const a = await agentFor(await createUser({ roles: ['Founder', 'Member'] }));
    const b = await agentFor(await createUser({ roles: ['Founder', 'Member'] }));
    const { body } = await a.post('/api/companies', {
      name: 'Paymob',
      linkedinUrl: 'https://linkedin.com/company/x',
    });
    expect(body.status).toBe('pending');
    const mine = (await a.get('/api/admin/company-review')).body.items[0];
    expect(mine).toMatchObject({ own: true, canReview: false });
    const self = await a.post(`/api/admin/company-review/${body.id}/approve`);
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('self_review');
    expect((await b.post(`/api/admin/company-review/${body.id}/approve`)).status).toBe(204);
  });

  it('the only reviewer may approve their own company', async () => {
    const a = await agentFor(await createUser({ roles: ['Founder', 'Member'] }));
    const { body } = await a.post('/api/companies', {
      name: 'Fawry',
      linkedinUrl: 'https://linkedin.com/company/x',
    });
    expect((await a.get('/api/admin/company-review')).body.items[0].canReview).toBe(true);
    expect((await a.post(`/api/admin/company-review/${body.id}/approve`)).status).toBe(204);
  });

  it('LinkedIn links must be linkedin.com', async () => {
    const a = await agentFor(await createUser());
    expect(
      (await a.post('/api/companies', { name: 'Fawry', linkedinUrl: 'https://evil.com/x' })).status,
    ).toBe(400);
  });

  it('rejecting notifies the author and keeps the company off the public list', async () => {
    const member = await createUser();
    const m = await agentFor(member);
    const f = await agentFor(await createUser({ roles: ['Founder', 'Member'] }));
    const { body } = await m.post('/api/companies', suggestion);
    expect(
      (await f.post(`/api/admin/company-review/${body.id}/reject`, { reason: 'Duplicate' })).status,
    ).toBe(204);
    expect((await m.get('/api/me/companies')).body.items[0]).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Duplicate',
    });
    const notes = (await m.get('/api/me/notifications')).body.items;
    expect(notes[0].type).toBe('company.rejected');
    const list = (await m.get('/api/companies')).body.items.map((c: { slug: string }) => c.slug);
    expect(list).not.toContain('swvl');
  });

  it('LinkedIn is required and members cannot set a logo; the reviewer adds it', async () => {
    const m = await agentFor(await createUser());
    const f = await agentFor(await createUser({ roles: ['Founder', 'Member'] }));
    expect((await m.post('/api/companies', { name: 'Thndr' })).status).toBe(400);
    const { body } = await m.post('/api/companies', {
      ...suggestion,
      logoUrl: 'https://example.com/logo.png',
    });
    expect(body.logoUrl).toBe('');
    const logoUrl = 'https://cdn.example.com/swvl.png';
    expect(
      (await f.post(`/api/admin/company-review/${body.id}/approve`, { edits: { logoUrl } })).status,
    ).toBe(204);
    expect((await m.get('/api/companies/swvl')).body.logoUrl).toBe(logoUrl);
  });

  it('members cannot review suggestions', async () => {
    const m = await agentFor(await createUser());
    expect((await m.get('/api/admin/company-review')).status).toBe(403);
  });
});

describe('who reviewed it', () => {
  it('is visible only with moderation.view_reviewer', async () => {
    const founder = await createUser({ roles: ['Founder', 'Member'] });
    await Role.create({ name: 'Auditor', permissions: ['moderation.view_reviewer'] });
    const auditor = await createUser({ roles: ['Auditor'] });
    const member = await createUser();
    const company = await createCompany('noon');
    const q = await createQuestion(company._id, { status: 'pending', title: 'Reviewed one' });
    const f = await agentFor(founder);
    expect((await f.post(`/api/admin/review/${q._id}/approve`)).status).toBeLessThan(300);

    const url = '/api/companies/noon/questions/reviewed-one';
    const seen = (await (await agentFor(auditor)).get(url)).body.review;
    expect(seen.by).toMatchObject({
      username: founder.username,
      role: { name: 'Founder', kind: 'founder' },
    });
    expect(seen.at).toBeTruthy();
    expect((await (await agentFor(member)).get(url)).body.review).toBeUndefined();
    expect((await (await agentFor()).get(url)).body.review).toBeUndefined();
  });

  it('shows staff roles before Member next to usernames', async () => {
    await Role.create({ name: 'Moderator', permissions: [] });
    const mod = await createUser({ roles: ['Moderator'] });
    const profile = (await (await agentFor()).get(`/api/users/${mod.username}`)).body;
    expect(profile.role).toEqual({ name: 'Moderator', kind: 'staff' });
  });
});

describe('pagination', () => {
  it('lists come in pages of 20 with a cursor for the next page', async () => {
    const { Company } = await import('../src/models/index.js');
    await Company.insertMany(
      Array.from({ length: 45 }, (_, i) => ({
        name: `Co ${String(i).padStart(2, '0')}`,
        slug: `co-${i}`,
        status: 'approved',
      })),
    );
    const g = await agentFor();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/api/companies?sort=name${cursor ? `&cursor=${cursor}` : ''}`;
      const res = (await g.get(url)).body as {
        items: { slug: string }[];
        nextCursor: string | null;
      };
      pages++;
      seen.push(...res.items.map((c) => c.slug));
      expect(res.items.length).toBeLessThanOrEqual(20);
      cursor = res.nextCursor;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(45);
    expect((await g.get('/api/companies?cursor=garbage!')).status).toBe(400);
  });
});
