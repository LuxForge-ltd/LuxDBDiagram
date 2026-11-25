/**
 * GitHub App sign-in (user access tokens).
 *
 * Purpose: the OAuth web flow of a GitHub App. The person signs in on GitHub; the service swaps
 * the code for a user access token, which acts as that person but only on repositories where the
 * App is installed, and only with the App's permissions. Tokens expire after eight hours and are
 * renewed with the refresh token (when the App has token expiry on, as recommended).
 */
import type { GitHubAppConfig } from './config.ts';

export interface TokenSet {
    token: string;
    tokenExpiresAt: number | null;
    refreshToken: string | null;
    refreshExpiresAt: number | null;
}

export class OAuthError extends Error {}

const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';

export const authorizeUrl = (
    app: GitHubAppConfig,
    redirectUri: string,
    state: string
): string =>
    `${AUTHORIZE_URL}?${new URLSearchParams({
        client_id: app.clientId,
        redirect_uri: redirectUri,
        state,
        allow_signup: 'false',
    }).toString()}`;

const requestTokens = async (
    doFetch: typeof fetch,
    params: Record<string, string>,
    now: number
): Promise<TokenSet> => {
    const response = await doFetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'LuxDBDiag',
        },
        body: JSON.stringify(params),
    });
    const data = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
    >;
    if (!response.ok || typeof data.access_token !== 'string') {
        const reason =
            typeof data.error_description === 'string'
                ? data.error_description
                : typeof data.error === 'string'
                  ? data.error
                  : `GitHub answered ${response.status}`;
        throw new OAuthError(reason);
    }
    const seconds = (value: unknown): number | null =>
        typeof value === 'number' && value > 0 ? now + value * 1000 : null;
    return {
        token: data.access_token,
        tokenExpiresAt: seconds(data.expires_in),
        refreshToken:
            typeof data.refresh_token === 'string' ? data.refresh_token : null,
        refreshExpiresAt: seconds(data.refresh_token_expires_in),
    };
};

export const exchangeCode = (
    doFetch: typeof fetch,
    app: GitHubAppConfig,
    code: string,
    redirectUri: string,
    now: number
): Promise<TokenSet> =>
    requestTokens(
        doFetch,
        {
            client_id: app.clientId,
            client_secret: app.clientSecret,
            code,
            redirect_uri: redirectUri,
        },
        now
    );

export const refreshTokens = (
    doFetch: typeof fetch,
    app: GitHubAppConfig,
    refreshToken: string,
    now: number
): Promise<TokenSet> =>
    requestTokens(
        doFetch,
        {
            client_id: app.clientId,
            client_secret: app.clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        },
        now
    );
