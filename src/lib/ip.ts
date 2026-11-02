import crypto from 'node:crypto';
import { config } from '../config/env.js';

/** `::ffff:1.2.3.4` → `1.2.3.4`. */
export const normalizeIp = (ip: string | undefined) => (ip ?? '').replace(/^::ffff:/, '');

/** Keyed hash, so a database leak never reveals anyone's IP. */
export function hashIp(ip: string | undefined) {
  const c = config();
  return crypto
    .createHmac('sha256', c.IP_HASH_SECRET || c.SESSION_SECRET)
    .update(normalizeIp(ip))
    .digest('base64url');
}
