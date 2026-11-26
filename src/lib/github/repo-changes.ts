/**
 * What saving a diagram back to its repository would change (LuxDBDiagram).
 *
 * Purpose: compares the diagram's files, as LuxDBDiag writes them (one per Area, see
 * `src/lib/areas/area-files.ts`), with the files of the repository folder it came from, so only
 * files whose tables changed are committed. Unchanged files are left exactly as they are on GitHub,
 * comments included.
 *
 * How "changed" is decided: when the diagram is linked, and after each commit, the text LuxDBDiag
 * would write for each file is kept as a baseline (`RepoSource.generated`). A file is changed when
 * LuxDBDiag would now write something different from its baseline. A file edited in the import
 * editor before importing has no baseline (null), so it counts as changed. Without a baseline, a
 * file is changed when its text differs from GitHub's.
 */
import type { Diagram } from '@/lib/domain/diagram';
import { generateAreaFiles, type AreaFile } from '@/lib/areas/area-files';
import type { RepoSource, RepoSourceFile } from './repo-source';

export type RepoFileRole = 'area' | 'unassigned' | 'layout';

export interface RepoFileChange {
    /** Path relative to the folder. */
    path: string;
    kind: 'changed' | 'new';
    role: RepoFileRole;
    /** GitHub's text, or null for a new file. */
    before: string | null;
    after: string;
    /** GitHub's SHA for the file, or null for a new file. */
    expectedSha: string | null;
    tableCount: number;
    /** Whether the file is ticked to commit at first. */
    selected: boolean;
    /**
     * How a changed file is written (set by `repo-in-place.ts`): its own text with only the
     * diagram's changes, or rewritten whole by the exporter.
     */
    method?: 'in-place' | 'rewritten';
    /** For a rewritten file: why it could not be edited in place. */
    rewriteReason?: string;
    /** For a rewritten file: how many of GitHub's lines hold comments, which the rewrite drops. */
    lostCommentLines?: number;
}

export interface RepoChanges {
    changes: RepoFileChange[];
    /** Files LuxDBDiag writes that have not changed: left as they are. */
    unchanged: string[];
    /** Imported files that no Area writes any more: listed, never deleted. */
    removed: string[];
    /** Files that were not imported (combined copies): left alone. */
    untouched: string[];
    /** The exporter's warnings (for example tables with no columns). */
    warnings: string[];
}

