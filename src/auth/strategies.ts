import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AuthService } from '../services/AuthService.js';

export interface AuthResult {
  _id: Types.ObjectId;
}

/** Strategy pattern: each way of starting a session resolves a request to a user. */
export interface AuthStrategy {
  readonly name: string;
  authenticate(req: Request): Promise<AuthResult>;
}

type Credentials = { username: string; password: string };

export class LoginStrategy implements AuthStrategy {
  readonly name = 'login';
  authenticate(req: Request) {
    const { username, password } = req.data.body as Credentials;
    return AuthService.login(username, password);
  }
}

export class RegisterStrategy implements AuthStrategy {
  readonly name = 'register';
  authenticate(req: Request) {
    const { username, password, avatar } = req.data.body as Credentials & { avatar?: string };
    return AuthService.register(username, password, { avatar, ip: req.ip });
  }
}

export const strategies = { login: new LoginStrategy(), register: new RegisterStrategy() };
