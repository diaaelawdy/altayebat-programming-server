import type { Request, Response } from 'express';
import { strategies, type AuthStrategy } from '../auth/strategies.js';
import { AuthService } from '../services/AuthService.js';
import { NotificationService } from '../services/NotificationService.js';
import { MessageService } from '../services/MessageService.js';
import { UserRepository, displayRoleResolver } from '../repositories/index.js';
import { monthOf } from '../serializers/index.js';
import { hashIp } from '../lib/ip.js';
import { body } from '../middleware/index.js';
import { preferencesSchema } from '../shared/schemas.js';
import { ALL_PERMISSIONS } from '../shared/permissions.js';

/** Regenerates the session id on login (prevents session fixation). */
async function startSession(req: Request, userId: string): Promise<void> {
  // Record the sign-in IP (hashed) right away, so an IP ban covers it.
  const ipHash = hashIp(req.ip);
  await UserRepository.recordIp(userId, ipHash);
  return new Promise((resolve, reject) =>
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.ipHash = ipHash;
      req.session.save((e) => (e ? reject(e) : resolve()));
    }),
  );
}

const loginWith =
  (strategy: AuthStrategy, status: number) => async (req: Request, res: Response) => {
    const user = await strategy.authenticate(req);
    await startSession(req, String(user._id));
    res.status(status).json({ ok: true });
  };

export const authController = {
  csrf: (_req: Request, res: Response) => res.json({ token: res.locals.csrfToken }),

  login: loginWith(strategies.login, 200),
  register: loginWith(strategies.register, 201),

  logout(req: Request, res: Response) {
    req.session.destroy(() => {
      res.clearCookie('mk.sid');
      res.json({ ok: true });
    });
  },

  async checkUsername(req: Request, res: Response) {
    const u = String(req.query.u ?? '')
      .trim()
      .toLowerCase();
    res.json(await AuthService.checkUsername(u));
  },

  /** The signed-in user's own view. */
  async me(req: Request, res: Response) {
    if (!req.user) return res.json({ user: null });
    const [u, unread, unreadMessages, roleOf] = await Promise.all([
      UserRepository.findById(req.user._id),
      NotificationService.unreadCount(req.user._id),
      MessageService.unreadCount(req.user),
      displayRoleResolver(),
    ]);
    if (!u) return res.json({ user: null });
    const perms = req.user.isFounder ? ALL_PERMISSIONS : [...req.user.perms];
    res.json({
      user: {
        id: String(u._id),
        username: u.username ?? null,
        reputation: u.reputation ?? 0,
        role: roleOf(u.roleIds ?? []),
        avatar: u.avatar ?? null,
        restriction: req.user.restriction,
        badges: (u.badges ?? []).map((b) => ({ key: b.key, awardedAt: monthOf(b.awardedAt) })),
        streak: {
          current: u.streak?.current ?? 0,
          longest: u.streak?.longest ?? 0,
          lastDay: u.streak?.lastDay ?? null,
        },
        stats: u.stats,
        preferences: u.preferences,
        permissions: perms,
        isFounder: req.user.isFounder,
        unreadNotifications: unread,
        unreadMessages,
        joinedAt: monthOf(u.createdAt),
      },
    });
  },

  async setPreferences(req: Request, res: Response) {
    const prefs = body(req, preferencesSchema);
    const u = await UserRepository.setPreferences(req.user!._id, prefs);
    res.json({ preferences: u?.preferences });
  },
};
