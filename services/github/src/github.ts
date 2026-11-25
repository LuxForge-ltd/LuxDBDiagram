/**
 * GitHub repository operations.
 *
 * Purpose: what the app needs from a repository, done with the signed-in person's token: list the
 * repositories the App is installed on, list branches, read the DBML files of a folder, commit
 * changed files to a working branch in one commit, and open a pull request.
 * Commits never move a branch backwards: a working branch is updated only by fast-forward, and a
 * file that changed on GitHub since the app read it stops the commit (a conflict).
 */
import { createHash } from 'node:crypto';
import type { RepoName } from './paths.ts';
import { encodePath, isFolderFilePath, joinPath } from './paths.ts';

export class GitHubError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_TOTAL_BYTES = 5_000_000;

const SHA = /^[0-9a-f]{40}$/;

export interface GitHubApi {
    request: <T>(method: string, path: string, body?: unknown) => Promise<T>;
}

export const createGitHubApi = (
    token: string,
    doFetch: typeof fetch = fetch,
    apiUrl = 'https://api.github.com'
): GitHubApi => ({
    request: async <T>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<T> => {
        const response = await doFetch(`${apiUrl}${path}`, {
            method,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'LuxDBDiag',
                ...(body === undefined
                    ? {}
                    : { 'Content-Type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!response.ok) {
            let message = `GitHub answered ${response.status}`;
            try {
                const data = (await response.json()) as { message?: unknown };
                if (typeof data.message === 'string') message = data.message;
            } catch {
                // keep the status message
            }
            throw new GitHubError(response.status, message);
        }
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
    },
});

/** Reads up to ten pages of a list endpoint. */
const pages = async <T>(
    api: GitHubApi,
    path: string,
    key?: string
): Promise<T[]> => {
    const items: T[] = [];
    const separator = path.includes('?') ? '&' : '?';
    for (let page = 1; page <= 10; page++) {
        const data = await api.request<unknown>(
            'GET',
            `${path}${separator}per_page=100&page=${page}`
        );
        const list = (key ? (data as Record<string, unknown>)[key] : data) as
            | T[]
            | undefined;
        if (!Array.isArray(list)) break;
        items.push(...list);
        if (list.length < 100) break;
    }
    return items;
};

const mapLimit = async <T, R>(
    items: T[],
    limit: number,
    task: (item: T) => Promise<R>
): Promise<R[]> => {
    const results: R[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await task(items[index]);
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, worker)
    );
    return results;
};

/** The SHA git gives a file with this content. */
export const gitBlobSha = (content: string): string => {
    const body = Buffer.from(content, 'utf8');
    return createHash('sha1')
        .update(`blob ${body.length}\0`)
        .update(body)
        .digest('hex');
};

export const getLogin = async (api: GitHubApi): Promise<string> =>
    (await api.request<{ login: string }>('GET', '/user')).login;

export interface RepositorySummary {
    fullName: string;
    defaultBranch: string;
    private: boolean;
    canPush: boolean;
}

export const listRepositories = async (
    api: GitHubApi
): Promise<RepositorySummary[]> => {
    const installations = await pages<{ id: number }>(
        api,
        '/user/installations',
        'installations'
    );
    const repositories = new Map<string, RepositorySummary>();
    for (const installation of installations) {
        const list = await pages<{
            full_name: string;
            default_branch: string;
            private: boolean;
            permissions?: { push?: boolean };
        }>(
            api,
            `/user/installations/${installation.id}/repositories`,
            'repositories'
        );
        for (const repo of list) {
            repositories.set(repo.full_name, {
                fullName: repo.full_name,
                defaultBranch: repo.default_branch,
                private: repo.private,
                canPush: Boolean(repo.permissions?.push),
            });
        }
    }
    return [...repositories.values()].sort((a, b) =>
        a.fullName.localeCompare(b.fullName)
    );
};

export const listBranches = async (
    api: GitHubApi,
    repo: RepoName
): Promise<{ defaultBranch: string; branches: string[] }> => {
    const info = await api.request<{ default_branch: string }>(
        'GET',
        `/repos/${repo.fullName}`
    );
    const branches = await pages<{ name: string }>(
        api,
        `/repos/${repo.fullName}/branches`
    );
    return {
        defaultBranch: info.default_branch,
        branches: branches
            .map((branch) => branch.name)
            .sort((a, b) => a.localeCompare(b)),
    };
};

/** The commit a branch points at, or null when the branch does not exist. */
const branchHead = async (
    api: GitHubApi,
    repo: RepoName,
    branch: string
): Promise<string | null> => {
    try {
        const ref = await api.request<{ object: { sha: string } }>(
            'GET',
            `/repos/${repo.fullName}/git/ref/heads/${encodePath(branch)}`
        );
        return SHA.test(ref.object.sha) ? ref.object.sha : null;
    } catch (error) {
        if (error instanceof GitHubError && error.status === 404) return null;
        throw error;
    }
};

const commitTree = async (
    api: GitHubApi,
    repo: RepoName,
    commit: string
): Promise<string> =>
    (
        await api.request<{ tree: { sha: string } }>(
            'GET',
            `/repos/${repo.fullName}/git/commits/${commit}`
        )
    ).tree.sha;

interface TreeEntry {
    path: string;
    mode: string;
    type: string;
    sha: string;
    size?: number;
}

/**
 * The DBML files below a folder of a commit's tree, by path relative to the folder.
 *
 * @returns The files, or null when the folder does not exist.
 */
const folderFiles = async (
    api: GitHubApi,
    repo: RepoName,
    rootTree: string,
    folder: string
): Promise<Map<string, { sha: string; size: number }> | null> => {
    let tree = rootTree;
    for (const segment of folder ? folder.split('/') : []) {
        const listing = await api.request<{ tree: TreeEntry[] }>(
            'GET',
            `/repos/${repo.fullName}/git/trees/${tree}`
        );
        const entry = listing.tree.find(
            (item) => item.type === 'tree' && item.path === segment
        );
        if (!entry) return null;
        tree = entry.sha;
    }
    const listing = await api.request<{
        tree: TreeEntry[];
        truncated?: boolean;
    }>('GET', `/repos/${repo.fullName}/git/trees/${tree}?recursive=1`);
    if (listing.truncated) {
        throw new GitHubError(
            413,
            'The folder holds too many files to read. Choose a smaller folder.'
        );
    }
    const files = new Map<string, { sha: string; size: number }>();
    for (const entry of listing.tree) {
        if (entry.type !== 'blob' || entry.mode === '120000') continue;
        if (!isFolderFilePath(entry.path)) continue;
        files.set(entry.path, { sha: entry.sha, size: entry.size ?? 0 });
    }
    return files;
};

export interface FolderFile {
    path: string;
    sha: string;
    content: string;
}

export interface FolderContents {
    repo: string;
    branch: string;
    folder: string;
    commit: string;
    files: FolderFile[];
}

export const readFolder = async (
    api: GitHubApi,
    repo: RepoName,
    branch: string,
    folder: string
): Promise<FolderContents> => {
    const head = await branchHead(api, repo, branch);
    if (!head)
        throw new GitHubError(404, `The branch ${branch} does not exist.`);
    const listed = await folderFiles(
        api,
        repo,
        await commitTree(api, repo, head),
        folder
    );
    if (!listed) {
        throw new GitHubError(
            404,
            `The folder ${folder} does not exist on ${branch}.`
        );
    }
    if (listed.size > MAX_FILES) {
        throw new GitHubError(
            413,
            `The folder holds more than ${MAX_FILES} DBML files.`
        );
    }
    let total = 0;
    for (const [path, file] of listed) {
        if (file.size > MAX_FILE_BYTES) {
            throw new GitHubError(413, `${path} is larger than 1 MB.`);
        }
        total += file.size;
    }
    if (total > MAX_TOTAL_BYTES) {
        throw new GitHubError(413, 'The folder holds more than 5 MB of DBML.');
    }
    const files = await mapLimit([...listed], 6, async ([path, file]) => {
        const blob = await api.request<{ content: string; encoding: string }>(
            'GET',
            `/repos/${repo.fullName}/git/blobs/${file.sha}`
        );
        const content =
            blob.encoding === 'base64'
                ? Buffer.from(blob.content, 'base64').toString('utf8')
                : blob.content;
        return { path, sha: file.sha, content };
    });
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { repo: repo.fullName, branch, folder, commit: head, files };
};

export interface FileChange {
    /** Path relative to the folder. */
    path: string;
    content: string;
    /** The file's SHA when the app read it, or null if it did not exist then. */
    expectedSha: string | null;
}

export interface CommitRequest {
    repo: RepoName;
    folder: string;
    /** The branch the files were read from; a new working branch starts from its head. */
    baseBranch: string;
    /** The working branch to commit to. */
    branch: string;
    message: string;
    files: FileChange[];
}

export interface Conflict {
    path: string;
    expectedSha: string | null;
    actualSha: string | null;
}

export type CommitResult =
    | {
          kind: 'committed' | 'unchanged';
          branch: string;
          commit: string;
          createdBranch: boolean;
          /** Every requested file with its SHA after the commit. */
          files: { path: string; sha: string }[];
      }
    | {
          kind: 'conflict';
          reason: 'files_changed' | 'branch_moved';
          conflicts: Conflict[];
      };

export const commitFiles = async (
    api: GitHubApi,
    request: CommitRequest
): Promise<CommitResult> => {
    const { repo, folder, branch } = request;
    const branchCommit = await branchHead(api, repo, branch);
    const parent =
        branchCommit ?? (await branchHead(api, repo, request.baseBranch));
    if (!parent) {
        throw new GitHubError(
            404,
            `The branch ${request.baseBranch} does not exist.`
        );
    }
    const parentTree = await commitTree(api, repo, parent);
    const current =
        (await folderFiles(api, repo, parentTree, folder)) ?? new Map();

    const planned = request.files.map((file) => ({
        ...file,
        sha: gitBlobSha(file.content),
        actualSha: (current.get(file.path)?.sha as string | undefined) ?? null,
    }));
    const conflicts = planned
        .filter(
            (file) =>
                file.actualSha !== file.expectedSha &&
                file.actualSha !== file.sha
        )
        .map(({ path, expectedSha, actualSha }) => ({
            path,
            expectedSha,
            actualSha,
        }));
    if (conflicts.length > 0)
        return { kind: 'conflict', reason: 'files_changed', conflicts };

    const shas = planned.map(({ path, sha }) => ({ path, sha }));
    const changed = planned.filter((file) => file.sha !== file.actualSha);
    if (changed.length === 0) {
        return {
            kind: 'unchanged',
            branch,
            commit: parent,
            createdBranch: false,
            files: shas,
        };
    }

    const tree = await api.request<{ sha: string }>(
        'POST',
        `/repos/${repo.fullName}/git/trees`,
        {
            base_tree: parentTree,
            tree: changed.map((file) => ({
                path: joinPath(folder, file.path),
                mode: '100644',
                type: 'blob',
                content: file.content,
            })),
        }
    );
    const commit = await api.request<{ sha: string }>(
        'POST',
        `/repos/${repo.fullName}/git/commits`,
        { message: request.message, tree: tree.sha, parents: [parent] }
    );

    try {
        if (branchCommit) {
            await api.request(
                'PATCH',
                `/repos/${repo.fullName}/git/refs/heads/${encodePath(branch)}`,
                {
                    sha: commit.sha,
                    force: false,
                }
            );
        } else {
            await api.request('POST', `/repos/${repo.fullName}/git/refs`, {
                ref: `refs/heads/${branch}`,
                sha: commit.sha,
            });
        }
    } catch (error) {
        if (error instanceof GitHubError && error.status === 422) {
            return { kind: 'conflict', reason: 'branch_moved', conflicts: [] };
        }
        throw error;
    }

    return {
        kind: 'committed',
        branch,
        commit: commit.sha,
        createdBranch: !branchCommit,
        files: shas,
    };
};

export interface PullRequestRequest {
    repo: RepoName;
    branch: string;
    base: string;
    title: string;
    body: string;
}

export const createPullRequest = async (
    api: GitHubApi,
    request: PullRequestRequest
): Promise<{ url: string; number: number; existing: boolean }> => {
    const { repo } = request;
    try {
        const pull = await api.request<{ html_url: string; number: number }>(
            'POST',
            `/repos/${repo.fullName}/pulls`,
            {
                title: request.title,
                body: request.body,
                head: request.branch,
                base: request.base,
            }
        );
        return { url: pull.html_url, number: pull.number, existing: false };
    } catch (error) {
        if (!(error instanceof GitHubError) || error.status !== 422)
            throw error;
        const head = encodeURIComponent(`${repo.owner}:${request.branch}`);
        const open = await api.request<{ html_url: string; number: number }[]>(
            'GET',
            `/repos/${repo.fullName}/pulls?state=open&head=${head}&base=${encodeURIComponent(request.base)}`
        );
        if (open.length === 0) throw error;
        return {
            url: open[0].html_url,
            number: open[0].number,
            existing: true,
        };
    }
};