interface GeneratedFile extends AreaFile {
    role: RepoFileRole;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The diagram with its tables, relationships and custom types in a fixed order. ChartDB's storage
 * returns them ordered by their (random) ids, not as imported, and the files' text follows that
 * order; without this, reopening a diagram would make every file look changed.
 */
export const inFixedOrder = (diagram: Diagram): Diagram => ({
    ...diagram,
    tables: [...(diagram.tables ?? [])].sort(
        (a, b) =>
            byText(
                `${a.schema ?? ''}.${a.name}`,
                `${b.schema ?? ''}.${b.name}`
            ) || byText(a.id, b.id)
    ),
    relationships: [...(diagram.relationships ?? [])].sort(
        (a, b) => byText(a.name ?? '', b.name ?? '') || byText(a.id, b.id)
    ),
    ...(diagram.customTypes
        ? {
              customTypes: [...diagram.customTypes].sort(
                  (a, b) =>
                      byText(
                          `${a.schema ?? ''}.${a.name}`,
                          `${b.schema ?? ''}.${b.name}`
                      ) || byText(a.id, b.id)
              ),
          }
        : {}),
});

const generatedFiles = (diagram: Diagram) => {
    const { files, layout, warnings } = generateAreaFiles(
        inFixedOrder(diagram)
    );
    const all: GeneratedFile[] = [
        ...files.map((file) => ({
            ...file,
            role: (file.areaId ? 'area' : 'unassigned') as RepoFileRole,
        })),
        ...(layout ? [{ ...layout, role: 'layout' as const }] : []),
    ];
    return { files: all, warnings };
};

/**
 * The baseline kept when a diagram is linked: what LuxDBDiag writes for each file now, or null for
 * a file whose imported text differs from GitHub's (edited before importing).
 *
 * @param imported The files as imported (possibly edited in the import editor).
 * @param onGitHub The files as GitHub has them.
 */
export const repoBaseline = (
    diagram: Diagram,
    imported: { path: string; content: string }[],
    onGitHub: { path: string; content: string }[]
): Record<string, string | null> => {
    const original = new Map(onGitHub.map((file) => [file.path, file.content]));
    const edited = new Set(
        imported
            .filter((file) => original.get(file.path) !== file.content)
            .map((file) => file.path)
    );
    const baseline: Record<string, string | null> = {};
    for (const file of generatedFiles(diagram).files) {
        baseline[file.path] = edited.has(file.path) ? null : file.content;
    }
    return baseline;
};

/**
 * Files edited in the import editor before importing: their text as imported and what LuxDBDiag
 * wrote for them then, so a later save can edit that text in place.
 *
 * @param imported The files as imported (possibly edited in the import editor).
 * @param onGitHub The files as GitHub has them.
 */
export const repoEditedFiles = (
    diagram: Diagram,
    imported: { path: string; content: string }[],
    onGitHub: { path: string; content: string }[]
): Record<string, { text: string; generated: string }> => {
    const original = new Map(onGitHub.map((file) => [file.path, file.content]));
    const generated = new Map(
        generatedFiles(diagram).files.map((file) => [file.path, file.content])
    );
    const edited: Record<string, { text: string; generated: string }> = {};
    for (const file of imported) {
        const written = generated.get(file.path);
        if (original.get(file.path) !== file.content && written !== undefined) {
            edited[file.path] = { text: file.content, generated: written };
        }
    }
    return edited;
};

export const repoChanges = (
    diagram: Diagram,
    source: RepoSource
): RepoChanges => {
    const { files, warnings } = generatedFiles(diagram);
    const onGitHub = new Map(source.files.map((file) => [file.path, file]));
    const written = new Set(files.map((file) => file.path));
    const changes: RepoFileChange[] = [];
    const unchanged: string[] = [];

    for (const file of files) {
        const existing = onGitHub.get(file.path);
        if (existing) {
            const baseline = source.generated?.[file.path];
            const same =
                existing.content === file.content ||
                (typeof baseline === 'string' && baseline === file.content);
            if (same) {
                unchanged.push(file.path);
                continue;
            }
            changes.push({
                path: file.path,
                kind: 'changed',
                role: file.role,
                before: existing.content,
                after: file.content,
                expectedSha: existing.sha,
                tableCount: file.tableCount,
                selected: true,
            });
        } else {
            // An empty Area has nothing to write yet.
            if (file.role === 'area' && file.tableCount === 0) continue;
            changes.push({
                path: file.path,
                kind: 'new',
                role: file.role,
                before: null,
                after: file.content,
                expectedSha: null,
                tableCount: file.tableCount,
                // The Areas file is committed only when ticked (or when it is already there).
                selected: file.role !== 'layout',
            });
        }
    }

    const notWritten = source.files.filter((file) => !written.has(file.path));
    return {
        changes: changes.sort((a, b) => a.path.localeCompare(b.path)),
        unchanged: unchanged.sort((a, b) => a.localeCompare(b)),
        // An empty file on GitHub has no Area to write it; it is not "removed".
        removed: notWritten
            .filter((file) => file.selected && file.content.trim() !== '')
            .map((file) => file.path),
        untouched: notWritten
            .filter((file) => !file.selected)
            .map((file) => file.path),
        warnings,
    };
};

/**
 * The link after a commit: committed files are now GitHub's text, and what LuxDBDiag writes now
 * is the baseline for every file except changed files left unticked, which stay changed.
 */
export const afterCommit = (
    source: RepoSource,
    diagram: Diagram,
    committed: {
        path: string;
        content: string;
        sha: string;
        kind: 'changed' | 'new';
        /** Whether the file was rewritten whole by the exporter. */
        rewritten?: boolean;
    }[],
    result: { kind: 'committed' | 'unchanged'; branch: string; commit: string }
): RepoSource => {
    const done = new Map(committed.map((file) => [file.path, file]));
    // A committed file is GitHub's text from now on, edited or not.
    const editedFiles = Object.fromEntries(
        Object.entries(source.editedFiles ?? {}).filter(
            ([path]) => !done.has(path)
        )
    );
    const files: RepoSourceFile[] = source.files.map((file) => {
        const update = done.get(file.path);
        return update
            ? {
                  ...file,
                  content: update.content,
                  sha: update.sha,
                  selected: true,
              }
            : file;
    });
    for (const file of committed) {
        if (!source.files.some((existing) => existing.path === file.path)) {
            files.push({
                path: file.path,
                content: file.content,
                sha: file.sha,
                selected: true,
            });
        }
    }

    const pending = new Set(
        repoChanges(diagram, source)
            .changes.filter((change) => !done.has(change.path))
            .map((change) => change.path)
    );
    const generated: Record<string, string | null> = {
        ...(source.generated ?? {}),
    };
    for (const file of generatedFiles(diagram).files) {
        if (!pending.has(file.path)) generated[file.path] = file.content;
    }

    if (result.kind === 'unchanged') {
        return {
            ...source,
            files: files.sort((a, b) => a.path.localeCompare(b.path)),
            generated,
            editedFiles,
        };
    }

    const committedFiles = new Map(
        (source.committedFiles ?? []).map((file) => [file.path, file])
    );
    for (const file of committed) {
        const previous = committedFiles.get(file.path);
        committedFiles.set(file.path, {
            path: file.path,
            kind: previous?.kind ?? file.kind,
            ...(file.rewritten || previous?.rewritten
                ? { rewritten: true }
                : {}),
        });
    }

    return {
        ...source,
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
        generated,
        editedFiles,
        workingBranch: result.branch,
        lastCommit: result.commit,
        committedFiles: [...committedFiles.values()].sort((a, b) =>
            a.path.localeCompare(b.path)
        ),
    };
};

/** A commit message for the ticked files. */
export const defaultCommitMessage = (changes: RepoFileChange[]): string => {
    const names = changes.map((change) => change.path);
    if (names.length === 1) return `Update ${names[0]} from LuxDBDiag`;
    return `Update ${names.length} schema files from LuxDBDiag`;
};

/** The pull request description: what changed, and how. */
export const pullRequestBody = (
    changes: { path: string; kind: 'changed' | 'new'; rewritten?: boolean }[]
): string =>
    [
        'Schema changes saved from LuxDBDiag.',
        '',
        ...changes.map(
            (change) =>
                `- ${change.kind === 'new' ? 'Added' : 'Updated'} \`${change.path}\`${
                    change.rewritten
                        ? ' (rewritten whole by the DBML exporter, without its comments)'
                        : ''
                }`
        ),
        '',
        'Updated files are edited in place: only the tables, columns and relationships that changed in the diagram are changed, and comments are kept. New tables and relationships are added at the end of the file.',
    ].join('\n');
