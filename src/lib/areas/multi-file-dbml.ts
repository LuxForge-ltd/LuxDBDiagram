/**
 * Multi-file DBML (LuxDBDiagram).
 *
 * Purpose: combines several DBML files into one text so a schema split across files (for
 * example one file per domain, with references between them) imports as a single schema.
 * Scope: text merging and duplicate detection. Parsing is still done by ChartDB's importer
 * on the merged text.
 * Operational role: used by the import dialogs when several files are opened, and by tests.
 *
 * Rules:
 * - Files are joined in the order given, each preceded by a `// ==== file: <name> ====` line,
 *   so the merged text shows where each part came from.
 * - A Table or Enum defined identically in two files is kept once; the repeat is removed and
 *   reported as a warning.
 * - Two different definitions of the same Table or Enum stop the import with an error naming
 *   both files and lines, because there must be one authoritative definition.
 * - Only the first Project block is kept (DBML allows one).
 * - Identical single-line Ref statements repeated across files are kept once.
 */
import type { DBMLImportIssue } from './area-dbml';
import {
    blankRange,
    findTopLevelBlocks,
    maskCommentsAndStrings,
    positionAt,
} from './dbml-scanner';

export interface DBMLSourceFile {
    name: string;
    content: string;
}

/** Where one file sits inside the merged text. */
export interface MergedFileRange {
    name: string;
    /** 1-based line in the merged text where the file's own first line is. */
    firstLine: number;
    lineCount: number;
}

export interface MergedDBML {
    content: string;
    files: MergedFileRange[];
    issues: DBMLImportIssue[];
}

/** The header line written before each file in the merged text. */
export const fileHeaderLine = (name: string) => `// ==== file: ${name} ====`;

/** First definition seen for a Table or Enum. */
interface Definition {
    file: string;
    line: number;
    normalized: string;
}

/** Normalises a block for comparison: no comments, collapsed whitespace. */
const normalizeBlock = (text: string): string =>
    maskCommentsAndStrings(text, { maskStrings: false })
        .masked.replace(/\s+/g, ' ')
        .trim();

