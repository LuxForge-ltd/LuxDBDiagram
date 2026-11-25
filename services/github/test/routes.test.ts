// @vitest-environment node
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccessError } from '../src/access.ts';
import type { ServiceConfig } from '../src/config.ts';
import { gitBlobSha } from '../src/github.ts';
import { createHandler, safeReturnPath } from '../src/routes.ts';
import { REPO, createFakeGitHub, type FakeGitHub } from './fake-github.ts';

const PUBLIC_URL = 'https://luxdbdiagram.example.com';
const FOLDER = 'docs/architecture/schema';

const baseConfig = (): ServiceConfig => ({
    port: 0,
    publicUrl: PUBLIC_URL,
    github: {
        clientId: 'Iv1.test',
        clientSecret: 'client-secret',
        appSlug: 'luxdbdiag-test',
    },
    sessionKey: randomBytes(32),
    access: {
        teamDomain: 'luxforge-test.cloudflareaccess.com',
        audience: 'aud',
    },
    accessDisabled: false,
    branchPrefix: 'luxdbdiag/',
    problems: [],
});

/** Stands in for Cloudflare Access: the header names the person. */
const accessVerifier = {
    verify: async (token: string | undefined | null) => {
        if (token === 'ben' || token === 'eve')
            return { email: `${token}@example.com` };
        throw new AccessError(
            'The request did not come through Cloudflare Access.'
        );
    },
};

