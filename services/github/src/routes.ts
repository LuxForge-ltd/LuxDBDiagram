/**
 * HTTP routes of the LuxDBDiag GitHub service, all under `/api/github/`.
 *
 * Purpose: the app's only way to GitHub. Every route except `health` first checks Cloudflare
 * Access; GitHub routes then need the person's GitHub sign-in (a sealed cookie bound to their
 * Access email). Writes are POSTs that need the `X-LuxDBDiag: 1` header and a same-origin
 * `Origin`, and they can only touch DBML files on working branches.
 *
 *  GET  health         liveness, no checks
 *  GET  status         whether GitHub is set up and who is signed in
 *  GET  login          starts the GitHub sign-in (redirect)
 *  GET  callback       finishes it (redirect back into the app)
 *  GET  signed-in      page the sign-in window ends on; tells the app and closes
 *  POST logout         forgets the sign-in
 *  GET  repos          repositories the App is installed on
 *  GET  branches       a repository's branches (?repo=)
 *  GET  files          the DBML files of a folder (?repo=&branch=&folder=)
 *  POST commit         commits changed files to a working branch
 *  POST pull-request   opens (or finds) the pull request for a working branch
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AccessVerifier } from './access.ts';
import { AccessError, createAccessVerifier } from './access.ts';
import type { ServiceConfig } from './config.ts';
import { isAccessReady, isGitHubReady } from './config.ts';
import type { FileChange } from './github.ts';
import {
    GitHubError,
    MAX_FILES,
    MAX_TOTAL_BYTES,
    commitFiles,
    createGitHubApi,
    createPullRequest,
    getLogin,
    listBranches,
    listRepositories,
    readFolder,
} from './github.ts';
import {
    OAuthError,
    authorizeUrl,
    exchangeCode,
    refreshTokens,
} from './oauth.ts';
import type { RepoName } from './paths.ts';
import {
    hasControlCharacter,
    isBranchName,
    isFolderFilePath,
    isWorkingBranch,
    normalizeFolder,
    parseRepo,
} from './paths.ts';
import type { GitHubSession, SignInState } from './session.ts';
import {
    SESSION_COOKIE,
    STATE_COOKIE,
    clearCookie,
    cookie,
    parseCookies,
    seal,
    unseal,
} from './session.ts';

export interface HandlerOptions {
    config: ServiceConfig;
    fetch?: typeof fetch;
    now?: () => number;
    accessVerifier?: AccessVerifier;
    githubApiUrl?: string;
    log?: (line: string) => void;
}

export class HttpError extends Error {
    status: number;
    code: string;
    details: Record<string, unknown>;

    constructor(
        status: number,
        code: string,
        message: string,
        details: Record<string, unknown> = {}
    ) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

const SESSION_PURPOSE = 'github-session';
const STATE_PURPOSE = 'github-sign-in';
const SIGN_IN_SECONDS = 10 * 60;
const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000;
const UNEXPIRING_TOKEN_MS = 8 * 60 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 1000;
const MAX_BODY_BYTES = MAX_TOTAL_BYTES + 1_000_000;
const SHA = /^[0-9a-f]{40}$/;

/**
 * The sign-in window's script: tells the app (same origin, any window) that sign-in finished,
 * then closes. A BroadcastChannel is used because GitHub's pages may cut the window's link to
 * its opener.
 */
const SIGNED_IN_SCRIPT =
    "try{new BroadcastChannel('luxdbdiag-github').postMessage('signed-in')}catch(e){}" +
    'setTimeout(function(){window.close()},300);';
const SIGNED_IN_SCRIPT_HASH = createHash('sha256')
    .update(SIGNED_IN_SCRIPT)
    .digest('base64');

const securityHeaders = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
};

const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A path inside the app to return to after signing in; anything else becomes '/'. */
export const safeReturnPath = (value: string | null): string => {
    if (!value || value.length > 1000) return '/';
    if (
        !value.startsWith('/') ||
        value.startsWith('//') ||
        value.startsWith('/\\')
    )
        return '/';
    if (hasControlCharacter(value) || value.includes('\\')) return '/';
    return value;
};

