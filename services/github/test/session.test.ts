// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.ts';
import { cookie, parseCookies, seal, unseal } from '../src/session.ts';

describe('sealed values', () => {
    const key = randomBytes(32);
    const now = 1_800_000_000_000;

    it('opens what it sealed, until it expires', () => {
        const sealed = seal(key, 'session', { login: 'tester' }, now + 1000);
        expect(unseal(key, 'session', sealed, now)).toEqual({
            login: 'tester',
        });
        expect(unseal(key, 'session', sealed, now + 1000)).toBeNull();
    });

    it('refuses another purpose, another key or a changed value', () => {
        const sealed = seal(key, 'session', { login: 'tester' }, now + 1000);
        expect(unseal(key, 'sign-in', sealed, now)).toBeNull();
        expect(unseal(randomBytes(32), 'session', sealed, now)).toBeNull();
        const raw = Buffer.from(sealed, 'base64url');
        raw[raw.length - 1] ^= 1;
        expect(
            unseal(key, 'session', raw.toString('base64url'), now)
        ).toBeNull();
        expect(unseal(key, 'session', 'not-a-sealed-value', now)).toBeNull();
        expect(unseal(key, 'session', undefined, now)).toBeNull();
    });
});

describe('cookies', () => {
    it('parses a Cookie header, keeping the first of duplicate names', () => {
        expect(parseCookies('a=1; b=two=2; a=3')).toEqual({
            a: '1',
            b: 'two=2',
        });
        expect(parseCookies(undefined)).toEqual({});
    });

    it('writes HttpOnly, SameSite=Lax cookies scoped to the service', () => {
        expect(cookie('x', 'v', 60, true)).toBe(
            'x=v; Path=/api/github; Max-Age=60; HttpOnly; SameSite=Lax; Secure'
        );
    });
});

describe('configuration', () => {
    const complete = {
        PUBLIC_URL: 'https://luxdbdiagram.example.com/',
        GITHUB_CLIENT_ID: 'Iv1.abc',
        GITHUB_CLIENT_SECRET: 'secret',
        SESSION_KEY: randomBytes(32).toString('base64'),
        ACCESS_TEAM_DOMAIN: 'luxforge-test.cloudflareaccess.com',
        ACCESS_AUD: 'aud',
    };

    it('reads a complete configuration', () => {
        const config = readConfig(complete);
        expect(config.problems).toEqual([]);
        expect(config.publicUrl).toBe('https://luxdbdiagram.example.com');
        expect(config.branchPrefix).toBe('luxdbdiag/');
        expect(config.access).toEqual({
            teamDomain: 'luxforge-test.cloudflareaccess.com',
            audience: 'aud',
        });
    });

    it('names what is missing without failing', () => {
        const config = readConfig({ PUBLIC_URL: 'http://example.com' });
        expect(config.problems).toEqual(
            expect.arrayContaining([
                'PUBLIC_URL',
                'GITHUB_CLIENT_ID',
                'GITHUB_CLIENT_SECRET',
                'SESSION_KEY',
                'ACCESS_TEAM_DOMAIN',
                'ACCESS_AUD',
            ])
        );
        expect(config.github).toBeNull();
        expect(config.access).toBeNull();
    });

    it('rejects a session key of the wrong length and a team domain outside Cloudflare Access', () => {
        const config = readConfig({
            ...complete,
            SESSION_KEY: 'c2hvcnQ=',
            ACCESS_TEAM_DOMAIN: 'evil.example.com',
        });
        expect(config.problems).toEqual(['SESSION_KEY', 'ACCESS_TEAM_DOMAIN']);
    });

    it('switches Access checks off only when told to', () => {
        const config = readConfig({
            ...complete,
            ACCESS_TEAM_DOMAIN: '',
            ALLOW_WITHOUT_ACCESS: 'true',
        });
        expect(config.accessDisabled).toBe(true);
        expect(config.problems).toEqual([]);
    });
});