describe('GitHub service routes', () => {
    let server: Server;
    let base: string;
    let github: FakeGitHub;
    let now: number;

    const start = async (config: ServiceConfig) => {
        const handler = createHandler({
            config,
            fetch: github.fetch,
            now: () => now,
            accessVerifier,
            log: () => {},
        });
        server = createServer((req, res) => {
            void handler(req, res);
        });
        await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve)
        );
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };

    const call = (
        path: string,
        options: {
            as?: string;
            cookie?: string;
            method?: string;
            body?: unknown;
            headers?: Record<string, string>;
        } = {}
    ) =>
        fetch(`${base}/api/github/${path}`, {
            method: options.method ?? 'GET',
            redirect: 'manual',
            headers: {
                ...(options.as === undefined
                    ? { 'cf-access-jwt-assertion': 'ben' }
                    : options.as
                      ? { 'cf-access-jwt-assertion': options.as }
                      : {}),
                ...(options.cookie ? { cookie: options.cookie } : {}),
                ...(options.body !== undefined
                    ? { 'content-type': 'application/json', 'x-luxdbdiag': '1' }
                    : {}),
                ...options.headers,
            },
            body:
                options.body === undefined
                    ? undefined
                    : JSON.stringify(options.body),
        });

    const cookieFrom = (response: Response, name: string): string | null => {
        const line = response.headers
            .getSetCookie()
            .find((value) => value.startsWith(`${name}=`));
        return line ? line.split(';')[0] : null;
    };

    /** Signs in through /login and /callback; returns the session cookie. */
    const signIn = async (as = 'ben'): Promise<string> => {
        const login = await call('login?return=/diagrams/abc', { as });
        expect(login.status).toBe(302);
        const location = new URL(login.headers.get('location')!);
        expect(location.origin + location.pathname).toBe(
            'https://github.com/login/oauth/authorize'
        );
        expect(location.searchParams.get('client_id')).toBe('Iv1.test');
        expect(location.searchParams.get('redirect_uri')).toBe(
            `${PUBLIC_URL}/api/github/callback`
        );
        const state = location.searchParams.get('state')!;
        const stateCookie = cookieFrom(login, 'luxdbdiag_github_state')!;

        github.issueCode('the-code', `token-${as}`, `refresh-${as}`);
        const callback = await call(`callback?code=the-code&state=${state}`, {
            as,
            cookie: stateCookie,
        });
        expect(callback.status).toBe(302);
        expect(callback.headers.get('location')).toBe('/diagrams/abc');
        return cookieFrom(callback, 'luxdbdiag_github')!;
    };

    beforeEach(async () => {
        now = 1_800_000_000_000;
        github = createFakeGitHub({
            [`${FOLDER}/users.dbml`]: 'Table users { id int }\n',
            [`${FOLDER}/teams.dbml`]: 'Table teams { id int }\n',
        });
        await start(baseConfig());
    });

    afterEach(async () => {
        await new Promise((resolve) => server.close(resolve));
    });

    it('answers health without Access, and nothing else without it', async () => {
        expect((await call('health', { as: '' })).status).toBe(200);
        const status = await call('status', { as: '' });
        expect(status.status).toBe(403);
        expect(await status.json()).toMatchObject({ code: 'access_denied' });
    });

    it('reports its set-up and sign-in state', async () => {
        const response = await call('status');
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({
            configured: true,
            missing: [],
            signedIn: false,
            login: null,
            installUrl:
                'https://github.com/apps/luxdbdiag-test/installations/new',
            branchPrefix: 'luxdbdiag/',
        });
    });

    it('signs in with GitHub and keeps the sign-in in a sealed, HttpOnly cookie', async () => {
        const session = await signIn();
        const status = await (await call('status', { cookie: session })).json();
        expect(status).toMatchObject({ signedIn: true, login: 'tester' });
        expect(session).not.toContain('token-ben');
    });

    it('refuses a callback whose state does not match, or that arrives for another person', async () => {
        const login = await call('login');
        const stateCookie = cookieFrom(login, 'luxdbdiag_github_state')!;
        const state = new URL(login.headers.get('location')!).searchParams.get(
            'state'
        )!;
        expect(
            (await call('callback?code=x&state=wrong', { cookie: stateCookie }))
                .status
        ).toBe(400);
        expect(
            (
                await call(`callback?code=x&state=${state}`, {
                    as: 'eve',
                    cookie: stateCookie,
                })
            ).status
        ).toBe(400);
        expect((await call(`callback?code=x&state=${state}`)).status).toBe(400);
    });

    it('does not let another Access user use the sign-in cookie', async () => {
        const session = await signIn('ben');
        const status = (await (
            await call('status', { as: 'eve', cookie: session })
        ).json()) as { signedIn: boolean };
        expect(status.signedIn).toBe(false);
        expect(
            (await call('repos', { as: 'eve', cookie: session })).status
        ).toBe(401);
    });

    it('renews an expired GitHub token with the refresh token', async () => {
        const session = await signIn();
        now += 9 * 60 * 60 * 1000;
        github.revokeToken('token-ben');
        const response = await call('repos', { cookie: session });
        expect(response.status).toBe(200);
        expect(cookieFrom(response, 'luxdbdiag_github')).not.toBeNull();
        expect(
            github.calls.filter((line) =>
                line.endsWith('/login/oauth/access_token')
            )
        ).toHaveLength(2);
    });

    it('lists repositories and branches, and reads a folder', async () => {
        const session = await signIn();
        const repos = (await (
            await call('repos', { cookie: session })
        ).json()) as { repositories: { fullName: string }[] };
        expect(
            repos.repositories.map(
                (repo: { fullName: string }) => repo.fullName
            )
        ).toEqual([REPO]);
        const branches = await (
            await call(`branches?repo=${REPO}`, { cookie: session })
        ).json();
        expect(branches).toEqual({
            defaultBranch: 'main',
            branches: ['Dev', 'main'],
        });
        const folder = (await (
            await call(`files?repo=${REPO}&branch=Dev&folder=${FOLDER}`, {
                cookie: session,
            })
        ).json()) as { files: { path: string }[] };
        expect(folder.files.map((file: { path: string }) => file.path)).toEqual(
            ['teams.dbml', 'users.dbml']
        );
        expect(
            (
                await call(`files?repo=${REPO}&branch=Dev&folder=../x`, {
                    cookie: session,
                })
            ).status
        ).toBe(400);
    });

    it('commits to a working branch and opens a pull request', async () => {
        const session = await signIn();
        const commit = await call('commit', {
            cookie: session,
            method: 'POST',
            body: {
                repo: REPO,
                folder: FOLDER,
                baseBranch: 'Dev',
                branch: 'luxdbdiag/gap',
                message: 'Add email to users',
                files: [
                    {
                        path: 'users.dbml',
                        content: 'Table users { id int\n email text }\n',
                        expectedSha: gitBlobSha('Table users { id int }\n'),
                    },
                ],
            },
            headers: { origin: PUBLIC_URL },
        });
        expect(commit.status).toBe(200);
        expect(await commit.json()).toMatchObject({
            kind: 'committed',
            createdBranch: true,
        });
        expect(
            github.branchFiles('luxdbdiag/gap')[`${FOLDER}/users.dbml`]
        ).toContain('email text');

        const pull = await call('pull-request', {
            cookie: session,
            method: 'POST',
            body: {
                repo: REPO,
                branch: 'luxdbdiag/gap',
                base: 'Dev',
                title: 'Schema changes from LuxDBDiag',
            },
        });
        expect(await pull.json()).toEqual({
            url: `https://github.com/${REPO}/pull/1`,
            number: 1,
            existing: false,
        });
    });

    it('answers 409 with the files that changed on GitHub', async () => {
        const session = await signIn();
        github.pushToBranch('Dev', {
            [`${FOLDER}/users.dbml`]: 'Table users { id bigint }\n',
        });
        const response = await call('commit', {
            cookie: session,
            method: 'POST',
            body: {
                repo: REPO,
                folder: FOLDER,
                baseBranch: 'Dev',
                branch: 'luxdbdiag/gap',
                message: 'm',
                files: [
                    {
                        path: 'users.dbml',
                        content: 'Table users { id uuid }\n',
                        expectedSha: gitBlobSha('Table users { id int }\n'),
                    },
                ],
            },
        });
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
            code: 'conflict',
            reason: 'files_changed',
            conflicts: [{ path: 'users.dbml' }],
        });
    });

    it('refuses writes outside working branches and DBML files, and cross-site requests', async () => {
        const session = await signIn();
        const commit = (
            body: Record<string, unknown>,
            headers: Record<string, string> = {}
        ) =>
            call('commit', {
                cookie: session,
                method: 'POST',
                headers,
                body: {
                    repo: REPO,
                    folder: FOLDER,
                    baseBranch: 'Dev',
                    branch: 'luxdbdiag/gap',
                    message: 'm',
                    files: [
                        { path: 'users.dbml', content: 'x', expectedSha: null },
                    ],
                    ...body,
                },
            });
        expect((await commit({ branch: 'Dev' })).status).toBe(403);
        expect((await commit({ branch: 'main' })).status).toBe(403);
        expect(
            (
                await commit({
                    files: [
                        {
                            path: '../.github/workflows/x.yml',
                            content: 'x',
                            expectedSha: null,
                        },
                    ],
                })
            ).status
        ).toBe(400);
        expect(
            (
                await commit({
                    files: [
                        { path: 'users.sql', content: 'x', expectedSha: null },
                    ],
                })
            ).status
        ).toBe(400);
        expect(
            (await commit({}, { origin: 'https://evil.example.com' })).status
        ).toBe(403);
        expect((await commit({}, { 'x-luxdbdiag': '0' })).status).toBe(403);
        expect(
            (
                await call('pull-request', {
                    cookie: session,
                    method: 'POST',
                    body: {
                        repo: REPO,
                        branch: 'Dev',
                        base: 'main',
                        title: 't',
                    },
                })
            ).status
        ).toBe(403);
        expect(github.refs.has('luxdbdiag/gap')).toBe(false);
    });

    it('needs a sign-in for GitHub routes, and forgets it on logout', async () => {
        expect((await call('repos')).status).toBe(401);
        const session = await signIn();
        const logout = await call('logout', {
            cookie: session,
            method: 'POST',
            body: {},
        });
        expect(logout.status).toBe(204);
        expect(cookieFrom(logout, 'luxdbdiag_github')).toBe(
            'luxdbdiag_github='
        );
    });

    it('starts without GitHub settings and says what is missing', async () => {
        await new Promise((resolve) => server.close(resolve));
        await start({
            ...baseConfig(),
            github: null,
            problems: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
        });
        expect(await (await call('status')).json()).toMatchObject({
            configured: false,
            missing: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
        });
        expect((await call('login')).status).toBe(503);
    });

    it('returns only to paths inside the app after signing in', () => {
        expect(safeReturnPath('/diagrams/abc?x=1')).toBe('/diagrams/abc?x=1');
        for (const bad of [
            'https://evil.example.com',
            '//evil.example.com',
            '/\\evil.example.com',
            'diagrams',
            null,
        ]) {
            expect(safeReturnPath(bad)).toBe('/');
        }
    });
});
