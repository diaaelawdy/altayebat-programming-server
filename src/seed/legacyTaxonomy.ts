/**
 * Maps the old tags (mokabla's `domains` + `roles`) onto Field · Specialization · Level · Topic.
 * Used by the importer (scraped JSON keeps the old vocabulary) and by migrateTaxonomy.ts.
 */
import type { FieldName, LEVELS, TOPICS } from '../shared/constants.js';

type Level = (typeof LEVELS)[number];
type Topic = (typeof TOPICS)[number];

interface Position {
  field: FieldName;
  specialization?: string;
}

/** Old role → field (+ specialization). `Intern` is a level and handled on its own. */
const ROLE_POSITIONS: Record<string, Position> = {
  'Software Engineer': { field: 'Software' },
  'Backend Engineer': { field: 'Software', specialization: 'Backend' },
  'Frontend Engineer': { field: 'Software', specialization: 'Frontend' },
  'Full-stack Engineer': { field: 'Software', specialization: 'Full-stack' },
  'Mobile Engineer': { field: 'Software', specialization: 'Mobile' },
  'DevOps Engineer': { field: 'Software', specialization: 'DevOps & Cloud' },
  'QA Engineer': { field: 'Software', specialization: 'QA & Testing' },
  'Security Engineer': { field: 'Software', specialization: 'Security' },
  'Data Engineer': { field: 'Data', specialization: 'Data Engineering' },
  'Data Scientist': { field: 'Data', specialization: 'Data Science' },
  'Data Analyst': { field: 'Data', specialization: 'Data Analysis' },
  'ML Engineer': { field: 'Data', specialization: 'ML & AI' },
  'Product Manager': { field: 'Product', specialization: 'Product Management' },
  'Product Designer': { field: 'Design', specialization: 'UI/UX Design' },
  'Business Analyst': { field: 'Business', specialization: 'Business Analysis' },
  Operations: { field: 'Business', specialization: 'Operations' },
  'Commercial / Operations': { field: 'Business', specialization: 'Operations' },
  'Associate / General': { field: 'General' },
};
const INTERN = 'Intern';

/**
 * Old domain → topic. Domains that named a job area (Frontend, Product…) also hint at
 * the field/specialization. `Data` gives no topic of its own: those questions are SQL ones.
 */
const DOMAIN_TAGS: Record<string, { topic?: Topic; hint?: Position }> = {
  Coding: { topic: 'Problem Solving (DSA)' },
  'System Design': { topic: 'System Design' },
  'OOP Design': { topic: 'OOP & Design Patterns' },
  SQL: { topic: 'SQL & Databases' },
  'CS Fundamentals': { topic: 'CS Fundamentals' },
  Networking: { topic: 'CS Fundamentals' },
  Security: { topic: 'CS Fundamentals' },
  Behavioral: { topic: 'Behavioral' },
  'Aptitude & IQ': { topic: 'Aptitude & IQ' },
  Product: { topic: 'Business & Product Case', hint: { field: 'Product' } },
  'Business & Ops': { topic: 'Business & Product Case', hint: { field: 'Business' } },
  'Design & UX': { topic: 'Business & Product Case', hint: { field: 'Design' } },
  Frontend: {
    topic: 'Tools & Frameworks',
    hint: { field: 'Software', specialization: 'Frontend' },
  },
  Mobile: { topic: 'Tools & Frameworks', hint: { field: 'Software', specialization: 'Mobile' } },
  DevOps: {
    topic: 'Tools & Frameworks',
    hint: { field: 'Software', specialization: 'DevOps & Cloud' },
  },
  ML: { topic: 'Tools & Frameworks', hint: { field: 'Data', specialization: 'ML & AI' } },
  'Machine Learning': {
    topic: 'Tools & Frameworks',
    hint: { field: 'Data', specialization: 'ML & AI' },
  },
  Data: { hint: { field: 'Data' } },
};

/** The two topics no old domain covered come from the title, unless it's clearly technical. */
const TITLE_TOPICS: [RegExp, Topic][] = [
  [/\b(hr|salary|compensation)\b/i, 'HR & Salary'],
  [/\bprojects?\b/i, 'Past Projects'],
];
const TECHNICAL: readonly Topic[] = [
  'Problem Solving (DSA)',
  'System Design',
  'OOP & Design Patterns',
  'SQL & Databases',
];

export interface LegacyQuestion {
  title: string;
  domains?: string[];
  roles?: string[];
}

export interface Tags {
  field: FieldName;
  specializations: string[];
  levels: Level[];
  topics: Topic[];
}

const distinct = <T>(values: T[]) => [...new Set(values)];

/** Old tags → new tags, plus the old values it didn't recognise (for import warnings). */
export function fromLegacy(q: LegacyQuestion): Tags & { unknown: string[] } {
  const roles = q.roles ?? [];
  const domains = q.domains ?? [];
  const unknown: string[] = [];

  const positions: Position[] = [];
  for (const r of roles) {
    if (r === INTERN) continue;
    const p = ROLE_POSITIONS[r];
    if (p) positions.push(p);
    else unknown.push(`role "${r}"`);
  }
  const hints: Position[] = [];
  let topics: Topic[] = [];
  for (const d of domains) {
    const tag = DOMAIN_TAGS[d];
    if (!tag) {
      unknown.push(`domain "${d}"`);
      continue;
    }
    if (tag.topic) topics.push(tag.topic);
    if (tag.hint) hints.push(tag.hint);
  }

  // The first role decides the field; without one, the first job-area domain does.
  const field = positions[0]?.field ?? hints[0]?.field ?? 'Software';
  const specializations = distinct(
    [...positions, ...hints]
      .filter((p) => p.field === field && p.specialization)
      .map((p) => p.specialization!),
  ).slice(0, 3);

  topics = distinct(topics);
  if (!topics.some((t) => TECHNICAL.includes(t))) {
    const fromTitle = TITLE_TOPICS.find(([re]) => re.test(q.title))?.[1];
    if (fromTitle) topics = [fromTitle];
  }
  if (!topics.length) topics = ['Tools & Frameworks'];

  return {
    field,
    specializations,
    levels: roles.includes(INTERN) ? ['Intern'] : [],
    topics: topics.slice(0, 3),
    unknown,
  };
}

/** The old role on an "I was asked this" report or a company review → specialization + level. */
export function positionFromRole(role: string): { specialization: string; level: string } {
  if (role === INTERN) return { specialization: '', level: INTERN };
  return { specialization: ROLE_POSITIONS[role]?.specialization ?? '', level: '' };
}