const sameText = (a: string, b: string): boolean => {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
};

const readJsonBody = async (
    req: IncomingMessage
): Promise<Record<string, unknown>> => {
    const type = req.headers['content-type'] ?? '';
    if (!type.toLowerCase().startsWith('application/json')) {
        throw new HttpError(415, 'unsupported_type', 'Send JSON.');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY_BYTES)
            throw new HttpError(413, 'too_large', 'The request is too large.');
        chunks.push(chunk as Buffer);
    }
    try {
        const body = JSON.parse(
            Buffer.concat(chunks).toString('utf8')
        ) as unknown;
        if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new Error('not an object');
        return body as Record<string, unknown>;
    } catch {
        throw new HttpError(400, 'bad_json', 'The request is not valid JSON.');
    }
};

const requireRepo = (value: unknown): RepoName => {
    const repo = parseRepo(value);
    if (!repo)
        throw new HttpError(
            400,
            'bad_repo',
            'Name the repository as owner/name.'
        );
    return repo;
};

const requireBranch = (value: unknown, label: string): string => {
    if (!isBranchName(value))
        throw new HttpError(
            400,
            'bad_branch',
            `${label} is not a valid branch name.`
        );
    return value;
};

const requireFolder = (value: unknown): string => {
    const folder = normalizeFolder(value);
    if (folder === null)
        throw new HttpError(
            400,
            'bad_folder',
            'The folder is not a plain path inside the repository.'
        );
    return folder;
};

const requireText = (value: unknown, label: string, max: number): string => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new HttpError(400, 'bad_text', `${label} is required.`);
    }
    if (value.length > max)
        throw new HttpError(400, 'bad_text', `${label} is too long.`);
    return value.trim();
};

const requireFiles = (value: unknown): FileChange[] => {
    if (!Array.isArray(value) || value.length === 0) {
        throw new HttpError(
            400,
            'bad_files',
            'Name at least one file to commit.'
        );
    }
    if (value.length > MAX_FILES) {
        throw new HttpError(
            400,
            'bad_files',
            `Commit at most ${MAX_FILES} files at once.`
        );
    }
    const seen = new Set<string>();
    let total = 0;
    return value.map((item: unknown) => {
        const file = (item ?? {}) as Record<string, unknown>;
        if (!isFolderFilePath(file.path)) {
            throw new HttpError(
                400,
                'bad_path',
                `${String(file.path)} is not a DBML file the app may write.`
            );
        }
        if (seen.has(file.path))
            throw new HttpError(
                400,
                'bad_path',
                `${file.path} is listed twice.`
            );
        seen.add(file.path);
        if (typeof file.content !== 'string') {
            throw new HttpError(
                400,
                'bad_files',
                `${file.path} has no content.`
            );
        }
        total += Buffer.byteLength(file.content, 'utf8');
        if (total > MAX_TOTAL_BYTES)
            throw new HttpError(
                413,
                'too_large',
                'The files are larger than 5 MB.'
            );
        const expectedSha = file.expectedSha ?? null;
        if (
            expectedSha !== null &&
            (typeof expectedSha !== 'string' || !SHA.test(expectedSha))
        ) {
            throw new HttpError(
                400,
                'bad_files',
                `${file.path} has an invalid expected SHA.`
            );
        }
        return { path: file.path, content: file.content, expectedSha };
    });
};

