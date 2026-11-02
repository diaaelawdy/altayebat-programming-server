import argon2 from 'argon2';
import { config } from '../config/env.js';
import { IpBanRepository, RoleRepository, UserRepository } from '../repositories/index.js';
import { AppError, Conflict, Unauthorized } from '../errors/AppError.js';
import { USERNAME_RE, isAvatar, randomAvatar } from '../shared/constants.js';
import { hashIp } from '../lib/ip.js';
import { isVpnIp } from '../lib/vpn.js';

const RESERVED = new Set([
  'admin',
  'founder',
  'moderator',
  'mokabla',
  'support',
  'system',
  'deleted',
  'anonymous',
  'me',
  'root',
]);

async function initialRoles(username: string) {
  const [member, founder] = await Promise.all([
    RoleRepository.findDefault(),
    RoleRepository.findFounder(),
  ]);
  if (!member || !founder) throw new Error('Roles not seeded. Run `npm run seed`.');
  // Everyone signs up as Member; only FOUNDER_USERNAME (if set) is made Founder.
  const founderName = config().FOUNDER_USERNAME.trim().toLowerCase();
  return founderName && founderName === username ? [founder._id] : [member._id];
}

export const AuthService = {
  async checkUsername(raw: string) {
    const username = raw.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) return { available: false, reason: 'format' as const };
    if (RESERVED.has(username)) return { available: false, reason: 'reserved' as const };
    if (await UserRepository.usernameTaken(username))
      return { available: false, reason: 'taken' as const };
    return { available: true as const };
  },

  async register(raw: string, password: string, opts: { avatar?: string; ip?: string } = {}) {
    const username = raw.trim().toLowerCase();
    const ipHash = hashIp(opts.ip);
    if (await IpBanRepository.isBanned(ipHash))
      throw new AppError(403, 'banned', 'Sign-ups from this network are blocked');
    if (config().VPN_BLOCK && isVpnIp(opts.ip))
      throw new AppError(403, 'vpn', 'Turn off your VPN or proxy to create an account');
    const check = await this.checkUsername(username);
    if (!check.available)
      throw new Conflict(check.reason === 'format' ? 'Invalid username' : 'Username is taken');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    try {
      return await UserRepository.create({
        username,
        passwordHash,
        roleIds: await initialRoles(username),
        avatar: opts.avatar && isAvatar(opts.avatar) ? opts.avatar : randomAvatar(),
        ipHashes: [ipHash],
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new Conflict('Username is taken');
      throw e;
    }
  },

  async login(raw: string, password: string) {
    const user = await UserRepository.findByUsernameWithPassword(raw.trim().toLowerCase());
    // Same error for unknown user / wrong password, to avoid account enumeration.
    const ok = user?.passwordHash ? await argon2.verify(user.passwordHash, password) : false;
    if (!user || !ok) throw new Unauthorized('Wrong username or password');
    // Banned users can still sign in: they only see their ban notice and can message the team.
    return user;
  },
};
