/**
 * Import scraped questions from `data/companies/<company>/*.json` (made by mokabla_scraper.py).
 *
 *   npm run import:questions                          # every company folder, merge
 *   npm run import:questions -- --company noon        # one company (repeatable)
 *   npm run import:questions -- --company noon --replace
 *   npm run import:questions -- --dir /path/to/companies
 *
 * merge (default): upsert by title slug; questions not in the folder stay.
 * --replace: delete the company's questions (and their answers, confirmations,
 *            bookmarks, study progress) first, then insert only what's in the folder.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Types } from 'mongoose';
import { config } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connection.js';
import { renderMarkdown } from '../lib/markdown.js';
import { slugify } from '../lib/text.js';
import {
  Answer,
  AskedReport,
  Bookmark,
  Company,
  Question,
  StudyList,
  StudyProgress,
} from '../models/index.js';
import { CompanyService } from '../services/CompanyService.js';
import { DIFFICULTIES, STAGES } from '../shared/constants.js';
import { fromLegacy } from './legacyTaxonomy.js';

type SectionValue = string | string[];

interface ScrapedQuestion {
  title: string;
  company?: string;
  url?: string;
  // mokabla's own tags; fromLegacy() maps them to field · specializations · levels · topics.
  domains?: string[];
  stage?: string | null;
  difficulty?: string | null;
  role?: string | null;
  roles?: string[];
  last_asked?: string | null;
  asked_count?: number | null;
  scraped_at?: string;
  sections?: Record<string, SectionValue>;
}

const LOOK_FOR = /^what they look for$/i;
const FOLLOW_UPS = /^(likely )?follow[- ]?ups?$/i;
const CONSTRAINTS = /^constraints$/i;

const DAY = 24 * 60 * 60 * 1000;
const UNIT_DAYS: Record<string, number> = {
  minute: 1 / 1440,
  hour: 1 / 24,
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

/** "6 months ago" relative to `base` -> Date; null when there is no date ("—"). */
function parseRelative(text: string | null | undefined, base: Date): Date | null {
  const t = (text ?? '').toLowerCase().trim();
  if (/today|just now/.test(t)) return base;
  if (/yesterday/.test(t)) return new Date(base.getTime() - DAY);
  const m = t.match(/(\d+|an?|one)\s+(minute|hour|day|week|month|year)s?/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : 1;
  return new Date(base.getTime() - n * UNIT_DAYS[m[2]!]! * DAY);
}

const asText = (v: SectionValue) => (Array.isArray(v) ? v.map((i) => `- ${i}`).join('\n') : v);
const asList = (v: SectionValue) =>
  Array.isArray(v)
    ? v
    : v
        .split('\n')
        .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
        .filter(Boolean);

/** Scraped JSON -> fields of the Question model. */
export function toQuestion(q: ScrapedQuestion, base: Date) {
  const problemParts: string[] = [];
  let constraints: string[] = [];
  let lookFor = '';
  let followUps: string[] = [];

  for (const [heading, value] of Object.entries(q.sections ?? {})) {
    if (LOOK_FOR.test(heading)) lookFor = asText(value);
    else if (FOLLOW_UPS.test(heading)) followUps = asList(value);
    else if (CONSTRAINTS.test(heading) && Array.isArray(value)) constraints = value;
    // First section is the main prompt; the rest keep their heading.
    else problemParts.push(problemParts.length ? `### ${heading}\n\n${asText(value)}` : asText(value));
  }
  const problem = problemParts.join('\n\n').trim() || q.title;

  const warnings: string[] = [];
  const { unknown, ...tags } = fromLegacy({
    title: q.title,
    domains: q.domains ?? [],
    roles: q.roles ?? (q.role ? [q.role] : []),
  });
  for (const u of unknown) warnings.push(`unknown ${u}`);
  let stage = q.stage ?? '';
  if (!(STAGES as readonly string[]).includes(stage)) {
    warnings.push(`unknown stage "${stage}" -> Technical Interview`);
    stage = 'Technical Interview';
  }
  let difficulty = q.difficulty ?? '';
  if (!(DIFFICULTIES as readonly string[]).includes(difficulty)) {
    warnings.push(`unknown difficulty "${difficulty}" -> Medium`);
    difficulty = 'Medium';
  }
  let lastAskedAt = parseRelative(q.last_asked, base);
  if (!lastAskedAt) {
    warnings.push(`no last-asked date ("${q.last_asked ?? ''}") -> 3 years ago`);
    lastAskedAt = new Date(base.getTime() - 3 * 365 * DAY);
  }

  return {
    doc: {
      title: q.title.trim(),
      ...tags,
      stage,
      difficulty: difficulty as (typeof DIFFICULTIES)[number],
      problem,
      problemHtml: renderMarkdown(problem),
      examples: [],
      constraints,
      lookFor,
      lookForHtml: lookFor ? renderMarkdown(lookFor) : '',
      followUps,
    },
    timesAsked: Math.max(1, q.asked_count ?? 1),
    lastAskedAt,
    warnings,
  };
}

/** Delete a company's questions and everything that points at them. */
async function wipeCompany(companyId: Types.ObjectId) {
  const ids = (await Question.find({ companyId }).select('_id').lean()).map((q) => q._id);
  if (!ids.length) return 0;
  await Promise.all([
    Answer.deleteMany({ questionId: { $in: ids } }),
    AskedReport.deleteMany({ questionId: { $in: ids } }),
    Bookmark.deleteMany({ questionId: { $in: ids } }),
    StudyProgress.deleteMany({ questionId: { $in: ids } }),
    StudyList.updateMany({}, { $pull: { questionIds: { $in: ids } } }),
  ]);
  await Question.deleteMany({ _id: { $in: ids } });
  return ids.length;
}

async function importCompany(dir: string, folder: string, replace: boolean) {
  const slug = slugify(folder);
  let company = await Company.findOne({ slug });
  if (!company) {
    company = await Company.create({ name: folder, slug, status: 'approved' });
    console.log(`  created company "${folder}"`);
  }

  const companyDir = path.join(dir, folder);
  const files = (await readdir(companyDir)).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) {
    console.log(`  no .json files, skipped`);
    return;
  }

  const removed = replace ? await wipeCompany(company._id) : 0;
  const used = new Set<string>();
  let added = 0;
  let updated = 0;

  for (const file of files) {
    const full = path.join(companyDir, file);
    const raw = JSON.parse(await readFile(full, 'utf8')) as ScrapedQuestion;
    if (!raw.title) {
      console.warn(`  ! ${file}: no title, skipped`);
      continue;
    }
    const base = raw.scraped_at ? new Date(raw.scraped_at) : (await stat(full)).mtime;
    const { doc, timesAsked, lastAskedAt, warnings } = toQuestion(raw, base);
    for (const w of warnings) console.warn(`  ! ${file}: ${w}`);

    let qSlug = slugify(doc.title);
    for (let n = 2; used.has(qSlug); n++) qSlug = `${slugify(doc.title)}-${n}`;
    used.add(qSlug);

    const res = await Question.updateOne(
      { companyId: company._id, slug: qSlug },
      {
        $set: { ...doc, status: 'approved' },
        // Never lower what site users already confirmed.
        $max: { timesAsked, lastAskedAt },
        $setOnInsert: { publishedAt: new Date(lastAskedAt.getTime() - 20 * DAY) },
      },
      { upsert: true },
    );
    if (res.upsertedCount) added++;
    else updated++;
  }

  await CompanyService.refreshCounters(company._id);
  console.log(
    `  ${replace ? `removed ${removed}, ` : ''}added ${added}, updated ${updated} (${files.length} files)`,
  );
}

function parseArgs(argv: string[]) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const opts = {
    dir: path.resolve(here, '../../data/companies'),
    companies: [] as string[],
    replace: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--replace') opts.replace = true;
    else if (a === '--dir') opts.dir = path.resolve(argv[++i]!);
    else if (a === '--company') opts.companies.push(argv[++i]!);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const folders = opts.companies.length
  ? opts.companies
  : (await readdir(opts.dir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

console.log(`Importing from ${opts.dir} (${opts.replace ? 'replace' : 'merge'})`);
await connectDb(config().MONGO_URI);
try {
  for (const folder of folders) {
    console.log(`- ${folder}`);
    await importCompany(opts.dir, folder, opts.replace);
  }
} finally {
  await disconnectDb();
}
