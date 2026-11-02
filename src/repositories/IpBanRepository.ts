import { Types } from 'mongoose';
import { IpBan } from '../models/index.js';

type Id = Types.ObjectId | string;

// IP-ban lookups run on every signed-in request: cache answers briefly.
const cache = new Map<string, { banned: boolean; until: number }>();
const TTL = 30_000;

export const IpBanRepository = {
  async isBanned(hash: string) {
    const hit = cache.get(hash);
    if (hit && hit.until > Date.now()) return hit.banned;
    const banned = Boolean(await IpBan.exists({ hash }));
    cache.set(hash, { banned, until: Date.now() + TTL });
    if (cache.size > 50_000) cache.clear();
    return banned;
  },
  async banAll(hashes: string[], userId: Id) {
    if (!hashes.length) return;
    await IpBan.bulkWrite(
      hashes.map((hash) => ({
        updateOne: {
          filter: { hash },
          update: { $setOnInsert: { hash, userId: new Types.ObjectId(String(userId)) } },
          upsert: true,
        },
      })),
    );
    for (const h of hashes) cache.delete(h);
  },
  async unbanUser(userId: Id) {
    const rows = await IpBan.find({ userId }).select('hash').lean();
    await IpBan.deleteMany({ userId });
    for (const r of rows) cache.delete(r.hash);
  },
  clearCache: () => cache.clear(),
};
