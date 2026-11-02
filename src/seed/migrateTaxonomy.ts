/**
 * One-off: move stored data from the old tags to the new ones.
 *   - questions: `domains` + `roles` → `field` · `specializations` · `levels` · `topics`
 *   - "I was asked this" reports and company reviews: `role` → `specialization` + `level`
 *
 *   npm run migrate:taxonomy -- --dry-run   # print what would change, write nothing
 *   npm run migrate:taxonomy
 *
 * Safe to re-run: documents already on the new tags are skipped.
 */
import type { Types } from 'mongoose';
import { config } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connection.js';
import { AskedReport, CompanyReview, Question } from '../models/index.js';
import { fromLegacy, positionFromRole } from './legacyTaxonomy.js';

const dryRun = process.argv.includes('--dry-run');

interface LegacyQuestionDoc {
  _id: Types.ObjectId;
  title: string;
  domains?: string[];
  roles?: string[];
}

const show = (values: readonly string[]) => (values.length ? values.join(' / ') : '–');

async function migrateQuestions() {
  // Raw collection: the model no longer knows `domains` / `roles`.
  const docs = await Question.collection
    .find<LegacyQuestionDoc>(
      { field: { $exists: false } },
      { projection: { title: 1, domains: 1, roles: 1 } },
    )
    .sort({ title: 1 })
    .toArray();
  const unknown = new Set<string>();
  for (const q of docs) {
    const { unknown: u, ...tags } = fromLegacy(q);
    u.forEach((x) => unknown.add(x));
    console.log(
      `  ${q.title.padEnd(42).slice(0, 42)} ${tags.field} · ${show(tags.specializations)} · ` +
        `${show(tags.levels)} · ${show(tags.topics)}`,
    );
    if (!dryRun)
      await Question.collection.updateOne(
        { _id: q._id },
        { $set: tags, $unset: { domains: '', roles: '' } },
      );
  }
  console.log(`questions: ${docs.length} ${dryRun ? 'to migrate' : 'migrated'}`);
  if (unknown.size) console.warn(`  ! unrecognised old values: ${[...unknown].join(', ')}`);
}

async function migrateRoles(name: string, collection: typeof AskedReport.collection) {
  const docs = await collection
    .find<{ _id: Types.ObjectId; role: string }>(
      { role: { $exists: true } },
      { projection: { role: 1 } },
    )
    .toArray();
  for (const d of docs)
    if (!dryRun)
      await collection.updateOne(
        { _id: d._id },
        { $set: positionFromRole(d.role), $unset: { role: '' } },
      );
  console.log(`${name}: ${docs.length} ${dryRun ? 'to migrate' : 'migrated'}`);
}

console.log(`Migrating tags${dryRun ? ' (dry run, nothing is written)' : ''}`);
await connectDb(config().MONGO_URI);
try {
  await migrateQuestions();
  await migrateRoles('asked reports', AskedReport.collection);
  await migrateRoles('company reviews', CompanyReview.collection);
} finally {
  await disconnectDb();
}
