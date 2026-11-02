import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import mongoose from 'mongoose';
import { config, isOwner } from '../config/env.js';
import { AppError, BadRequest, Forbidden, Unauthorized } from '../errors/AppError.js';
import { IpBanRepository, UserRepository } from '../repositories/index.js';
import { hashIp } from '../lib/ip.js';
import { isVpnIp } from '../lib/vpn.js';
import type { Restriction } from '../types.js';
import { AuthzService } from '../services/AuthzService.js';
import { ALL_PERMISSIONS, type Permission } from '../shared/permissions.js';

/**
 * Loads the session user (if any), resolves their permissions and any restriction:
 * a banned account or banned IP, or a known VPN/proxy IP.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const id = req.session?.userId;
  if (!id) return next();
  const user = await UserRepository.findAuthById(id);
  if (!user) {
    delete req.session.userId;
    return next();
  }
  const ipHash = hashIp(req.ip);
  if (req.session.ipHash !== ipHash) {
    await UserRepository.recordIp(user._id, ipHash);
    req.session.ipHash = ipHash;
  }

  if (isOwner(user.username)) {
    req.user = {
      _id: user._id,
      username: user.username,
      perms: new Set(ALL_PERMISSIONS),
      isFounder: true,
      restriction: null,
    };
    return next();
  }

  let restriction: Restriction | null = null;
  if (user.status === 'banned' || user.status === 'disabled') {
    restriction = {
      type: user.status,
      reason: user.ban?.reason ?? '',
      link: user.ban?.link ?? '',
      at: user.ban?.at ?? null,
      byIp: false,
      canMessage: user.ban?.canMessage !== false,
    };
  } else if (await IpBanRepository.isBanned(ipHash)) {
    restriction = {
      type: 'banned',
      reason: '',
      link: '',
      at: null,
      byIp: true,
      canMessage: true,
    };
  } else if (config().VPN_BLOCK && isVpnIp(req.ip)) {
    restriction = { type: 'vpn' };
  }

  const resolved = await AuthzService.resolve(user);
  const banned = restriction?.type === 'banned' || restriction?.type === 'disabled';
  req.user = {
    _id: user._id,
    username: user.username,
    perms: banned ? new Set() : resolved.perms,
    isFounder: banned ? false : resolved.isFounder,
    restriction,
  };
  next();
};

// What a restricted account can still reach (method + path under /api).
const BANNED_ALLOW = [
  /^GET \/(me|meta|auth\/csrf|messages(\/[a-f0-9]{24})?)$/,
  /^POST \/auth\/logout$/,
  /^PUT \/me\/preferences$/,
];
const WRITE_ALLOW = [/^POST \/auth\/logout$/, /^PUT \/me\/preferences$/];
const MESSAGE_WRITES = [/^POST \/messages(\/[a-f0-9]{24}\/reply)?$/];
const READS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Banned users see only their notice and their messages. Disabled and VPN users can
 * browse but every write is refused. Banned and disabled accounts can still send
 * messages unless that was turned off.
 */
export const enforceRestrictions: RequestHandler = (req, _res, next) => {
  const r = req.user?.restriction;
  if (!r) return next();
  const key = `${req.method} ${req.path}`;
  const allowed = (rules: RegExp[]) => rules.some((rx) => rx.test(key));
  if (r.type === 'vpn') {
    if (READS.includes(req.method) || allowed(WRITE_ALLOW)) return next();
    throw new AppError(403, 'vpn', 'Turn off your VPN or proxy to continue');
  }
  if (allowed(MESSAGE_WRITES)) {
    if (r.canMessage) return next();
    throw new AppError(403, 'messages_off', 'Messaging is turned off for this account');
  }
  if (r.type === 'banned') {
    if (allowed(BANNED_ALLOW)) return next();
    throw new AppError(403, 'banned', 'This account is banned');
  }
  if (READS.includes(req.method) || allowed(WRITE_ALLOW)) return next();
  throw new AppError(403, 'disabled', 'This account is disabled');
};

