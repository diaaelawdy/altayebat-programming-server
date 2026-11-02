import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { config } from './config/env.js';
import {
  anonymityGuard,
  authenticate,
  cacheHeaders,
  csrf,
  enforceRestrictions,
  errorHandler,
  notFound,
  writeLimiter,
} from './middleware/index.js';
import { registerEventHandlers } from './events/handlers.js';
import { apiRouter } from './routes/index.js';

/** Builds the Express app. Requires an open mongoose connection (sessions live in Mongo). */
export function createApp() {
  const c = config();
  registerEventHandlers();

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: c.CLIENT_URL, credentials: true }));
  app.use(compression());
  if (!c.isTest) app.use(morgan(c.isProd ? 'combined' : 'dev'));
  // Bulk question uploads (up to BULK_MAX_QUESTIONS) get a larger body limit.
  const smallJson = express.json({ limit: '200kb' });
  const bulkJson = express.json({ limit: '1mb' });
  app.use((req, res, next) =>
    (req.path.endsWith('/questions/bulk') ? bulkJson : smallJson)(req, res, next),
  );
  app.use(cookieParser());
  app.use(
    session({
      name: 'mk.sid',
      secret: c.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: MongoStore.create({
        // mongoose bundles its own driver copy; the runtime client is compatible.
        client: mongoose.connection.getClient() as never,
        collectionName: 'sessions',
        ttl: 60 * 60 * 24 * 30,
        touchAfter: 60 * 60,
      }),
      cookie: {
        httpOnly: true,
        secure: c.isProd || c.COOKIE_SAMESITE === 'none',
        sameSite: c.COOKIE_SAMESITE,
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    }),
  );

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(
    '/api',
    anonymityGuard,
    writeLimiter,
    authenticate,
    csrf,
    enforceRestrictions,
    cacheHeaders,
    apiRouter(),
  );
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
