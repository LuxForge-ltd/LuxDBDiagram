// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { AccessError, createAccessVerifier } from '../src/access.ts';
import {
    AUDIENCE,
    TEAM_DOMAIN,
    accessPayload,
    createAccessKeys,
} from './access-keys.ts';

describe('Cloudflare Access check', () => {
    const now = 1_800_000_000_000;
    let keys: Awaited<ReturnType<typeof createAccessKeys>>;
    const verifier = () =>
        createAccessVerifier({
            teamDomain: TEAM_DOMAIN,
            audience: AUDIENCE,
            fetch: keys.certsFetch,
            now: () => now,
        });

    beforeAll(async () => {
        keys = await createAccessKeys();
    });

    it('accepts a token from the team for this application and returns the email', async () => {
        const token = await keys.sign(
            accessPayload(now, { email: 'Ben@Example.com' })
        );
        await expect(verifier().verify(token)).resolves.toEqual({
            email: 'ben@example.com',
        });
    });

    it.each([
        ['another application', { aud: ['other'] }],
        ['another team', { iss: 'https://other.cloudflareaccess.com' }],
        ['an expired token', { exp: Math.floor(now / 1000) - 3600 }],
        ['a token not valid yet', { nbf: Math.floor(now / 1000) + 3600 }],
        ['a service token with no email', { email: undefined }],
    ])('refuses %s', async (_label, overrides) => {
        const token = await keys.sign(accessPayload(now, overrides));
        await expect(verifier().verify(token)).rejects.toBeInstanceOf(
            AccessError
        );
    });

    it('refuses a missing header, a changed payload, another algorithm and an unknown key', async () => {
        const check = verifier();
        await expect(check.verify(undefined)).rejects.toBeInstanceOf(
            AccessError
        );
        await expect(check.verify('a.b')).rejects.toBeInstanceOf(AccessError);

        const token = await keys.sign(accessPayload(now));
        const [header, , signature] = token.split('.');
        const forged = Buffer.from(
            JSON.stringify(accessPayload(now, { email: 'mallory@example.com' }))
        ).toString('base64url');
        await expect(
            check.verify(`${header}.${forged}.${signature}`)
        ).rejects.toThrow('signature');

        const none = await keys.sign(accessPayload(now), {
            alg: 'none',
            kid: keys.kid,
        });
        await expect(check.verify(none)).rejects.toThrow(
            'unexpected signature'
        );

        const unknown = await keys.sign(accessPayload(now), {
            alg: 'RS256',
            kid: 'other-key',
        });
        await expect(check.verify(unknown)).rejects.toThrow('unknown key');
    });
});
