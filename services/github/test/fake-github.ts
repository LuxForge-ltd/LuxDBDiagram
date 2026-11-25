/**
 * An in-memory GitHub for the service's tests: one repository with branches, commits, trees and
 * blobs, the parts of the REST API the service calls, and the OAuth token endpoint.
 */
import { createHash } from 'node:crypto';
import { gitBlobSha } from '../src/github.ts';

export const REPO = 'LuxForge-ltd/schema';

interface Commit {
    tree: string;
    parents: string[];
    message: string;
}

const sha1 = (text: string): string =>
    createHash('sha1').update(text).digest('hex');

const json = (status: number, body: unknown): Response =>
    new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });

export const createFakeGitHub = (
    files: Record<string, string>,
    options: { branches?: string[]; defaultBranch?: string } = {}
) => {
    const blobs = new Map<string, string>();
    /** Root trees: tree SHA → (repository path → blob SHA). */
    const trees = new Map<string, Map<string, string>>();
    /** Subtree SHA → the root tree and folder it stands for. */
    const subtrees = new Map<string, { root: string; folder: string }>();
    const commits = new Map<string, Commit>();
    const refs = new Map<string, string>();
    const pulls: {
        number: number;
        head: string;
        base: string;
        title: string;
    }[] = [];
    const calls: string[] = [];
    const tokens = new Map<string, { token: string; refresh: string }>();
    const validTokens = new Set<string>();

    const storeTree = (entries: Map<string, string>): string => {
        const sha = sha1(
            [...entries]
                .sort()
                .map((entry) => entry.join(' '))
                .join('\n')
        );
        trees.set(sha, entries);
        return sha;
    };
    const storeFiles = (
        contents: Record<string, string>
    ): Map<string, string> => {
        const entries = new Map<string, string>();
        for (const [path, content] of Object.entries(contents)) {
            const sha = gitBlobSha(content);
            blobs.set(sha, content);
            entries.set(path, sha);
        }
        return entries;
    };
    const storeCommit = (
        tree: string,
        parents: string[],
        message: string
    ): string => {
        const sha = sha1(
            `${tree}|${parents.join(',')}|${message}|${commits.size}`
        );
        commits.set(sha, { tree, parents, message });
        return sha;
    };

    const initial = storeCommit(storeTree(storeFiles(files)), [], 'initial');
    for (const branch of options.branches ?? ['main', 'Dev'])
        refs.set(branch, initial);

    const resolveTree = (
        sha: string
    ): { root: string; folder: string } | null => {
        if (trees.has(sha)) return { root: sha, folder: '' };
        return subtrees.get(sha) ?? null;
    };
    const subtreeSha = (root: string, folder: string): string => {
        const sha = sha1(`subtree ${root}:${folder}`);
        subtrees.set(sha, { root, folder });
        return sha;
    };

    const listTree = (root: string, folder: string, recursive: boolean) => {
        const prefix = folder ? `${folder}/` : '';
        const entries: {
            path: string;
            mode: string;
            type: string;
            sha: string;
            size?: number;
        }[] = [];
        const folders = new Set<string>();
        for (const [path, sha] of trees.get(root) ??
            new Map<string, string>()) {
            if (!path.startsWith(prefix)) continue;
            const relative = path.slice(prefix.length);
            const parts = relative.split('/');
            if (recursive || parts.length === 1) {
                entries.push({
                    path: relative,
                    mode: '100644',
                    type: 'blob',
                    sha,
                    size: Buffer.byteLength(blobs.get(sha) ?? ''),
                });
            }
            for (let depth = 1; depth < parts.length; depth++) {
                if (!recursive && depth > 1) break;
                folders.add(parts.slice(0, depth).join('/'));
            }
        }
        for (const name of folders) {
            entries.push({
                path: name,
                mode: '040000',
                type: 'tree',
                sha: subtreeSha(root, prefix + name),
            });
        }
        return entries;
    };

    const fetchImpl = async (
        input: string | URL | Request,
        init?: RequestInit
    ): Promise<Response> => {
        const url = new URL(
            typeof input === 'string'
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url
        );
        const method = init?.method ?? 'GET';
        const body = init?.body
            ? (JSON.parse(String(init.body)) as Record<string, unknown>)
            : {};
        calls.push(`${method} ${url.pathname}`);

        if (url.href === 'https://github.com/login/oauth/access_token') {
            const code = body.code as string | undefined;
            const refresh = body.refresh_token as string | undefined;
            let issued: { token: string; refresh: string } | undefined;
            if (code) issued = tokens.get(`code:${code}`);
            if (refresh) issued = tokens.get(`refresh:${refresh}`);
            if (!issued) return json(200, { error: 'bad_verification_code' });
            validTokens.add(issued.token);
            return json(200, {
                access_token: issued.token,
                expires_in: 28800,
                refresh_token: issued.refresh,
                refresh_token_expires_in: 15897600,
            });
        }

        const auth = new Headers(init?.headers)
            .get('authorization')
            ?.replace('Bearer ', '');
        if (!auth || !validTokens.has(auth))
            return json(401, { message: 'Bad credentials' });

        const path = url.pathname;
        if (path === '/user') return json(200, { login: 'tester' });
        if (path === '/user/installations')
            return json(200, { installations: [{ id: 1 }] });
        if (path === '/user/installations/1/repositories') {
            return json(200, {
                repositories: [
                    {
                        full_name: REPO,
                        default_branch: options.defaultBranch ?? 'main',
                        private: true,
                        permissions: { push: true },
                    },
                ],
            });
        }

        const prefix = `/repos/${REPO}`;
        if (!path.startsWith(prefix))
            return json(404, { message: 'Not Found' });
        const rest = decodeURIComponent(path.slice(prefix.length));

        if (rest === '' && method === 'GET') {
            return json(200, {
                default_branch: options.defaultBranch ?? 'main',
            });
        }
        if (rest === '/branches') {
            return json(
                200,
                [...refs.keys()].map((name) => ({ name }))
            );
        }
        if (rest.startsWith('/git/ref/heads/') && method === 'GET') {
            const sha = refs.get(rest.slice('/git/ref/heads/'.length));
            return sha
                ? json(200, { object: { sha, type: 'commit' } })
                : json(404, { message: 'Not Found' });
        }
        if (rest.startsWith('/git/commits/') && method === 'GET') {
            const commit = commits.get(rest.slice('/git/commits/'.length));
            return commit
                ? json(200, { sha: rest.slice(13), tree: { sha: commit.tree } })
                : json(404, { message: 'Not Found' });
        }
        if (rest.startsWith('/git/trees/') && method === 'GET') {
            const tree = resolveTree(rest.slice('/git/trees/'.length));
            if (!tree) return json(404, { message: 'Not Found' });
            return json(200, {
                tree: listTree(
                    tree.root,
                    tree.folder,
                    url.searchParams.get('recursive') === '1'
                ),
                truncated: false,
            });
        }
        if (rest.startsWith('/git/blobs/')) {
            const content = blobs.get(rest.slice('/git/blobs/'.length));
            return content === undefined
                ? json(404, { message: 'Not Found' })
                : json(200, {
                      content: Buffer.from(content).toString('base64'),
                      encoding: 'base64',
                  });
        }
        if (rest === '/git/trees' && method === 'POST') {
            const base = trees.get(body.base_tree as string);
            if (!base) return json(422, { message: 'base_tree not found' });
            const next = new Map(base);
            for (const entry of body.tree as {
                path: string;
                content: string;
            }[]) {
                const sha = gitBlobSha(entry.content);
                blobs.set(sha, entry.content);
                next.set(entry.path, sha);
            }
            return json(201, { sha: storeTree(next) });
        }
        if (rest === '/git/commits' && method === 'POST') {
            return json(201, {
                sha: storeCommit(
                    body.tree as string,
                    body.parents as string[],
                    body.message as string
                ),
            });
        }
        if (rest.startsWith('/git/refs/heads/') && method === 'PATCH') {
            const branch = rest.slice('/git/refs/heads/'.length);
            const current = refs.get(branch);
            const next = commits.get(body.sha as string);
            if (!current || !next)
                return json(422, { message: 'Reference does not exist' });
            if (!next.parents.includes(current))
                return json(422, { message: 'Update is not a fast forward' });
            refs.set(branch, body.sha as string);
            return json(200, { object: { sha: body.sha } });
        }
        if (rest === '/git/refs' && method === 'POST') {
            const branch = (body.ref as string).replace('refs/heads/', '');
            if (refs.has(branch))
                return json(422, { message: 'Reference already exists' });
            refs.set(branch, body.sha as string);
            return json(201, { ref: body.ref });
        }
        if (rest === '/pulls' && method === 'POST') {
            if (
                pulls.some(
                    (pull) => pull.head === body.head && pull.base === body.base
                )
            ) {
                return json(422, { message: 'A pull request already exists' });
            }
            const pull = {
                number: pulls.length + 1,
                head: body.head as string,
                base: body.base as string,
                title: body.title as string,
            };
            pulls.push(pull);
            return json(201, {
                number: pull.number,
                html_url: `https://github.com/${REPO}/pull/${pull.number}`,
            });
        }
        if (rest === '/pulls' && method === 'GET') {
            const head = url.searchParams.get('head')?.split(':')[1];
            return json(
                200,
                pulls
                    .filter((pull) => pull.head === head)
                    .map((pull) => ({
                        number: pull.number,
                        html_url: `https://github.com/${REPO}/pull/${pull.number}`,
                    }))
            );
        }
        return json(404, { message: `No fake for ${method} ${path}` });
    };

    /** Files of a branch, by repository path. */
    const branchFiles = (branch: string): Record<string, string> => {
        const commit = commits.get(refs.get(branch) ?? '');
        const entries = commit ? trees.get(commit.tree) : undefined;
        return Object.fromEntries(
            [...(entries ?? [])].map(([path, sha]) => [
                path,
                blobs.get(sha) ?? '',
            ])
        );
    };

    /** Commits a change straight to a branch, as someone else would. */
    const pushToBranch = (branch: string, contents: Record<string, string>) => {
        const head = refs.get(branch);
        const commit = commits.get(head ?? '');
        if (!head || !commit) throw new Error(`no branch ${branch}`);
        const next = new Map(trees.get(commit.tree));
        for (const [path, sha] of storeFiles(contents)) next.set(path, sha);
        refs.set(branch, storeCommit(storeTree(next), [head], 'someone else'));
    };

    return {
        fetch: fetchImpl as typeof fetch,
        calls,
        refs,
        pulls,
        branchFiles,
        pushToBranch,
        commitMessage: (sha: string) => commits.get(sha)?.message,
        /** Lets the OAuth endpoint swap `code` for `token` (and `refresh` for it later). */
        issueCode: (code: string, token: string, refresh: string) => {
            tokens.set(`code:${code}`, { token, refresh });
            tokens.set(`refresh:${refresh}`, {
                token: `${token}-renewed`,
                refresh: `${refresh}-renewed`,
            });
        },
        /** Accepts a token without going through OAuth. */
        allowToken: (token: string) => validTokens.add(token),
        revokeToken: (token: string) => validTokens.delete(token),
    };
};

export type FakeGitHub = ReturnType<typeof createFakeGitHub>;
