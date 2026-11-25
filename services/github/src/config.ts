/**
 * Configuration of the LuxDBDiag GitHub service.
 *
 * Purpose: reads the service's settings from the environment. Missing GitHub settings do not stop
 * the service: it starts, reports what is missing on `/api/github/status`, and refuses GitHub
 * work until they are set. Cloudflare Access settings are required for every route except
 * `/api/github/health`, unless `ALLOW_WITHOUT_ACCESS=true` (local development only).
 */

export interface AccessConfig {
    /** The Access team domain, for example `example.cloudflareaccess.com`. */
    teamDomain: string;
    /** The Access application's audience (AUD) tag. */
    audience: string;
}

export interface GitHubAppConfig {
    clientId: string;
    clientSecret: string;
    /** The GitHub App's URL name, used for its install link. */
    appSlug: string | null;
}

export interface ServiceConfig {
    port: number;
    /** The public origin of the app, for example `https://luxdbdiagram.luxforge.dev`. */
    publicUrl: string | null;
    github: GitHubAppConfig | null;
    /** 32-byte key that seals the session cookies. */
    sessionKey: Buffer | null;
    /** Cloudflare Access settings, or null when Access checks are switched off. */
    access: AccessConfig | null;
    /** True only when `ALLOW_WITHOUT_ACCESS=true`: requests are not checked against Access. */
    accessDisabled: boolean;
    /** Working branches the service may write to start with this. */
    branchPrefix: string;
    /** Settings that are missing or invalid, by environment variable name. */
    problems: string[];
}

const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
const BRANCH_PREFIX = /^[a-z0-9][a-z0-9-]*\/$/;

const text = (value: string | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
};

const parsePublicUrl = (value: string | null): string | null => {
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
            return null;
        }
        return url.origin;
    } catch {
        return null;
    }
};

const parseSessionKey = (value: string | null): Buffer | null => {
    if (!value) return null;
    const key = Buffer.from(value, 'base64');
    return key.length === 32 ? key : null;
};

export const readConfig = (env: NodeJS.ProcessEnv): ServiceConfig => {
    const problems: string[] = [];

    const port = Number(text(env.PORT) ?? '8080');
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        problems.push('PORT');
    }

    const publicUrl = parsePublicUrl(text(env.PUBLIC_URL));
    if (!publicUrl) problems.push('PUBLIC_URL');

    const clientId = text(env.GITHUB_CLIENT_ID);
    const clientSecret = text(env.GITHUB_CLIENT_SECRET);
    if (!clientId) problems.push('GITHUB_CLIENT_ID');
    if (!clientSecret) problems.push('GITHUB_CLIENT_SECRET');
    const github =
        clientId && clientSecret
            ? { clientId, clientSecret, appSlug: text(env.GITHUB_APP_SLUG) }
            : null;

    const sessionKey = parseSessionKey(text(env.SESSION_KEY));
    if (!sessionKey) problems.push('SESSION_KEY');

    const accessDisabled = text(env.ALLOW_WITHOUT_ACCESS) === 'true';
    let access: AccessConfig | null = null;
    if (!accessDisabled) {
        const teamDomain = text(env.ACCESS_TEAM_DOMAIN)?.toLowerCase() ?? null;
        const audience = text(env.ACCESS_AUD);
        if (!teamDomain || !TEAM_DOMAIN.test(teamDomain)) {
            problems.push('ACCESS_TEAM_DOMAIN');
        }
        if (!audience) problems.push('ACCESS_AUD');
        if (teamDomain && TEAM_DOMAIN.test(teamDomain) && audience) {
            access = { teamDomain, audience };
        }
    }

    const prefix = text(env.BRANCH_PREFIX) ?? 'luxdbdiag/';
    const branchPrefix = BRANCH_PREFIX.test(prefix) ? prefix : 'luxdbdiag/';
    if (prefix !== branchPrefix) problems.push('BRANCH_PREFIX');

    return {
        port: problems.includes('PORT') ? 8080 : port,
        publicUrl,
        github,
        sessionKey,
        access,
        accessDisabled,
        branchPrefix,
        problems,
    };
};

/** True when the service can sign people in to GitHub. */
export const isGitHubReady = (config: ServiceConfig): boolean =>
    Boolean(config.github && config.sessionKey && config.publicUrl);

/** True when requests can be checked (or Access checks are explicitly switched off). */
export const isAccessReady = (config: ServiceConfig): boolean =>
    config.accessDisabled || config.access !== null;
