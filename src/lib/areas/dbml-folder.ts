/**
 * A folder of DBML files (LuxDBDiagram).
 *
 * Purpose: turns the `.dbml` files of an opened folder into one importable text in which each
 * file becomes an Area, named after the file and showing the tables the file defines.
 * Scope: pure text work on files already read; reading folders is `folder-access.ts`.
 * Operational role: used by the DBML import dialog's folder mode, and by tests.
 *
 * Rules:
 * - Files are combined with `mergeDBMLFiles`: a table or enum defined identically in several
 *   files is kept once (the files' Areas all show it); two different definitions stop the
 *   import with both locations named.
 * - Each ticked file that defines tables gets an `Area "<file name>" [file: "<path>"]` block
 *   listing those tables. A file that writes its own Area blocks gets none, and neither does
 *   a file that another file's Area block names with `file:` (for example the Areas file
 *   LuxDBDiag writes when it saves a diagram as files).
 * - A file that repeats tables from at least two smaller files "looks combined" (for example
 *   a whole-schema export kept beside per-domain files) and starts unticked.
 */
import { extractAreaBlocks, type DBMLImportIssue } from './area-dbml';
import { findTopLevelBlocks } from './dbml-scanner';
import { mergeDBMLFiles } from './multi-file-dbml';

/** A file of an opened folder. */
export interface DBMLFolderFile {
    /** Path inside the folder, with `/` separators (for example `users.dbml`). */
    path: string;
    content: string;
    /** Whether the file is part of the import. */
    selected: boolean;
}

export interface DBMLFolderFileSummary {
    path: string;
    /** Table names as written in the file (quotes and schema kept, settings and alias removed). */
    tables: string[];
    /** True when the file writes its own Area blocks. */
    definesAreas: boolean;
    /** True when the file repeats tables from at least two smaller files. */
    looksCombined: boolean;
}

export interface ComposedFolderArea {
    name: string;
    fileName: string;
    tableCount: number;
}

export interface ComposedFolderDBML {
    /** Text to import: the merged files followed by one Area block per file. */
    content: string;
    areas: ComposedFolderArea[];
    /** Problems to show; any `error` stops the import. */
    issues: DBMLImportIssue[];
    /** Tables that are defined (identically) in more than one ticked file. */
    sharedTableCount: number;
}

/** Comment written before the generated Area blocks. */
export const FOLDER_AREAS_HEADER = '// ==== LuxDBDiag: one Area per file ====';

/**
 * Whether a path names a DBML file.
 *
 * @param path File path or name.
 * @returns True for `.dbml` files.
 */
export const isDBMLPath = (path: string): boolean => /\.dbml$/i.test(path);

/**
 * The file's name without folders or the `.dbml` extension.
 *
 * @param path File path.
 * @returns For example `users` for `domain/users.dbml`.
 */
export const fileStem = (path: string): string => {
    const base = path.split('/').pop() ?? path;
    return base.replace(/\.dbml$/i, '');
};

/** Reads the table name from a `Table` block header, keeping quotes and schema. */
const tableNameFromHeader = (header: string): string =>
    header
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\s+as\s+\S+\s*$/i, '')
        .replace(/\s*\.\s*/g, '.')
        .trim();

