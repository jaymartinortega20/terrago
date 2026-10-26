import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  WEB_ORIGINS: z.string().default('http://localhost:3000'),
  COOKIE_SECURE: z.string().optional(),
  COOKIE_DOMAIN: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TRUST_PROXY: bool(false),
  METRICS_TOKEN: z.string().optional(),
  /** Comma-separated account emails that get the admin panel. */
  ADMIN_EMAILS: z.string().default(''),
  /** Pin the weather (e.g. "clear" in tests). */
  /** "off" disables world events, or an event id forces one (testing). */
  EVENTS: z.string().optional(),
  WEATHER_OVERRIDE: z.enum(['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow']).optional(),
  MIGRATE_ON_START: bool(true),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Disables auth rate limits; only honoured outside production (load tests). */
  DISABLE_RATE_LIMITS: bool(false),
  /** PayMongo (Gem purchases). Without a key the Gem Shop can't sell Gems. */
  PAYMONGO_SECRET_KEY: z.string().optional(),
  PAYMONGO_WEBHOOK_SECRET: z.string().optional(),
  PAYMONGO_METHODS: z.string().default('gcash,paymaya,card,qrph'),
  PAYMONGO_API_URL: z.string().default('https://api.paymongo.com/v1'),
  /** Where players return after paying (defaults to the first WEB_ORIGINS entry). */
  PUBLIC_WEB_URL: z.string().optional(),
  /** Development only: a pretend checkout that credits Gems without money. */
  GEM_FAKE_PAYMENTS: bool(false),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  dbPoolMax: number;
  webOrigins: string[];
  cookieSecure: boolean;
  cookieDomain: string | undefined;
  sessionTtlMs: number;
  trustProxy: boolean;
  metricsToken: string | undefined;
  adminEmails: string[];
  events: string | undefined;
  weatherOverride: 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog' | 'snow' | undefined;
  migrateOnStart: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  rateLimitsEnabled: boolean;
  payments: {
    mode: 'live' | 'test' | 'fake' | 'off';
    secretKey: string | undefined;
    webhookSecret: string | undefined;
    methods: string[];
    apiUrl: string;
    webUrl: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const cookieSecure = e.COOKIE_SECURE === undefined ? production : ['1', 'true', 'yes'].includes(e.COOKIE_SECURE.toLowerCase());
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    dbPoolMax: e.DB_POOL_MAX,
    webOrigins: e.WEB_ORIGINS.split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
    cookieSecure,
    cookieDomain: e.COOKIE_DOMAIN || undefined,
    sessionTtlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    trustProxy: e.TRUST_PROXY,
    metricsToken: e.METRICS_TOKEN || undefined,
    weatherOverride: e.WEATHER_OVERRIDE,
    events: e.EVENTS,
    adminEmails: e.ADMIN_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    migrateOnStart: e.MIGRATE_ON_START,
    logLevel: e.LOG_LEVEL,
    rateLimitsEnabled: production || !e.DISABLE_RATE_LIMITS,
    payments: {
      mode: e.PAYMONGO_SECRET_KEY?.startsWith('sk_live_')
        ? 'live'
        : e.PAYMONGO_SECRET_KEY?.startsWith('sk_test_')
          ? 'test'
          : e.GEM_FAKE_PAYMENTS && !production
            ? 'fake'
            : 'off',
      secretKey: e.PAYMONGO_SECRET_KEY || undefined,
      webhookSecret: e.PAYMONGO_WEBHOOK_SECRET || undefined,
      methods: e.PAYMONGO_METHODS.split(',').map((s) => s.trim()).filter(Boolean),
      apiUrl: e.PAYMONGO_API_URL.replace(/\/$/, ''),
      webUrl: (e.PUBLIC_WEB_URL || e.WEB_ORIGINS.split(',')[0] || 'http://localhost:3000').trim().replace(/\/$/, ''),
    },
  };
}
