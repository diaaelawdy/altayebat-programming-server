/** Grants the Founder role to an existing account: `npm run founder -- <username>`. */
import { config } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connection.js';
import { RoleRepository, UserRepository } from '../repositories/index.js';

const username = process.argv[2]?.trim().toLowerCase();
if (!username) {
  console.error('Usage: npm run founder -- <username>');
  process.exit(1);
}

await connectDb(config().MONGO_URI);
const [user, founder] = await Promise.all([
  UserRepository.findByUsername(username),
  RoleRepository.findFounder(),
]);
if (!founder) console.error('Roles not seeded. Run `npm run seed` first.');
else if (!user) console.error(`No account named "${username}".`);
else {
  await UserRepository.setRoles(user._id, [founder._id]);
  console.log(`@${username} is now Founder.`);
}
await disconnectDb();
