import { afterAll, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.FOUNDER_USERNAME = '';
process.env.OWNER_USERNAME = 'the_owner';

let mongo: MongoMemoryServer | null = null;

beforeAll(async () => {
  // TEST_MONGO_URI lets CI point at a real server; otherwise spin up an in-memory one.
  let uri = process.env.TEST_MONGO_URI;
  if (!uri) {
    mongo = await MongoMemoryServer.create();
    uri = mongo.getUri('mokabla_test');
  }
  await mongoose.connect(uri);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
});

beforeEach(async () => {
  const { AuthzService } = await import('../src/services/AuthzService.js');
  AuthzService.clearCache();
  const { IpBanRepository } = await import('../src/repositories/index.js');
  IpBanRepository.clearCache();
  const { setVpnRanges } = await import('../src/lib/vpn.js');
  setVpnRanges('');
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  const { seedRoles } = await import('../src/seed/run.js');
  await seedRoles();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
