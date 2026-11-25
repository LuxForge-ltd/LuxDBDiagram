/**
 * Signing keys and tokens shaped like Cloudflare Access's, for the service's tests.
 */
import type { webcrypto } from 'node:crypto';

export const TEAM_DOMAIN = 'luxforge-test.cloudflareaccess.com';
export const AUDIENCE = 'test-audience-tag';

export const createAccessKeys = async () => {
    const pair = (await crypto.subtle.generateKey(
        {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['sign', 'verify']
    )) as webcrypto.CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const kid = 'test-key-1';

    const sign = async (
        payload: Record<string, unknown>,
        header: Record<string, unknown> = { alg: 'RS256', kid, typ: 'JWT' }
    ): Promise<string> => {
        const encode = (value: unknown) =>
            Buffer.from(JSON.stringify(value)).toString('base64url');
        const data = `${encode(header)}.${encode(payload)}`;
        const signature = await crypto.subtle.sign(
            'RSASSA-PKCS1-v1_5',
            pair.privateKey,
            Buffer.from(data)
        );
        return `${data}.${Buffer.from(signature).toString('base64url')}`;
    };

    const certsFetch = (async () =>
        new Response(
            JSON.stringify({ keys: [{ ...jwk, kid, alg: 'RS256' }] }),
            {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }
        )) as unknown as typeof fetch;

    return { sign, certsFetch, kid };
};

export const accessPayload = (
    now: number,
    overrides: Record<string, unknown> = {}
) => ({
    aud: [AUDIENCE],
    iss: `https://${TEAM_DOMAIN}`,
    email: 'ben@example.com',
    iat: Math.floor(now / 1000) - 10,
    exp: Math.floor(now / 1000) + 3600,
    ...overrides,
});
