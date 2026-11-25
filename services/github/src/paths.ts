/**
 * Names the service accepts: repositories, branches and DBML file paths.
 *
 * Purpose: every name that reaches GitHub is checked here first. The file rules match the app's
 * folder reader (`src/lib/areas/folder-access.ts`): `.dbml` files at most four folders deep, not
 * inside dot folders, `node_modules`, `dist` or `build`.
 */

export const MAX_FOLDER_DEPTH = 4;
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', 'build']);

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/** Whether text holds an ASCII control character (U+0000 to U+001F, or U+007F). */
export const hasControlCharacter = (value: string): boolean => {
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code < 0x20 || code === 0x7f) return true;
    }
    return false;
};

export interface RepoName {
    owner: string;
    name: string;
    fullName: string;
}

export const parseRepo = (value: unknown): RepoName | null => {
    if (typeof value !== 'string') return null;
    const parts = value.split('/');
    if (parts.length !== 2) return null;
    const [owner, name] = parts;
    if (
        !OWNER.test(owner) ||
        !REPO.test(name) ||
        name === '.' ||
        name === '..'
    ) {
        return null;
    }
    return { owner, name, fullName: `${owner}/${name}` };
};

/** A branch name git would accept (the rules of `git check-ref-format --branch`, slightly stricter). */
export const isBranchName = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 200)
        return false;
    if (value === '@' || value.startsWith('-')) return false;
    if (hasControlCharacter(value) || /[ ~^:?*[\\]/.test(value)) return false;
    if (value.includes('..') || value.includes('@{') || value.includes('//'))
        return false;
    if (value.startsWith('/') || value.endsWith('/') || value.endsWith('.'))
        return false;
    return value
        .split('/')
        .every(
            (part) =>
                part.length > 0 &&
                !part.startsWith('.') &&
                !part.endsWith('.lock')
        );
};

/** A branch the service may write to: a valid name under the working-branch prefix. */
export const isWorkingBranch = (
    value: unknown,
    prefix: string
): value is string =>
    isBranchName(value) &&
    value.startsWith(prefix) &&
    value.length > prefix.length;

/**
 * Normalises a folder inside a repository: '' for the root, otherwise segments joined by '/'.
 *
 * @returns The folder, or null when it is not a plain relative path.
 */
export const normalizeFolder = (value: unknown): string | null => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > 500 || value.includes('\\'))
        return null;
    const segments = value.split('/').filter((segment) => segment.length > 0);
    if (segments.some((segment) => segment === '.' || segment === '..'))
        return null;
    if (segments.some(hasControlCharacter)) return null;
    return segments.join('/');
};

export const isDBMLPath = (path: string): boolean =>
    path.toLowerCase().endsWith('.dbml');

/** Whether a folder inside the opened one is searched for files. */
export const isSearchedFolder = (name: string): boolean =>
    !name.startsWith('.') && !SKIPPED_FOLDERS.has(name);

/**
 * Whether a path, relative to the opened folder, is a DBML file the app reads and may write.
 */
export const isFolderFilePath = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 500)
        return false;
    if (value.includes('\\') || value.startsWith('/')) return false;
    const segments = value.split('/');
    const fileName = segments[segments.length - 1];
    const folders = segments.slice(0, -1);
    if (
        segments.some(
            (segment) =>
                segment.length === 0 || segment === '.' || segment === '..'
        )
    ) {
        return false;
    }
    if (segments.some(hasControlCharacter)) return false;
    return (
        isDBMLPath(fileName) &&
        folders.length <= MAX_FOLDER_DEPTH &&
        folders.every(isSearchedFolder)
    );
};

export const joinPath = (folder: string, path: string): string =>
    folder ? `${folder}/${path}` : path;

/** Encodes a ref or path for a GitHub URL, keeping its slashes. */
export const encodePath = (value: string): string =>
    value.split('/').map(encodeURIComponent).join('/');
