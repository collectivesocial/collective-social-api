import { config } from '../config';

/**
 * Iron session configuration — shared across all route handlers.
 * Single source of truth for cookie name, secret, and options.
 */
export const SESSION_OPTIONS = {
  cookieName: 'sid',
  password: config.cookieSecret,
  cookieOptions: {
    secure: config.nodeEnv === 'production',
    sameSite: 'lax' as const,
    httpOnly: true,
    path: '/',
  },
} as const;

export type Session = { did?: string };
