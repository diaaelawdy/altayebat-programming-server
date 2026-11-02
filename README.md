# Mokabla API

Express + TypeScript + MongoDB (Mongoose) API for **Mokabla**, a free, anonymous, community-driven bank of interview questions.

This project is self-contained. The client lives in a separate repository (`client/`) and only talks to this API over HTTP.

## Requirements

- Node.js 20+
- MongoDB 6+ running locally, or a connection string (e.g. Atlas)

## Setup

```bash
npm install
cp .env.example .env      # then fill in the values below
npm run seed              # roles and companies (safe to re-run)
npm run import:questions  # questions from data/companies/<company>/*.json
npm run dev               # http://localhost:4100
```

| Script                                                  | What it does                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev`                                           | Start with reload (tsx watch)                                           |
| `npm run seed`                                          | Upsert the system roles and the companies                               |
| `npm run import:questions -- [--company noon] [--replace]` | Import `data/companies/<company>/*.json`; merge by default, `--replace` wipes the company's questions first |
| `npm run migrate:taxonomy -- [--dry-run]`               | One-off: move stored questions from the old `domains`/`roles` tags to field, specializations, levels and topics |
| `npm run founder -- <username>`                         | Make an existing account Founder (replaces its role)                    |
| `npm test`                                              | Integration and unit tests (Vitest + Supertest + mongodb-memory-server) |
| `npm run build` / `npm start`                           | Compile to `dist/` and run it                                           |
| `npm run lint` / `npm run typecheck` / `npm run format` | Code quality                                                            |

### Environment variables

| Variable           | Description                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `PORT`             | API port (default `4100`)                                                                                    |
| `CLIENT_URL`       | Client origin, used for CORS and post-login redirects                                                        |
| `SERVER_URL`       | Public URL of this API (shown in the startup log)                                                            |
| `MONGO_URI`        | MongoDB connection string                                                                                    |
| `SESSION_SECRET`   | Long random string (`openssl rand -hex 32`); required in production                                          |
| `FOUNDER_USERNAME` | This username becomes **Founder** when it registers. Every other sign-up is a plain Member.                  |
| `VPN_BLOCK`        | `true` (default): signed-in users on known VPN/proxy IPs can browse but not post                             |
| `VPN_LIST_URL`     | CIDR list of VPN/datacenter IPv4 ranges (default: X4BNet lists_vpn), refreshed daily and cached in `.cache/` |
| `IP_HASH_SECRET`   | Key for hashing IPs (defaults to `SESSION_SECRET`)                                                           |
| `COOKIE_SAMESITE`  | `lax` (default) when the client and API share a site; `none` when they are on different sites (needs HTTPS)  |

### Accounts

There is no email and no third-party login. Users register with an anonymous **avatar** (an icon on a color; changeable later), a **username** (3–20 characters: letters, numbers, `_` or `-`; it must not start with a number; stored lowercase) and a **password** (at least 6 characters, hashed with argon2id). Registering signs you in immediately. Because there is no email, there is no password reset: users should keep their password safe.

### Moderation and safety

- **Four-eyes review**: nobody approves or rejects their own question or company while another active reviewer exists. Every new company goes through review.
- **Bans** need a written reason (a link to the offending content is optional). A banned user can still sign in, but only sees the ban notice and can message the team. Every IP the account used is banned too: sign-ups from those IPs are refused and other accounts signing in from them are restricted. IPs are stored only as keyed hashes (last 20 per account).
- **VPN / proxy**: signed-in users on a known VPN or datacenter IP can browse but every write returns `403 vpn`. Guests are unaffected.
- **Profanity screen** (Arabic and English, `src/lib/profanity.ts`) on questions, answers, feedback, reviews and messages. Obscene words are refused (`422 profanity_blocked`). Everyday insults return `422 profanity_warning` until the author resends with `acknowledgeProfanity: true`; the post is then saved and auto-reported for reviewers.
- **Reports** cover answers, feedback, reviews, questions, messages and users; the reason is optional.

### Messages

- Anyone signed in (including banned users) can write to the team. Every holder of `messages.team_inbox` (Founders by default) sees it. Replies go out as the site by default, or signed with the author's name and role. The team sees which member answered; the sender doesn't.
- `messages.send_any` starts a direct conversation with any user; the sender shows with their role. Both sides can keep replying.

### Tests

Tests start an in-memory MongoDB through `mongodb-memory-server`, which downloads a `mongod` binary on first run. To use an installed one instead:

```bash
MONGOMS_SYSTEM_BINARY=$(which mongod) npm test
# or point at any running server:
TEST_MONGO_URI=mongodb://127.0.0.1:27017/mokabla_test npm test
```

The suite covers:

- **Auth**: registration rules, case-insensitive uniqueness, reserved names, the first account becoming Founder, and a generic login error.
- **Anonymity**: crawls every public, self-service and moderator endpoint as a guest, a member and the Founder, and asserts no password hash or identity field appears anywhere.
- **RBAC**: Members get 403 on review, role and user endpoints. Role changes apply without re-login. The Founder role is protected. Bans apply immediately. CSRF is enforced.
- **Moderation**, the **"asked this too"** confirmations, **threads** (nesting, counters, XSS sanitisation), **ratings**, **voting** (toggle/switch, self-vote, concurrency, sort order, cursor pagination) and **study & gamification**.

## Architecture

```
routes → (rateLimit → authenticate → csrf) → requirePermission → validate(zod) → controller → service → repository → model
```

| Layer        | Folder             | Notes                                                                                              |
| ------------ | ------------------ | -------------------------------------------------------------------------------------------------- |
| Routes       | `src/routes`       | One table of every endpoint and its guard chain                                                    |
| Middleware   | `src/middleware`   | Auth, permission guards, Zod validation, rate limits, CSRF, cache headers, anonymity guard, errors |
| Controllers  | `src/controllers`  | Thin: parse input, call a service, send the DTO                                                    |
| Services     | `src/services`     | Business rules (moderation, voting, RBAC, ratings, gamification)                                   |
| Repositories | `src/repositories` | The only code that touches Mongoose models                                                         |
| Models       | `src/models`       | Schemas and a compound index for every list query                                                  |
| Serializers  | `src/serializers`  | Whitelisted DTOs: the only shapes that leave the server                                            |
| Events       | `src/events`       | Domain event bus and its handlers                                                                  |

### Design patterns, and why

- **Repository**: services never import models. This keeps queries in one place, where `.lean()`, projections and indexes are easy to audit.
- **Strategy**:
  - Authentication: `LoginStrategy` and `RegisterStrategy` implement `AuthStrategy` (`src/auth/strategies.ts`).
  - Sorting: thread sort strategies (`top` / `newest`) are keyset field + sort spec pairs (`THREAD_SORT_STRATEGIES`).
- **Chain of Responsibility**: the Express middleware pipeline shown above. Each link can stop the request (401/403/400/429).
- **Factory**:
  - Guards: `requirePermission(...keys)` / `requireAnyPermission(...)`.
  - DTOs: `defineSerializer()` builds them.
  - Threads: `createThreadRepository()` and `createThreadService()` build both answer threads and company feedback from one implementation.
- **Observer**: `events.emit('answer.created', …)` and similar. Handlers update counters, reputation, badges, streaks and notifications without coupling services to each other. `emit` awaits all handlers, so data is consistent when the response is sent.
- **DTO / Serializer**: every response is built from an explicit whitelist. `passwordHash` is `select: false` in the schema, and as defence in depth a response guard strips it from every JSON body.
- **Singleton**: `config()` (validated once with Zod) and `connectDb()`.

### Anonymity by design

- An account is a username and a password hash. There is no email, no real name and no third-party login.
- There are no photos: avatars are generated from the username. Public timestamps on reviews and profiles are rounded to the month.
- Every post, question and company shows its author's username and display role (Founder, then a staff role, then Member).
- Public profiles list approved questions, answers, company feedback and added companies; never reviews or "asked" reports, which together could reveal where someone interviewed.
- Notifications store usernames and slugs only.

### Performance

- Every list is paginated, 20 per page by default, as `{ items, nextCursor }`. Keyset cursors where the sort allows it (questions, threads, reviews, notifications), offset cursors elsewhere (companies, profiles, queues, reports, messages, users). Pass `cursor` and optionally `limit`.
- Authors and the viewer's votes, bookmarks and studied flags are batch-loaded per page (no N+1). A whole reply tree loads in one query by `rootId`.
- Markdown is rendered and sanitised once, at write time (`bodyHtml`).
- gzip/brotli compression and ETags on all JSON. Public GETs get `Cache-Control: public, max-age=15, stale-while-revalidate=60` for guests and `private, no-cache` for signed-in users. `/me`, `/auth/*` and `/admin/*` are never cached.

### Security

Helmet, strict CORS, httpOnly session cookies stored in Mongo (`connect-mongo`), session ID regeneration on login, double-submit CSRF tokens, argon2id password hashing, rate limits on writes and auth, Zod validation on every input, and sanitised markdown (no raw HTML, no `javascript:` links).

## Permission keys

Every user has exactly **one role**. Founder implicitly holds **every** permission, including ones added later, and cannot be edited or deleted. New sign-ups get **Member**. A new role starts with Member's permissions, so promoting someone never takes away what they could already do (unless you switch those off).

| Key                        | Unlocks in the UI                                        | Member |
| -------------------------- | -------------------------------------------------------- | :----: |
| `questions.create`         | Contribute page; "I was asked this too" button           |   ✓    |
| `questions.review`         | Review queue (approve / edit / reject)                   |        |
| `questions.edit_any`       | Edit any published question (API)                        |        |
| `questions.delete_any`     | Delete any question (API)                                |        |
| `answers.create`           | Answer composer, replies, "Post as answer" in the editor |   ✓    |
| `answers.vote`             | Up/down votes on answers, feedback and reviews           |   ✓    |
| `answers.delete_any`       | Delete button on any answer; delete from Reports         |        |
| `comments.create`          | Company feedback composer and replies                    |   ✓    |
| `comments.delete_any`      | Delete button on any feedback comment                    |        |
| `ratings.create`           | "Rate this company"                                      |   ✓    |
| `ratings.delete_any`       | Delete button on any review                              |        |
| `reports.review`           | Reports page                                             |        |
| `moderation.view_reviewer` | "Reviewed by" on questions and companies                 |        |
| `companies.submit`         | "Suggest a company" (published after review)             |   ✓    |
| `companies.review`         | Company suggestions queue (approve / reject)             |        |
| `companies.create`         | Add a company that is published immediately              |        |
| `companies.edit`           | Companies admin → Edit                                   |        |
| `companies.delete`         | Companies admin → Delete                                 |        |
| `users.view_private`       | Users page with every account's contribution details     |        |
| `users.ban`                | Ban / unban on the role assignment page                  |        |
| `users.assign_roles`       | Role assignment page (find a user by username)           |        |
| `roles.manage`             | Roles & permissions matrix                               |        |

Users without a permission never see the related button or link. Its route renders a 404, and the API returns 403.

## API overview

All routes are under `/api`. See `src/routes/index.ts` for the full table with guards.

- **Auth**: `GET /auth/csrf`, `POST /auth/register`, `POST /auth/login`, `GET /auth/username/check`, `POST /auth/logout`, `GET /me`
- **Profiles**: `GET /users/:username` (header + counts), `GET /users/:username/questions|answers|feedback|companies` (paged)
- **Browse**: `GET /companies`, `/companies/:slug`, `/companies/:slug/questions`, `/companies/:slug/questions/:qslug`, `/questions/search|recent|daily`, `/questions/:id/related`
- **Discuss**: `GET|POST /questions/:id/answers`, `GET|POST /companies/:slug/comments`, `PATCH|DELETE /answers/:id`, `PATCH|DELETE /comments/:id`, `PUT /votes`, `POST /reports`
- **Rate**: `GET /companies/:slug/reviews`, `PUT /companies/:slug/reviews/mine`, `DELETE /reviews/:id`
- **Study**: `PUT|DELETE /questions/:id/bookmark`, `PUT|DELETE /questions/:id/studied`, `/me/bookmarks|progress|activity|lists|notifications`
- **Companies**: `POST /companies` (suggest; published directly with `companies.create`), `GET /me/companies`, `/admin/company-review` (+ `/:id/approve|reject`)
- **Admin**: `/admin/review`, `/admin/reports`, `/admin/roles`, `/admin/users`, `/admin/user-lookup`, `/admin/companies`
