import { config } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connection.js';
import { seedAll } from './run.js';

await connectDb(config().MONGO_URI);
const result = await seedAll();
console.log(
  `Seeded: ${result.roles} roles, ${result.companies} companies, ${result.questions} questions (import them with npm run import:questions)`,
);
await disconnectDb();