/** Signed in. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new Unauthorized();
  next();
};

/** Guard factory: the user must hold every listed permission. */
export const requirePermission =
  (...keys: Permission[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new Unauthorized();
    if (!keys.every((k) => req.user!.perms.has(k))) throw new Forbidden();
    next();
  };

/** Guard factory: the user must hold at least one of the listed permissions. */
export const requireAnyPermission =
  (...keys: Permission[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new Unauthorized();
    if (!keys.some((k) => req.user!.perms.has(k))) throw new Forbidden();
    next();
  };

export function validate<B extends ZodTypeAny, Q extends ZodTypeAny>(schemas: {
  body?: B;
  query?: Q;
}): RequestHandler {
  return (req, _res, next) => {
    req.data = {
      body: schemas.body ? schemas.body.parse(req.body ?? {}) : undefined,
      query: schemas.query ? schemas.query.parse(req.query ?? {}) : undefined,
    };
    next();
  };
}

export const body = <S extends ZodTypeAny>(req: Request, _s?: S) => req.data.body as z.infer<S>;
export const query = <S extends ZodTypeAny>(req: Request, _s?: S) => req.data.query as z.infer<S>;

const skip = () => config().isTest;
export const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => skip() || ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  keyGenerator: (req) => (req.session?.userId ? `u:${req.session.userId}` : `ip:${req.ip}`),
  handler: (_req, res) =>
    res.status(429).json({
      error: { code: 'rate_limited', message: 'Slow down a little and try again shortly' },
    }),
});
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  handler: (_req, res) =>
    res
      .status(429)
      .json({ error: { code: 'rate_limited', message: 'Too many attempts, try again later' } }),
});

export const messageLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => `m:${req.session?.userId ?? req.ip}`,
  handler: (_req, res) =>
    res
      .status(429)
      .json({ error: { code: 'rate_limited', message: 'Too many messages, try again later' } }),
});

/** Double-submit CSRF: a readable cookie whose value must be echoed in a header on writes. */
export const CSRF_COOKIE = 'mk_csrf';
export const csrf: RequestHandler = (req, res, next) => {
  let token = req.cookies?.[CSRF_COOKIE] as string | undefined;
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    res.cookie(CSRF_COOKIE, token, {
      sameSite: config().COOKIE_SAMESITE,
      secure: config().isProd || config().COOKIE_SAMESITE === 'none',
      httpOnly: false,
      path: '/',
    });
  }
  res.locals.csrfToken = token;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const header = req.get('x-csrf-token');
  if (
    !header ||
    header.length !== token.length ||
    !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(token))
  ) {
    throw new AppError(403, 'csrf', 'Invalid CSRF token, refresh the page and try again');
  }
  next();
};

const IDENTITY_KEYS = new Set(['passwordHash', 'ipHashes']);
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!IDENTITY_KEYS.has(k)) out[k] = scrub(v);
    return out;
  }
  return value;
}

/**
 * Defense in depth: strips the password hash from every JSON response, even if a
 * serializer is ever written carelessly.
 */
export const anonymityGuard: RequestHandler = (_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (data: unknown) => json(scrub(data));
  next();
};
/** Admin data about users is never cached anywhere. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

/** Public GETs: short shared cache for guests, revalidate for signed-in viewers. ETag comes from Express. */
export const cacheHeaders: RequestHandler = (req, res, next) => {
  const personal = /^\/(me|auth|admin)(\/|$)/.test(req.path);
  if (req.method === 'GET' && !personal) {
    res.set('Vary', 'Cookie');
    res.set(
      'Cache-Control',
      req.user ? 'private, no-cache' : 'public, max-age=15, stale-while-revalidate=60',
    );
  } else {
    res.set('Cache-Control', 'no-store');
  }
  next();
};

export const notFound: RequestHandler = () => {
  throw new AppError(404, 'not_found', 'Route not found');
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const e = new BadRequest('Some fields are invalid', err.flatten());
    return res
      .status(400)
      .json({ error: { code: e.code, message: e.message, details: e.details } });
  }
  if (err instanceof AppError) {
    return res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
  }
  if ((err as { code?: number }).code === 11000) {
    // Never echo the duplicate key: it could contain an email.
    return res.status(409).json({ error: { code: 'conflict', message: 'Already exists' } });
  }
  if ((err as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'too_large', message: 'Request too large' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
}
