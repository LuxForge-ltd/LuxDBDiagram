/**
 * Sealed cookies.
 *
 * Purpose: keeps the GitHub sign-in in an encrypted, authenticated cookie, so the service holds no
 * state and needs no database. Values are sealed with AES-256-GCM under `SESSION_KEY`; each kind
 * of value (sign-in state, session) is bound to its purpose, so one cannot be replayed as another,
 * and carries its own expiry. The browser's JavaScript never sees the cookies (HttpOnly).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'luxdbdiag_github';
export const STATE_COOKIE = 'luxdbdiag_github_state';
export const COOKIE_PATH = '/api/github';

/** A GitHub sign-in, as kept in the session cookie. */
export interface GitHubSession {
    /** The Access email it belongs to (empty when Access checks are off). */
    email: string;
    login: string;
    token: string;
    /** When the token expires (ms since the epoch), or null if it does not. */
    tokenExpiresAt: number | null;
    refreshToken: string | null;
    refreshExpiresAt: number | null;
}

/** The sign-in in progress, kept between `/login` and `/callback`. */
export interface SignInState {
    state: string;
    returnTo: string;
    email: string;
}

interface Envelope {
    exp: number;
    value: unknown;
}

export const seal = (
    key: Buffer,
    purpose: string,
    value: unknown,
    expiresAt: number
): string => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(purpose, 'utf8'));
    const body = Buffer.from(
        JSON.stringify({ exp: expiresAt, value } satisfies Envelope),
        'utf8'
    );
    const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
        'base64url'
    );
};

/** Opens a sealed value, or returns null if it is not genuine, is for another purpose, or has expired. */
export const unseal = <T>(
    key: Buffer,
    purpose: string,
    sealed: string | undefined,
    now: number
): T | null => {
    if (!sealed) return null;
    try {
        const raw = Buffer.from(sealed, 'base64url');
        if (raw.length < 29) return null;
        const decipher = createDecipheriv(
            'aes-256-gcm',
            key,
            raw.subarray(0, 12)
        );
        decipher.setAAD(Buffer.from(purpose, 'utf8'));
        decipher.setAuthTag(raw.subarray(12, 28));
        const body = Buffer.concat([
            decipher.update(raw.subarray(28)),
            decipher.final(),
        ]);
        const envelope = JSON.parse(body.toString('utf8')) as Envelope;
        if (typeof envelope.exp !== 'number' || envelope.exp <= now)
            return null;
        return envelope.value as T;
    } catch {
        return null;
    }
};

export const parseCookies = (
    header: string | undefined
): Record<string, string> => {
    const cookies: Record<string, string> = {};
    if (!header) return cookies;
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index < 0) continue;
        const name = part.slice(0, index).trim();
        if (name && !(name in cookies))
            cookies[name] = part.slice(index + 1).trim();
    }
    return cookies;
};

export const cookie = (
    name: string,
    value: string,
    maxAgeSeconds: number,
    secure: boolean
): string =>
    [
        `${name}=${value}`,
        `Path=${COOKIE_PATH}`,
        `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
        'HttpOnly',
        'SameSite=Lax',
        ...(secure ? ['Secure'] : []),
    ].join('; ');

export const clearCookie = (name: string, secure: boolean): string =>
    cookie(name, '', 0, secure);
