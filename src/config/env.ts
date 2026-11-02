import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4100),
  CLIENT_URL: z.string().url().default('http://localhost:5180'),
  SERVER_URL: z.string().url().default('http://localhost:4100'),
  MONGO_URI: z.string().default('mongodb://127.0.0.1:27017/mokabla'),
  SESSION_SECRET: z.string().min(16).default('test-secret-change-me-please'),
  // This username becomes Founder when it registers; everyone else signs up as Member.
  FOUNDER_USERNAME: z.string().optional().default(''),
  // The owner: always Founder, and can never be banned, disabled, demoted or VPN-blocked.
  OWNER_USERNAME: z.string().optional().default(''),
  // 'lax' when client and API share a site (recommended); 'none' for cross-site deployments (requires HTTPS).
  COOKIE_SAMESITE: z.enum(['lax', 'none']).default('lax'),
  // Signed-in users on a known VPN/proxy/datacenter IP can browse but not post.
  VPN_BLOCK: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  VPN_LIST_URL: z
    .string()
    .url()
    .default('https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt'),
  // Key for hashing IPs (bans match hashes; raw IPs are never stored). Defaults to SESSION_SECRET.
  IP_HASH_SECRET: z.string().optional().default(''),
});

export type Config = z.infer<typeof schema> & {
  isProd: boolean;
  isTest: boolean;
};

let instance: Config | null = null;

/** Singleton: parsed once, validated at boot. */
export function config(): Config {
  if (instance) return instance;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production' && c.SESSION_SECRET === 'test-secret-change-me-please') {
    console.error('SESSION_SECRET must be set in production');
    process.exit(1);
  }
  instance = {
    ...c,
    isProd: c.NODE_ENV === 'production',
    isTest: c.NODE_ENV === 'test',
  };
  return instance;
}

/** Whether this username is the protected owner account (OWNER_USERNAME). */
export function isOwner(username: string | null | undefined) {
  const owner = config().OWNER_USERNAME.trim().toLowerCase();
  return Boolean(owner && username?.toLowerCase() === owner);
}