export const createHandler = (options: HandlerOptions) => {
    const { config } = options;
    const doFetch = options.fetch ?? fetch;
    const now = options.now ?? Date.now;
    const log = options.log ?? ((line: string) => console.log(line));
    const verifier =
        options.accessVerifier ??
        (config.access
            ? createAccessVerifier({ ...config.access, fetch: doFetch, now })
            : null);
    const secure = config.publicUrl
        ? config.publicUrl.startsWith('https:')
        : true;
    const redirectUri = config.publicUrl
        ? `${config.publicUrl}/api/github/callback`
        : '';
    const githubApi = (token: string) =>
        createGitHubApi(token, doFetch, options.githubApiUrl);

    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const url = new URL(req.url ?? '/', 'http://github.internal');
        const method = req.method ?? 'GET';
        const route = url.pathname.startsWith('/api/github/')
            ? url.pathname.slice('/api/github/'.length)
            : null;
        const setCookies: string[] = [];

        const send = (
            status: number,
            headers: Record<string, string>,
            body: string
        ) => {
            res.writeHead(status, {
                ...securityHeaders,
                ...headers,
                ...(setCookies.length ? { 'Set-Cookie': setCookies } : {}),
            });
            res.end(body);
            log(`${method} ${url.pathname} ${status}`);
        };
        const json = (status: number, body: unknown) =>
            send(
                status,
                { 'Content-Type': 'application/json; charset=utf-8' },
                JSON.stringify(body)
            );
        const redirect = (location: string) =>
            send(302, { Location: location }, '');
        const page = (
            status: number,
            title: string,
            message: string,
            back: string
        ) =>
            send(
                status,
                {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Security-Policy':
                        "default-src 'none'; style-src 'unsafe-inline'",
                },
                `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
                    `<body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem">` +
                    `<h1 style="font-size:1.25rem">${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>` +
                    `<p><a href="${escapeHtml(back)}">Back to LuxDBDiag</a></p></body>`
            );

        try {
            if (route === null)
                throw new HttpError(404, 'not_found', 'Not found.');
            if (route === 'health' && method === 'GET') {
                json(200, { ok: true });
                return;
            }

            if (!isAccessReady(config)) {
                throw new HttpError(
                    503,
                    'access_not_configured',
                    'The service is not set up for Cloudflare Access.'
                );
            }
            const header = req.headers['cf-access-jwt-assertion'];
            const email = verifier
                ? (
                      await verifier.verify(
                          Array.isArray(header) ? header[0] : header
                      )
                  ).email
                : '';

            if (method === 'POST') {
                if (req.headers['x-luxdbdiag'] !== '1') {
                    throw new HttpError(
                        403,
                        'csrf',
                        'The request did not come from LuxDBDiag.'
                    );
                }
                const origin = req.headers.origin;
                if (origin && origin !== config.publicUrl) {
                    throw new HttpError(
                        403,
                        'csrf',
                        'The request came from another site.'
                    );
                }
            }

            const cookies = parseCookies(req.headers.cookie);
            const sessionKey = config.sessionKey;
            const github = config.github;

            const storeSession = (session: GitHubSession) => {
                if (!sessionKey) return;
                const end = Math.min(
                    session.refreshExpiresAt ??
                        session.tokenExpiresAt ??
                        now() + UNEXPIRING_TOKEN_MS,
                    now() + SESSION_MAX_MS
                );
                setCookies.push(
                    cookie(
                        SESSION_COOKIE,
                        seal(sessionKey, SESSION_PURPOSE, session, end),
                        (end - now()) / 1000,
                        secure
                    )
                );
            };
            const forgetSession = () =>
                setCookies.push(clearCookie(SESSION_COOKIE, secure));

            const loadSession = async (): Promise<GitHubSession | null> => {
                if (!sessionKey || !github) return null;
                const session = unseal<GitHubSession>(
                    sessionKey,
                    SESSION_PURPOSE,
                    cookies[SESSION_COOKIE],
                    now()
                );
                if (!session || session.email !== email) return null;
                if (
                    session.tokenExpiresAt === null ||
                    session.tokenExpiresAt - REFRESH_MARGIN_MS > now()
                ) {
                    return session;
                }
                if (
                    !session.refreshToken ||
                    (session.refreshExpiresAt ?? 0) <= now()
                )
                    return null;
                try {
                    const tokens = await refreshTokens(
                        doFetch,
                        github,
                        session.refreshToken,
                        now()
                    );
                    const renewed = { ...session, ...tokens };
                    storeSession(renewed);
                    return renewed;
                } catch {
                    return null;
                }
            };

            const requireReady = () => {
                if (!isGitHubReady(config) || !sessionKey || !github) {
                    throw new HttpError(
                        503,
                        'not_configured',
                        'GitHub sign-in is not set up on this server.',
                        {
                            missing: config.problems,
                        }
                    );
                }
                return { sessionKey, github };
            };

            const requireSession = async () => {
                requireReady();
                const session = await loadSession();
                if (!session) {
                    if (cookies[SESSION_COOKIE]) forgetSession();
                    throw new HttpError(
                        401,
                        'signed_out',
                        'Sign in to GitHub first.'
                    );
                }
                return githubApi(session.token);
            };

            const routeKey = `${method} ${route}`;
            switch (routeKey) {
                case 'GET status': {
                    const session = isGitHubReady(config)
                        ? await loadSession()
                        : null;
                    json(200, {
                        configured: isGitHubReady(config),
                        missing: config.problems,
                        signedIn: Boolean(session),
                        login: session?.login ?? null,
                        installUrl: github?.appSlug
                            ? `https://github.com/apps/${encodeURIComponent(github.appSlug)}/installations/new`
                            : null,
                        branchPrefix: config.branchPrefix,
                    });
                    return;
                }
                case 'GET login': {
                    const ready = requireReady();
                    const state = randomBytes(24).toString('base64url');
                    const signIn: SignInState = {
                        state,
                        returnTo: safeReturnPath(
                            url.searchParams.get('return')
                        ),
                        email,
                    };
                    setCookies.push(
                        cookie(
                            STATE_COOKIE,
                            seal(
                                ready.sessionKey,
                                STATE_PURPOSE,
                                signIn,
                                now() + SIGN_IN_SECONDS * 1000
                            ),
                            SIGN_IN_SECONDS,
                            secure
                        )
                    );
                    redirect(authorizeUrl(ready.github, redirectUri, state));
                    return;
                }
                case 'GET callback': {
                    const ready = requireReady();
                    const signIn = unseal<SignInState>(
                        ready.sessionKey,
                        STATE_PURPOSE,
                        cookies[STATE_COOKIE],
                        now()
                    );
                    setCookies.push(clearCookie(STATE_COOKIE, secure));
                    const state = url.searchParams.get('state');
                    if (
                        !signIn ||
                        !state ||
                        !sameText(signIn.state, state) ||
                        signIn.email !== email
                    ) {
                        page(
                            400,
                            'GitHub sign-in not completed',
                            'The sign-in could not be checked, or took longer than ten minutes. Start it again from LuxDBDiag.',
                            '/'
                        );
                        return;
                    }
                    const code = url.searchParams.get('code');
                    if (!code) {
                        redirect(signIn.returnTo);
                        return;
                    }
                    try {
                        const tokens = await exchangeCode(
                            doFetch,
                            ready.github,
                            code,
                            redirectUri,
                            now()
                        );
                        const login = await getLogin(githubApi(tokens.token));
                        storeSession({ email, login, ...tokens });
                    } catch (error) {
                        const reason =
                            error instanceof OAuthError ||
                            error instanceof GitHubError
                                ? error.message
                                : 'GitHub could not be reached.';
                        page(
                            502,
                            'GitHub sign-in failed',
                            reason,
                            signIn.returnTo
                        );
                        return;
                    }
                    redirect(signIn.returnTo);
                    return;
                }
                case 'GET signed-in': {
                    // Where the sign-in window lands: says so, tells the app, and closes.
                    const session = isGitHubReady(config)
                        ? await loadSession()
                        : null;
                    const message = session
                        ? `Signed in to GitHub as ${session.login}. You can close this window.`
                        : 'Not signed in to GitHub. You can close this window and try again.';
                    send(
                        200,
                        {
                            'Content-Type': 'text/html; charset=utf-8',
                            'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${SIGNED_IN_SCRIPT_HASH}'`,
                        },
                        `<!doctype html><meta charset="utf-8"><title>LuxDBDiag and GitHub</title>` +
                            `<body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem">` +
                            `<p>${escapeHtml(message)}</p>` +
                            (session
                                ? `<script>${SIGNED_IN_SCRIPT}</script>`
                                : '') +
                            `</body>`
                    );
                    return;
                }
                case 'POST logout': {
                    forgetSession();
                    send(204, {}, '');
                    return;
                }
                case 'GET repos': {
                    const api = await requireSession();
                    json(200, { repositories: await listRepositories(api) });
                    return;
                }
                case 'GET branches': {
                    const repo = requireRepo(url.searchParams.get('repo'));
                    const api = await requireSession();
                    json(200, await listBranches(api, repo));
                    return;
                }
                case 'GET files': {
                    const repo = requireRepo(url.searchParams.get('repo'));
                    const branch = requireBranch(
                        url.searchParams.get('branch'),
                        'The branch'
                    );
                    const folder = requireFolder(
                        url.searchParams.get('folder')
                    );
                    const api = await requireSession();
                    json(200, await readFolder(api, repo, branch, folder));
                    return;
                }
                case 'POST commit': {
                    const body = await readJsonBody(req);
                    const repo = requireRepo(body.repo);
                    const folder = requireFolder(body.folder);
                    const baseBranch = requireBranch(
                        body.baseBranch,
                        'The base branch'
                    );
                    if (!isWorkingBranch(body.branch, config.branchPrefix)) {
                        throw new HttpError(
                            403,
                            'not_working_branch',
                            `LuxDBDiag only commits to branches starting ${config.branchPrefix}.`
                        );
                    }
                    const message = requireText(
                        body.message,
                        'The commit message',
                        5000
                    );
                    const files = requireFiles(body.files);
                    const api = await requireSession();
                    const result = await commitFiles(api, {
                        repo,
                        folder,
                        baseBranch,
                        branch: body.branch,
                        message,
                        files,
                    });
                    if (result.kind === 'conflict') {
                        json(409, { code: 'conflict', ...result });
                        return;
                    }
                    json(200, result);
                    return;
                }
                case 'POST pull-request': {
                    const body = await readJsonBody(req);
                    const repo = requireRepo(body.repo);
                    if (!isWorkingBranch(body.branch, config.branchPrefix)) {
                        throw new HttpError(
                            403,
                            'not_working_branch',
                            `LuxDBDiag only opens pull requests from branches starting ${config.branchPrefix}.`
                        );
                    }
                    const base = requireBranch(body.base, 'The base branch');
                    if (base === body.branch) {
                        throw new HttpError(
                            400,
                            'bad_branch',
                            'The base branch must differ from the working branch.'
                        );
                    }
                    const title = requireText(body.title, 'The title', 256);
                    const description =
                        typeof body.body === 'string'
                            ? body.body.slice(0, 20000)
                            : '';
                    const api = await requireSession();
                    json(
                        200,
                        await createPullRequest(api, {
                            repo,
                            branch: body.branch,
                            base,
                            title,
                            body: description,
                        })
                    );
                    return;
                }
                default:
                    throw new HttpError(404, 'not_found', 'Not found.');
            }
        } catch (error) {
            if (error instanceof HttpError) {
                json(error.status, {
                    code: error.code,
                    error: error.message,
                    ...error.details,
                });
            } else if (error instanceof AccessError) {
                json(403, { code: 'access_denied', error: error.message });
            } else if (error instanceof GitHubError) {
                if (error.status === 401) {
                    setCookies.push(clearCookie(SESSION_COOKIE, secure));
                    json(401, {
                        code: 'signed_out',
                        error: 'GitHub no longer accepts the sign-in. Sign in again.',
                    });
                } else if ([403, 404, 409, 413, 422].includes(error.status)) {
                    json(error.status, {
                        code: 'github',
                        error: error.message,
                    });
                } else {
                    json(502, { code: 'github', error: error.message });
                }
            } else {
                console.error(
                    'Unexpected error',
                    error instanceof Error ? error.message : error
                );
                json(500, {
                    code: 'internal',
                    error: 'Something went wrong in the GitHub service.',
                });
            }
        }
    };
};
