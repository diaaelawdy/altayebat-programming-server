import type { Types } from 'mongoose';
import type { Permission } from './shared/permissions.js';

export type Restriction =
  | {
      type: 'banned' | 'disabled';
      reason: string;
      link: string;
      at: Date | null;
      byIp: boolean;
      canMessage: boolean;
    }
  | { type: 'vpn' };

declare global {
  namespace Express {
    interface User {
      _id: Types.ObjectId;
      username: string;
      perms: Set<Permission>;
      isFounder: boolean;
      /** Banned (only the ban screen and messages), disabled (read-only) or on a VPN (read-only). */
      restriction: Restriction | null;
    }
    interface Request {
      /** Set by `authenticate` when a session exists. */
      user?: User;
      /** Zod-parsed input from `validate()`. */
      data: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    /** Hash of the last IP seen for this session, so it is recorded once per change. */
    ipHash?: string;
  }
}

export {};
