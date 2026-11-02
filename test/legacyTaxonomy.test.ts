import { describe, expect, it } from 'vitest';
import { fromLegacy, positionFromRole } from '../src/seed/legacyTaxonomy.js';

const tags = (q: Parameters<typeof fromLegacy>[0]) => {
  const { unknown: _unknown, ...t } = fromLegacy(q);
  return t;
};

describe('legacy tag mapping', () => {
  it('maps a role to field + specialization and a domain to a topic', () => {
    expect(tags({ title: 'Two Sum', domains: ['Coding'], roles: ['Backend Engineer'] })).toEqual({
      field: 'Software',
      specializations: ['Backend'],
      levels: [],
      topics: ['Problem Solving (DSA)'],
    });
  });

  it('takes the field from a job-area domain when there is no role', () => {
    expect(tags({ title: 'Listing Grid', domains: ['Coding', 'Frontend'] })).toEqual({
      field: 'Software',
      specializations: ['Frontend'],
      levels: [],
      topics: ['Problem Solving (DSA)', 'Tools & Frameworks'],
    });
  });

  it('maps Associate / General, product roles and Intern', () => {
    expect(
      tags({ title: 'Culture Fit Round', domains: ['Behavioral'], roles: ['Associate / General'] }),
    ).toMatchObject({ field: 'General', specializations: [], topics: ['Behavioral'] });
    expect(
      tags({ title: 'Cart Conversion Case', domains: ['Product'], roles: ['Product Manager'] }),
    ).toMatchObject({
      field: 'Product',
      specializations: ['Product Management'],
      topics: ['Business & Product Case'],
    });
    expect(
      tags({
        title: 'Package Pair Sums',
        domains: ['Coding'],
        roles: ['Software Engineer', 'Intern'],
      }),
    ).toMatchObject({ field: 'Software', levels: ['Intern'] });
  });

  it('reads HR and past-project questions from the title, but not technical ones', () => {
    expect(tags({ title: 'HR Screening Call', domains: ['Behavioral'] }).topics).toEqual([
      'HR & Salary',
    ]);
    expect(
      tags({ title: 'LLM Project Panel', domains: ['Machine Learning'], roles: ['ML Engineer'] }),
    ).toMatchObject({ field: 'Data', specializations: ['ML & AI'], topics: ['Past Projects'] });
    // Asked in an HR interview, but a leadership-principle story: stays Behavioral.
    expect(
      tags({ title: 'Earn Trust And Negative Feedback', domains: ['Behavioral'] }).topics,
    ).toEqual(['Behavioral']);
    expect(tags({ title: 'Projects Table Query', domains: ['SQL'] }).topics).toEqual([
      'SQL & Databases',
    ]);
  });

  it('gives a Data domain no topic of its own', () => {
    expect(
      tags({
        title: 'Reconciliation Mismatch Report',
        domains: ['SQL', 'Data'],
        roles: ['Data Engineer'],
      }),
    ).toEqual({
      field: 'Data',
      specializations: ['Data Engineering'],
      levels: [],
      topics: ['SQL & Databases'],
    });
  });

  it('keeps specializations inside the chosen field and reports unknown values', () => {
    const r = fromLegacy({
      title: 'QA Automation',
      domains: ['Product', 'CS Fundamentals', 'Astrology'],
      roles: ['QA Engineer', 'Wizard'],
    });
    // The QA role decides the field; the Product domain's hint doesn't fit and is dropped.
    expect(r).toMatchObject({ field: 'Software', specializations: ['QA & Testing'] });
    expect(r.unknown).toEqual(['role "Wizard"', 'domain "Astrology"']);
  });

  it('maps the old role on reports and reviews', () => {
    expect(positionFromRole('Backend Engineer')).toEqual({ specialization: 'Backend', level: '' });
    expect(positionFromRole('Intern')).toEqual({ specialization: '', level: 'Intern' });
    expect(positionFromRole('Software Engineer')).toEqual({ specialization: '', level: '' });
  });
});
