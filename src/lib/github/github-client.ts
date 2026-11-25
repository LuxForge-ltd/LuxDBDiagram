/**
 * Client for the LuxDBDiag GitHub service (LuxDBDiagram).
 *
 * Purpose: the app's calls to `/api/github/` (see `services/github/`): status, sign-in, listing
 * repositories and branches, reading a folder's DBML files, committing changed files to a working
 * branch and opening the pull request.
 * Scope: the service holds the GitHub token in an HttpOnly cookie, so nothing here sees a token.
 * Writes send `X-LuxDBDiag: 1`, which the service requires.
 * Operational role: shown only when `GITHUB_REPOS` is on (the server's `/config.js`).
 */
import { GITHUB_REPOS } from '@/lib/env';

export const GITHUB_API = '/api/github/';

export const isGitHubAvailable = (): boolean => GITHUB_REPOS;

export interface GitHubStatus {
    configured: boolean;
    missing: string[];
    signedIn: boolean;
    login: string | null;
    installUrl: string | null;
    /** Working branches start with this (`luxdbdiag/`). */
    branchPrefix: string;
}

export interface GitHubRepository {
    fullName: string;
    defaultBranch: string;
    private: boolean;
    canPush: boolean;
}

export interface GitHubBranches {
    defaultBranch: string;
    branches: string[];
}

export interface GitHubFolderFile {
    /** Path relative to the folder. */
    path: string;
    sha: string;
    content: string;
}

export interface GitHubFolder {
    repo: string;
    branch: string;
    folder: string;
    commit: string;
    files: GitHubFolderFile[];
}

export interface GitHubCommitFile {
    path: string;
    content: string;
    /** The file's SHA when it was read, or null for a new file. */
    expectedSha: string | null;
}

export interface GitHubCommitRequest {
    repo: string;
    folder: string;
    baseBranch: string;
    branch: string;
    message: string;
    files: GitHubCommitFile[];
}

export interface GitHubConflict {
    path: string;
    expectedSha: string | null;
    actualSha: string | null;
}

export type GitHubCommitResult =
    | {
          kind: 'committed' | 'unchanged';
          branch: string;
          commit: string;
          createdBranch: boolean;
          files: { path: string; sha: string }[];
      }
    | {
          kind: 'conflict';
          reason: 'files_changed' | 'branch_moved';
          conflicts: GitHubConflict[];
      };

export interface GitHubPullRequest {
    url: string;
    number: number;
    existing: boolean;
}

export class GitHubServiceError extends Error {
    status: number;
    code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

type Fetch = typeof fetch;

export const createGitHubClient = (
    fetchImpl: Fetch = (...args) => fetch(...args)
) => {
    const call = async <T>(
        path: string,
        options: { method?: 'GET' | 'POST'; body?: unknown } = {}
    ): Promise<{ status: number; data: T }> => {
        const response = await fetchImpl(`${GITHUB_API}${path}`, {
            method: options.method ?? 'GET',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                ...(options.method === 'POST'
                    ? {
                          'Content-Type': 'application/json',
                          'X-LuxDBDiag': '1',
                      }
                    : {}),
            },
            body:
                options.body === undefined
                    ? undefined
                    : JSON.stringify(options.body),
        });
        if (response.status === 204) {
            return { status: 204, data: undefined as T };
        }
        const type = response.headers.get('content-type') ?? '';
        if (!type.includes('application/json')) {
            throw new GitHubServiceError(
                response.status,
                'unavailable',
                'The GitHub service is not available on this server.'
            );
        }
        const data = (await response.json()) as T & {
            code?: string;
            error?: string;
        };
        if (
            !response.ok &&
            !(response.status === 409 && data.code === 'conflict')
        ) {
            throw new GitHubServiceError(
                response.status,
                data.code ?? 'error',
                data.error ?? `The GitHub service answered ${response.status}.`
            );
        }
        return { status: response.status, data };
    };

    const query = (params: Record<string, string>) =>
        new URLSearchParams(params).toString();

    return {
        status: async () => (await call<GitHubStatus>('status')).data,
        repositories: async () =>
            (await call<{ repositories: GitHubRepository[] }>('repos')).data
                .repositories,
        branches: async (repo: string) =>
            (await call<GitHubBranches>(`branches?${query({ repo })}`)).data,
        folder: async (repo: string, branch: string, folder: string) =>
            (
                await call<GitHubFolder>(
                    `files?${query({ repo, branch, folder })}`
                )
            ).data,
        commit: async (request: GitHubCommitRequest) =>
            (
                await call<GitHubCommitResult>('commit', {
                    method: 'POST',
                    body: request,
                })
            ).data,
        pullRequest: async (request: {
            repo: string;
            branch: string;
            base: string;
            title: string;
            body: string;
        }) =>
            (
                await call<GitHubPullRequest>('pull-request', {
                    method: 'POST',
                    body: request,
                })
            ).data,
        signOut: async () => {
            await call<void>('logout', { method: 'POST', body: {} });
        },
    };
};

export type GitHubClient = ReturnType<typeof createGitHubClient>;

export const githubClient = createGitHubClient();

/** The address that starts the GitHub sign-in and ends on the service's "signed in" page. */
export const signInUrl = (): string =>
    `${GITHUB_API}login?${new URLSearchParams({ return: `${GITHUB_API}signed-in` }).toString()}`;

/**
 * Opens the GitHub sign-in in its own window and waits until the service reports a sign-in, the
 * user gives up (`signal`), or ten minutes pass.
 *
 * The window cannot always be watched (GitHub's pages may cut its link to the app), so the
 * service's status is checked every two seconds, and the "signed in" page also announces itself
 * on a BroadcastChannel.
 *
 * @returns True once signed in.
 */
export const signInWithGitHub = (
    client: GitHubClient,
    signal?: AbortSignal
): Promise<boolean> =>
    new Promise((resolve) => {
        const popup = window.open(
            signInUrl(),
            'luxdbdiag-github-sign-in',
            'popup,width=720,height=780'
        );
        if (!popup) {
            // Pop-ups blocked: sign in in this tab and come back here.
            window.location.assign(
                `${GITHUB_API}login?${new URLSearchParams({ return: window.location.pathname }).toString()}`
            );
            resolve(false);
            return;
        }

        let finished = false;
        const channel =
            typeof BroadcastChannel === 'undefined'
                ? null
                : new BroadcastChannel('luxdbdiag-github');
        const finish = (signedIn: boolean) => {
            if (finished) return;
            finished = true;
            window.clearInterval(timer);
            window.clearTimeout(timeout);
            channel?.close();
            signal?.removeEventListener('abort', abort);
            resolve(signedIn);
        };
        const check = async () => {
            try {
                if ((await client.status()).signedIn) finish(true);
            } catch {
                // keep waiting
            }
        };
        const abort = () => finish(false);
        if (channel) {
            channel.onmessage = (event) => {
                if (event.data === 'signed-in') void check();
            };
        }
        const timer = window.setInterval(() => void check(), 2000);
        const timeout = window.setTimeout(() => finish(false), 10 * 60 * 1000);
        signal?.addEventListener('abort', abort);
    });