/** Reads the (possibly schema-qualified) name from a Table or Enum header. */
const definitionName = (header: string): string => {
    const withoutSettings = header.replace(/\[[^\]]*\]/g, '');
    const withoutAlias = withoutSettings.replace(/\s+as\s+\S+\s*$/i, '');
    return withoutAlias.replace(/["\s]/g, '').toLowerCase();
};

/**
 * Merges DBML files into one text.
 *
 * @param files Files in the order they should be combined.
 * @returns The merged text, where each file sits in it, and the problems found. When any
 *          issue has severity `error`, the merged text must not be imported.
 */
export const mergeDBMLFiles = (
    files: readonly DBMLSourceFile[]
): MergedDBML => {
    const issues: DBMLImportIssue[] = [];
    const definitions = new Map<string, Definition>();
    const seenRefs = new Set<string>();
    let projectSeen = false;

    const parts: string[] = [];
    const ranges: MergedFileRange[] = [];
    let nextLine = 1;

    for (const file of files) {
        let content = file.content.replace(/\r\n?/g, '\n');
        const { blocks } = findTopLevelBlocks(content, [
            'table',
            'enum',
            'project',
            'ref',
        ]);

        // Work backwards so blanking a block never shifts the indices of earlier ones.
        const removals: { start: number; end: number }[] = [];

        for (const block of blocks) {
            const keyword = block.keyword.toLowerCase();
            const { line } = positionAt(content, block.start);

            if (keyword === 'project') {
                if (projectSeen) {
                    issues.push({
                        severity: 'warning',
                        code: 'file_duplicate_project',
                        message: `Only one Project block is allowed; the one in ${file.name} was left out.`,
                        file: file.name,
                        line,
                    });
                    removals.push(block);
                }
                projectSeen = true;
                continue;
            }

            if (keyword === 'ref') {
                const key = normalizeBlock(
                    content.slice(block.start, block.end)
                );
                if (seenRefs.has(key)) removals.push(block);
                seenRefs.add(key);
                continue;
            }

            const name = `${keyword}:${definitionName(block.header)}`;
            const normalized = normalizeBlock(
                content.slice(block.start, block.end)
            );
            const first = definitions.get(name);
            const label = `${keyword === 'table' ? 'Table' : 'Enum'} "${definitionName(block.header)}"`;

            if (!first) {
                definitions.set(name, { file: file.name, line, normalized });
                continue;
            }

            if (first.normalized === normalized) {
                issues.push({
                    severity: 'warning',
                    code: 'file_duplicate_definition',
                    message: `${label} is defined identically in ${first.file} (line ${first.line}) and ${file.name} (line ${line}); the copy in ${file.name} was left out.`,
                    file: file.name,
                    line,
                });
                removals.push(block);
            } else {
                issues.push({
                    severity: 'error',
                    code: 'file_conflicting_definition',
                    message: `${label} has two different definitions: ${first.file} (line ${first.line}) and ${file.name} (line ${line}). Keep one authoritative definition.`,
                    file: file.name,
                    line,
                });
            }
        }

        // Blanking keeps the text length, so block indices stay valid; single-line Refs are
        // handled afterwards because removing them changes line lengths.
        for (const removal of removals.reverse()) {
            content = blankRange(content, removal.start, removal.end);
        }
        content = collectSingleLineRefDuplicates(content, seenRefs);

        const header = fileHeaderLine(file.name);
        const lineCount = content.split('\n').length;
        parts.push(`${header}\n${content}`);
        ranges.push({ name: file.name, firstLine: nextLine + 1, lineCount });
        nextLine += 1 + lineCount + 1; // header, file, blank separator line
    }

    return { content: parts.join('\n\n'), files: ranges, issues };
};

/**
 * Blanks single-line `Ref: a.b > c.d` statements already seen in an earlier file, so the
 * DBML parser does not reject them as duplicate references.
 */
const collectSingleLineRefDuplicates = (
    content: string,
    seenRefs: Set<string>
): string => {
    const { masked } = maskCommentsAndStrings(content);
    const lines = content.split('\n');
    const maskedLines = masked.split('\n');
    let depth = 0;

    return lines
        .map((line, index) => {
            const maskedLine = maskedLines[index] ?? '';
            const startsAtTop = depth === 0;
            for (const char of maskedLine) {
                if (char === '{') depth++;
                else if (char === '}') depth = Math.max(0, depth - 1);
            }

            const isSingleLineRef =
                startsAtTop &&
                /^\s*ref\b[^{]*:/i.test(maskedLine) &&
                !maskedLine.includes('{');
            if (!isSingleLineRef) return line;

            const key = normalizeBlock(line);
            if (seenRefs.has(key)) return '';
            seenRefs.add(key);
            return line;
        })
        .join('\n');
};

/**
 * Maps a line in the merged text back to the file and line it came from, for messages.
 *
 * @param files Ranges from `mergeDBMLFiles`.
 * @param mergedLine 1-based line in the merged text.
 * @returns The file name and 1-based line in that file, or null for header lines.
 */
export const locateMergedLine = (
    files: readonly MergedFileRange[],
    mergedLine: number
): { file: string; line: number } | null => {
    for (const range of files) {
        const last = range.firstLine + range.lineCount - 1;
        if (mergedLine >= range.firstLine && mergedLine <= last) {
            return { file: range.name, line: mergedLine - range.firstLine + 1 };
        }
    }
    return null;
};

/**
 * Maps a line of merged DBML back to its source file using the `// ==== file: ... ====`
 * header lines, so an error found in text pasted or loaded into the editor (where the file
 * ranges are no longer known) can still name the file and line.
 *
 * @param content Merged DBML text.
 * @param line 1-based line in that text.
 * @returns The file and 1-based line in it, or null when the text has no file headers.
 */
export const locateLineByFileHeaders = (
    content: string,
    line: number
): { file: string; line: number } | null => {
    const lines = content.split('\n');
    for (let index = Math.min(line, lines.length) - 1; index >= 0; index--) {
        const header = /^\/\/ ==== file: (.+) ====$/.exec(lines[index]);
        if (header) {
            const fileLine = line - (index + 1);
            return fileLine > 0 ? { file: header[1], line: fileLine } : null;
        }
    }
    return null;
};
