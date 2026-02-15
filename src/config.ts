import dotenv from 'dotenv';

dotenv.config();

function requireSecureSecret(name: string): string {
  const value = process.env[name];
  const insecureDefaults = [
    '',
    'default',
    'super-secret',
    'secret',
    'changeme',
  ];
  if (!value || insecureDefaults.includes(value.toLowerCase())) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `Environment variable ${name} must be set to a secure value in production`
      );
    }
    console.warn(
      `⚠️  WARNING: ${name} is using an insecure default. Set a proper secret before deploying.`
    );
    return value || 'dev-only-insecure-default-change-me';
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV || 'development';

export const config = {
  logLevel: process.env.LOG_LEVEL || 'info',
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  databaseUrl:
    process.env.DATABASE_URL ||
    (nodeEnv === 'production'
      ? (() => {
          throw new Error('DATABASE_URL must be set in production');
        })()
      : 'postgresql://postgres:postgres@localhost:5432/collective_social_db'),
  serviceUrl: process.env.SERVICE_URL || undefined, // undefined for local dev (loopback mode)
  clientUrl:
    process.env.CLIENT_URL ||
    (nodeEnv === 'production'
      ? process.env.SERVICE_URL
      : 'http://127.0.0.1:5173'),
  plcUrl: process.env.PLC_URL || 'https://plc.directory',
  privateKeys: process.env.PRIVATE_KEYS
    ? JSON.parse(process.env.PRIVATE_KEYS)
    : [],
  pdsUrl: process.env.PDS_URL || 'https://bsky.social',
  firehoseUrl:
    process.env.FIREHOSE_URL ||
    'wss://bsky.social/xrpc/com.atproto.sync.firehose',
  cookieSecret: requireSecureSecret('COOKIE_SECRET'),
  omdbApiKey: process.env.OMDB_API_KEY || '',
  openLibraryUserAgent:
    process.env.OPENLIBRARY_USER_AGENT ||
    'CollectiveSocial.app/1.0 (contact@collectivesocial.app)',
  openSocialApiUrl: process.env.OPENSOCIAL_API_URL || 'http://127.0.0.1:3001',
  openSocialApiKey: process.env.OPENSOCIAL_API_KEY || '',
  corsOrigin: process.env.CORS_ORIGIN, // e.g. https://app.collectivesocial.app
} as const;
