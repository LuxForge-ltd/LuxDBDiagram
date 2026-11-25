/**
 * A diagram's link to a GitHub repository folder (LuxDBDiagram).
 *
 * Purpose: when a diagram is created from a repository folder, it remembers where the files came
 * from and what they held, so it can later commit only the files that changed and detect files
 * changed on GitHub meanwhile.
 * Scope: kept in this browser (IndexedDB), per diagram; never exported with the diagram.
 *
 * - `branch` is the branch the files were read from.
 * - `workingBranch` is where commits go (it starts with the service's prefix, `luxdbdiag/`).
 * - `baseBranch` is what the pull request targets: the branch read from, unless that was itself
 *   a working branch, in which case `Dev` (or the repository's default branch).
 * - `files` hold each file as GitHub has it: as read, then as last committed.
 */

export interface RepoSourceFile {
    /** Path relative to the folder. */
    path: string;
    sha: string;
    content: string;
    /** Whether the file was imported (each imported file is an Area). */
    selected: boolean;
}

/** What the import dialog knows about a repository folder before the diagram exists. */
export interface RepoFolderLink {
    repo: string;
    branch: string;
    folder: string;
    commit: string;
    baseBranch: string;
    workingBranch: string;
    files: Omit<RepoSourceFile, 'selected'>[];
}

export interface RepoSource extends Omit<RepoFolderLink, 'files'> {
    diagramId: string;
    files: RepoSourceFile[];
    linkedAt: number;
    /** The pull request opened from the working branch, once there is one. */
    pullRequestUrl: string | null;
    /**
     * What LuxDBDiag wrote for each file when linked or last committed, by path; null for a file
     * that counts as changed (edited before importing). See `repo-changes.ts`.
     */
    generated?: Record<string, string | null>;
    /** The last commit LuxDBDiag made on the working branch, if any. */
    lastCommit?: string | null;
    /** Files LuxDBDiag has committed to the working branch, for the pull request description. */
    committedFiles?: { path: string; kind: 'changed' | 'new' }[];
}

/** Working branches the GitHub service may write to start with this. */
export const WORKING_BRANCH_PREFIX = 'luxdbdiag/';

/** A branch name under the prefix that git (and the service) accept. */
export const isWorkingBranchName = (
    value: string,
    prefix = WORKING_BRANCH_PREFIX
): boolean => {
    if (!value.startsWith(prefix) || value.length <= prefix.length) {
        return false;
    }
    if (value.length > 200 || /[\s~^:?*[\\]/.test(value)) return false;
    if (value.includes('..') || value.includes('@{') || value.includes('//')) {
        return false;
    }
    if (value.endsWith('/') || value.endsWith('.')) return false;
    return value
        .split('/')
        .every(
            (part) =>
                part.length > 0 &&
                !part.startsWith('.') &&
                !part.endsWith('.lock')
        );
};

/** Lower-case letters, digits and single hyphens. */
const slug = (value: string): string =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/g, '');

/**
 * Picks the branch a pull request targets and the branch commits go to.
 *
 * @param seed A short random text that keeps working branches of different diagrams apart.
 */
export const chooseBranches = (options: {
    repo: string;
    branch: string;
    folder: string;
    branches: string[];
    defaultBranch: string;
    prefix: string;
    seed: string;
}): { baseBranch: string; workingBranch: string } => {
    const { branch, prefix } = options;
    if (branch.startsWith(prefix) && branch.length > prefix.length) {
        const baseBranch = options.branches.includes('Dev')
            ? 'Dev'
            : options.defaultBranch;
        return { baseBranch, workingBranch: branch };
    }
    const name =
        slug(options.folder.split('/').filter(Boolean).pop() ?? '') ||
        slug(options.repo.split('/')[1] ?? '') ||
        'schema';
    return {
        baseBranch: branch,
        workingBranch: `${prefix}${name}-${slug(options.seed) || 'diagram'}`,
    };
};

/** The branch the import dialog suggests: `Dev` when the repository has one. */
export const suggestedBranch = (branches: {
    defaultBranch: string;
    branches: string[];
}): string =>
    branches.branches.includes('Dev') ? 'Dev' : branches.defaultBranch;

/** A diagram name for a repository folder, for example "Grassroots-Admin-Portal schema". */
export const repoDiagramName = (repo: string, folder: string): string => {
    const name = repo.split('/')[1] ?? repo;
    const last = folder.split('/').filter(Boolean).pop();
    return last ? `${name} ${last}` : name;
};

/** How the folder is labelled in the import dialog, for example "Grassroots-Admin-Portal · Dev". */
export const repoFolderLabel = (link: { repo: string; branch: string }) =>
    `${link.repo.split('/')[1] ?? link.repo} · ${link.branch}`;

export const toRepoSource = (
    diagramId: string,
    link: RepoFolderLink,
    selectedPaths: string[],
    now: number,
    generated?: Record<string, string | null>
): RepoSource => ({
    ...link,
    diagramId,
    files: link.files.map((file) => ({
        ...file,
        selected: selectedPaths.includes(file.path),
    })),
    linkedAt: now,
    pullRequestUrl: null,
    ...(generated ? { generated } : {}),
});
