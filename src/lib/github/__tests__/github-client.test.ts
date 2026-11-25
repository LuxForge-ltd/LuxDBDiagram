import { describe, expect, it } from 'vitest';
import { GitHubServiceError, createGitHubClient } from '../github-client';

const respond = (status: number, body: unknown, type = 'application/json') =>
    new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': type },
    });

const recorder = (answer: (url: string, init: RequestInit) => Response) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (
        input: string | URL | Request,
        init?: RequestInit
    ) => {
        const url = String(input);
        calls.push({ url, init: init ?? {} });
        return answer(url, init ?? {});
    }) as typeof fetch;
    return { calls, client: createGitHubClient(fetchImpl) };
};

describe('GitHub service client', () => {
    it('reads with plain GETs and encodes its parameters', async () => {
        const { calls, client } = recorder(() =>
            respond(200, {
                repo: 'o/r',
                branch: 'Dev',
                folder: 'a b',
                commit: 'c',
                files: [],
            })
        );
        await client.folder('o/r', 'Dev', 'a b');
        expect(calls[0].url).toBe(
            '/api/github/files?repo=o%2Fr&branch=Dev&folder=a+b'
        );
        expect(calls[0].init.method).toBe('GET');
        expect(calls[0].init.credentials).toBe('same-origin');
        expect(new Headers(calls[0].init.headers).has('X-LuxDBDiag')).toBe(
            false
        );
    });

    it('marks writes as coming from LuxDBDiag', async () => {
        const { calls, client } = recorder(() =>
            respond(200, { url: 'u', number: 1, existing: false })
        );
        await client.pullRequest({
            repo: 'o/r',
            branch: 'luxdbdiag/x',
            base: 'Dev',
            title: 't',
            body: '',
        });
        const headers = new Headers(calls[0].init.headers);
        expect(headers.get('X-LuxDBDiag')).toBe('1');
        expect(headers.get('Content-Type')).toBe('application/json');
        expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
            base: 'Dev',
        });
    });

    it('returns a commit conflict as a result, not an error', async () => {
        const conflict = {
            code: 'conflict',
            kind: 'conflict',
            reason: 'files_changed',
            conflicts: [
                { path: 'users.dbml', expectedSha: 'a', actualSha: 'b' },
            ],
        };
        const { client } = recorder(() => respond(409, conflict));
        await expect(
            client.commit({
                repo: 'o/r',
                folder: '',
                baseBranch: 'Dev',
                branch: 'luxdbdiag/x',
                message: 'm',
                files: [],
            })
        ).resolves.toMatchObject({ kind: 'conflict', reason: 'files_changed' });
    });

    it('raises the service message, and says when there is no service', async () => {
        const signedOut = recorder(() =>
            respond(401, {
                code: 'signed_out',
                error: 'Sign in to GitHub first.',
            })
        );
        await expect(signedOut.client.repositories()).rejects.toMatchObject({
            status: 401,
            code: 'signed_out',
            message: 'Sign in to GitHub first.',
        });

        const noService = recorder(() => respond(404, '<html>', 'text/html'));
        const error = await noService.client
            .status()
            .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(GitHubServiceError);
        expect((error as GitHubServiceError).code).toBe('unavailable');
    });
});