/** Comparable form of a table name: no quotes, lower case. */
const tableKey = (name: string): string => name.replace(/"/g, '').toLowerCase();

/**
 * Lists what each file defines and which files look like combined copies of the others.
 *
 * @param files Files of the folder.
 * @returns One summary per file, in the same order.
 */
export const summarizeFolderFiles = (
    files: readonly Pick<DBMLFolderFile, 'path' | 'content'>[]
): DBMLFolderFileSummary[] => {
    const parsed = files.map((file) => {
        const { blocks } = findTopLevelBlocks(file.content, ['table', 'area']);
        const tables = blocks
            .filter((block) => block.keyword.toLowerCase() === 'table')
            .map((block) => tableNameFromHeader(block.header))
            .filter(Boolean);
        return {
            path: file.path,
            tables,
            keys: new Set(tables.map(tableKey)),
            definesAreas: blocks.some(
                (block) => block.keyword.toLowerCase() === 'area'
            ),
        };
    });

    return parsed.map((file) => {
        const smallerSharing = parsed.filter(
            (other) =>
                other !== file &&
                other.keys.size > 0 &&
                other.keys.size < file.keys.size &&
                [...other.keys].some((key) => file.keys.has(key))
        );
        return {
            path: file.path,
            tables: file.tables,
            definesAreas: file.definesAreas,
            looksCombined: smallerSharing.length >= 2,
        };
    });
};

/**
 * Sets the starting selection: every file ticked except those that look combined.
 *
 * @param files Files as read from the folder, sorted by path.
 * @returns The files with `selected` set.
 */
export const withDefaultSelection = (
    files: readonly Pick<DBMLFolderFile, 'path' | 'content'>[]
): DBMLFolderFile[] => {
    const summaries = summarizeFolderFiles(files);
    return files.map((file, index) => ({
        path: file.path,
        content: file.content,
        selected: !summaries[index].looksCombined,
    }));
};

/** Escapes a value for a double-quoted DBML string. */
const quoted = (value: string): string =>
    `"${value.replace(/(["\\])/g, '\\$1')}"`;

/**
 * Builds the text to import from the ticked files.
 *
 * @param files Files of the folder; only `selected` ones are used, in the order given.
 * @returns The text, the Areas it creates, and the problems found.
 */
export const composeFolderDBML = (
    files: readonly DBMLFolderFile[]
): ComposedFolderDBML => {
    const selected = files.filter((file) => file.selected);
    const merged = mergeDBMLFiles(
        selected.map((file) => ({ name: file.path, content: file.content }))
    );
    const summaries = summarizeFolderFiles(selected);

    const stemCounts = new Map<string, number>();
    selected.forEach((file) => {
        const stem = fileStem(file.path).toLowerCase();
        stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
    });

    // Files already given an Area by a written Area block's `file:` setting.
    const claimed = new Set<string>();
    selected.forEach((file, index) => {
        if (!summaries[index].definesAreas) return;
        extractAreaBlocks(file.content).areas.forEach((area) => {
            if (area.fileName) claimed.add(area.fileName.toLowerCase());
        });
    });

    const areas: ComposedFolderArea[] = [];
    const blocks: string[] = [];
    const seenTableKeys = new Map<string, number>();

    selected.forEach((file, index) => {
        const summary = summaries[index];
        summary.tables.forEach((table) => {
            const key = tableKey(table);
            seenTableKeys.set(key, (seenTableKeys.get(key) ?? 0) + 1);
        });
        if (
            summary.definesAreas ||
            summary.tables.length === 0 ||
            claimed.has(file.path.toLowerCase())
        ) {
            return;
        }

        const stem = fileStem(file.path);
        // Two files with the same name in different folders keep their folder in the name.
        const name =
            (stemCounts.get(stem.toLowerCase()) ?? 0) > 1
                ? file.path.replace(/\.dbml$/i, '')
                : stem;
        const uniqueTables = [...new Set(summary.tables)];
        areas.push({
            name,
            fileName: file.path,
            tableCount: uniqueTables.length,
        });
        blocks.push(
            [
                `Area ${quoted(name)} [file: ${quoted(file.path)}] {`,
                ...uniqueTables.map((table) => `    ${table}`),
                '}',
            ].join('\n')
        );
    });

    const content =
        blocks.length > 0
            ? `${merged.content}\n\n${FOLDER_AREAS_HEADER}\n${blocks.join('\n\n')}\n`
            : merged.content;

    return {
        content,
        areas,
        // Identical repeats are expected when an Area's file holds a table that another file
        // also holds, so they are counted rather than listed.
        issues: merged.issues.filter(
            (issue) => issue.code !== 'file_duplicate_definition'
        ),
        sharedTableCount: [...seenTableKeys.values()].filter(
            (count) => count > 1
        ).length,
    };
};
