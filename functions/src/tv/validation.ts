import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const APPS = ['cartonLleno', 'novaStar'] as const;
export type AppId = typeof APPS[number];
export const BODY_LIMIT = 1024;

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

export function isApp(value: unknown): value is AppId {
  return value === 'cartonLleno' || value === 'novaStar';
}

function objectBody(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'invalid_body');
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowedKeys.includes(key))) {
    throw new ApiError(400, 'invalid_body');
  }
  return body;
}

export function creationApp(body: unknown): AppId {
  const { app } = objectBody(body, ['app']);
  if (!isApp(app)) throw new ApiError(400, 'invalid_app');
  return app;
}

// Malformed or missing codes count as attempts after authenticating and checking access.
export function approvalCode(body: unknown): string | null {
  const { code } = objectBody(body, ['code']);
  return typeof code === 'string' && /^\d{6}$/.test(code) ? code : null;
}

export function pairingId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{48}$/.test(value)) {
    throw new ApiError(400, 'invalid_pairing_id');
  }
  return value;
}

export function bearerToken(header: string | undefined): string {
  const match = header?.match(/^Bearer ([^\s]{1,8192})$/i);
  if (!match) throw new ApiError(401, 'authentication_required');
  return match[1];
}

export function pollToken(header: string | undefined): string {
  const match = header?.match(/^Pairing ([A-Za-z0-9_-]{43})$/i);
  if (!match) throw new ApiError(401, 'invalid_poll_token');
  return match[1];
}

export function hashPollToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashCode(secret: string, id: string, app: AppId, code: string): string {
  return createHmac('sha256', secret).update(`${id}:${app}:${code}`).digest('hex');
}

export function equalHash(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

export function portalOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('NEXO_PORTAL_URL must be an HTTPS origin');
  }
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('NEXO_PORTAL_URL must be an HTTPS origin');
  }
  return url.origin;
}
