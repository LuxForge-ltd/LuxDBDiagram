/**
 * Cloudflare Access check.
 *
 * Purpose: verifies the `Cf-Access-Jwt-Assertion` header that Cloudflare Access adds to every
 * request it lets through, so a request that reaches the service some other way is refused.
 * The token must be signed (RS256) by one of the team's current keys, be issued by the team
 * domain, name this application's audience, be in date, and carry the signed-in person's email.
 * Scope: user sessions only; Access service tokens (no email) are refused.
 */
import type { webcrypto } from 'node:crypto';

type CryptoKey = webcrypto.CryptoKey;

export interface AccessIdentity {
    email: string;
}

export class AccessError extends Error {}

interface Jwk {
    kid?: string;
    kty?: string;
    alg?: string;
    n?: string;
    e?: string;
}

interface VerifierOptions {
    teamDomain: string;
    audience: string;
    fetch?: typeof fetch;
    now?: () => number;
}

/** Keys are fetched again after this long, or sooner when a token names an unknown key. */
const KEYS_TTL_MS = 60 * 60 * 1000;
const UNKNOWN_KEY_REFETCH_MS = 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;

const decodeSegment = (segment: string): unknown => {
    try {
        return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    } catch {
        throw new AccessError('The Access token is malformed.');
    }
};

const asRecord = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AccessError('The Access token is malformed.');
    }
    return value as Record<string, unknown>;
};

export const createAccessVerifier = (options: VerifierOptions) => {
    const doFetch = options.fetch ?? fetch;
    const now = options.now ?? Date.now;
    const issuer = `https://${options.teamDomain}`;
    let keys = new Map<string, CryptoKey>();
    let fetchedAt = 0;

    const loadKeys = async (): Promise<void> => {
        const response = await doFetch(`${issuer}/cdn-cgi/access/certs`);
        if (!response.ok) {
            throw new AccessError('The Access signing keys could not be read.');
        }
        const body = asRecord(await response.json());
        const list = Array.isArray(body.keys) ? (body.keys as Jwk[]) : [];
        const next = new Map<string, CryptoKey>();
        for (const jwk of list) {
            if (!jwk.kid || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) continue;
            const key = await crypto.subtle.importKey(
                'jwk',
                { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
                { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                false,
                ['verify']
            );
            next.set(jwk.kid, key);
        }
        keys = next;
        fetchedAt = now();
    };

    const keyFor = async (kid: string): Promise<CryptoKey> => {
        const age = now() - fetchedAt;
        if (fetchedAt === 0 || age > KEYS_TTL_MS) {
            await loadKeys();
        } else if (!keys.has(kid) && age > UNKNOWN_KEY_REFETCH_MS) {
            await loadKeys();
        }
        const key = keys.get(kid);
        if (!key)
            throw new AccessError(
                'The Access token is signed by an unknown key.'
            );
        return key;
    };

    const verify = async (
        token: string | undefined | null
    ): Promise<AccessIdentity> => {
        if (!token)
            throw new AccessError(
                'The request did not come through Cloudflare Access.'
            );
        const parts = token.split('.');
        if (parts.length !== 3)
            throw new AccessError('The Access token is malformed.');
        const [headerPart, payloadPart, signaturePart] = parts;

        const header = asRecord(decodeSegment(headerPart));
        if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
            throw new AccessError(
                'The Access token uses an unexpected signature.'
            );
        }
        const key = await keyFor(header.kid);
        const valid = await crypto.subtle.verify(
            'RSASSA-PKCS1-v1_5',
            key,
            Buffer.from(signaturePart, 'base64url'),
            Buffer.from(`${headerPart}.${payloadPart}`, 'utf8')
        );
        if (!valid)
            throw new AccessError('The Access token signature is not valid.');

        const payload = asRecord(decodeSegment(payloadPart));
        const audiences = Array.isArray(payload.aud)
            ? payload.aud
            : [payload.aud];
        if (!audiences.includes(options.audience)) {
            throw new AccessError(
                'The Access token is for another application.'
            );
        }
        if (payload.iss !== issuer) {
            throw new AccessError(
                'The Access token was issued by another team.'
            );
        }
        const nowSeconds = now() / 1000;
        if (
            typeof payload.exp !== 'number' ||
            payload.exp < nowSeconds - CLOCK_SKEW_SECONDS
        ) {
            throw new AccessError('The Access token has expired.');
        }
        if (
            typeof payload.nbf === 'number' &&
            payload.nbf > nowSeconds + CLOCK_SKEW_SECONDS
        ) {
            throw new AccessError('The Access token is not valid yet.');
        }
        if (typeof payload.email !== 'string' || !payload.email.includes('@')) {
            throw new AccessError('The Access token does not name a person.');
        }
        return { email: payload.email.toLowerCase() };
    };

    return { verify };
};

export type AccessVerifier = ReturnType<typeof createAccessVerifier>;
