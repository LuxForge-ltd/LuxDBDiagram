/**
 * DBML source scanner (LuxDBDiagram).
 *
 * Purpose: finds top-level DBML blocks (such as `Area`, `Table`, `Enum`, `Project`) while
 * ignoring anything inside comments and strings, and reports positions as line and column.
 * Scope: text scanning only; it does not interpret DBML. ChartDB's own parser (@dbml/core)
 * still parses the schema.
 * Operational role: lets the enhanced DBML importer lift `Area` blocks out before ChartDB
 * parses the file, and lets the multi-file merger find duplicate definitions across files.
 */

/** A 1-based line and column in the original text. */
export interface SourcePosition {
    line: number;
    column: number;
}

/** A top-level `Keyword ... { ... }` block found in DBML text. */
export interface TopLevelBlock {
    /** The keyword as written (for example `Area` or `table`). */
    keyword: string;
    /** Index of the keyword's first character. */
    start: number;
    /** Index of the opening brace. */
    openBrace: number;
    /** Index of the closing brace. */
    closeBrace: number;
    /** Index just after the closing brace. */
    end: number;
    /** Original text between the keyword and the opening brace. */
    header: string;
    /** Original text between the braces. */
    body: string;
}

/** A block that started like a top-level block but could not be completed. */
export interface MalformedBlock {
    keyword: string;
    start: number;
    reason: 'missing_open_brace' | 'missing_close_brace';
}

export interface MaskResult {
    /** Same length as the input, with masked characters replaced by spaces (newlines kept). */
    masked: string;
    /** Number of `//` line comments seen. */
    lineComments: number;
}

/**
 * Converts a character index into a 1-based line and column.
 *
 * @param content The text.
 * @param index Character index into `content`.
 * @returns The line and column of that character.
 */
export const positionAt = (content: string, index: number): SourcePosition => {
    const before = content.slice(0, Math.max(0, index));
    const lines = before.split('\n');
    return { line: lines.length, column: lines[lines.length - 1].length + 1 };
};

/**
 * Blanks out comments and, optionally, string literals, keeping every newline so indices and
 * line numbers still line up with the original text.
 *
 * Handles `//` and block comments, single, double and triple-quoted strings, and backtick
 * expressions, including backslash escapes inside quotes.
 *
 * @param content DBML text.
 * @param options `maskStrings: false` keeps string literals (only comments are blanked).
 * @returns The masked text and how many line comments it had.
 */
export const maskCommentsAndStrings = (
    content: string,
    options: { maskStrings?: boolean } = {}
): MaskResult => {
    const maskStrings = options.maskStrings ?? true;
    const out: string[] = new Array(content.length);
    let lineComments = 0;
    let index = 0;

    const blank = (from: number, to: number, keep: boolean) => {
        for (let i = from; i < to; i++) {
            out[i] = keep || content[i] === '\n' ? content[i] : ' ';
        }
    };

    while (index < content.length) {
        const char = content[index];
        const next = content[index + 1];

        if (char === '/' && next === '/') {
            const endOfLine = content.indexOf('\n', index);
            const stop = endOfLine === -1 ? content.length : endOfLine;
            lineComments++;
            blank(index, stop, false);
            index = stop;
            continue;
        }

        if (char === '/' && next === '*') {
            const close = content.indexOf('*/', index + 2);
            const stop = close === -1 ? content.length : close + 2;
            blank(index, stop, false);
            index = stop;
            continue;
        }

        const stringEnd = findStringEnd(content, index);
        if (stringEnd !== -1) {
            blank(index, stringEnd, !maskStrings);
            index = stringEnd;
            continue;
        }

        out[index] = char;
        index++;
    }

    return { masked: out.join(''), lineComments };
};

/**
 * If a string literal starts at `index`, returns the index just after it; otherwise -1.
 * An unterminated literal runs to the end of the text.
 */
const findStringEnd = (content: string, index: number): number => {
    const char = content[index];

    if (char === "'" && content.startsWith("'''", index)) {
        const close = content.indexOf("'''", index + 3);
        return close === -1 ? content.length : close + 3;
    }

    if (char === "'" || char === '"' || char === '`') {
        let cursor = index + 1;
        while (cursor < content.length) {
            if (content[cursor] === '\\' && char !== '`') {
                cursor += 2;
                continue;
            }
            if (content[cursor] === char) {
                return cursor + 1;
            }
            // Single and double-quoted strings never span lines in DBML.
            if (content[cursor] === '\n' && char !== '`') {
                return cursor;
            }
            cursor++;
        }
        return content.length;
    }

    return -1;
};

/**
 * Finds the brace that closes the one at `openIndex`, in masked text.
 *
 * @returns The closing brace's index, or -1 when it is missing.
 */
const findClosingBrace = (masked: string, openIndex: number): number => {
    let depth = 0;
    for (let i = openIndex; i < masked.length; i++) {
        if (masked[i] === '{') depth++;
        else if (masked[i] === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
};

/**
 * Finds the opening brace of a block whose keyword ends at `from`. The header may continue
 * on the same line; the brace may also sit alone on a following line. Anything else on a
 * following line means the block has no brace.
 *
 * @returns The opening brace's index, or -1 when it is missing.
 */
const findOpeningBrace = (masked: string, from: number): number => {
    let sawNewline = false;
    for (let i = from; i < masked.length; i++) {
        const char = masked[i];
        if (char === '{') return i;
        if (char === '}') return -1;
        if (char === '\n') {
            sawNewline = true;
            continue;
        }
        if (sawNewline && !/\s/.test(char)) return -1;
    }
    return -1;
};

/**
 * Finds top-level blocks whose keyword matches `keywords`. A keyword counts only when it is
 * the first word on its line and outside every other block, comment and string.
 *
 * @param content Original DBML text.
 * @param keywords Keywords to look for, compared case-insensitively (for example ['area']).
 * @returns The complete blocks found, in order, and any that were malformed.
 */
export const findTopLevelBlocks = (
    content: string,
    keywords: readonly string[]
): { blocks: TopLevelBlock[]; malformed: MalformedBlock[] } => {
    const { masked } = maskCommentsAndStrings(content);
    const wanted = new Set(keywords.map((k) => k.toLowerCase()));
    const blocks: TopLevelBlock[] = [];
    const malformed: MalformedBlock[] = [];
    let depth = 0;
    let index = 0;

    while (index < masked.length) {
        const atLineStart = index === 0 || masked[index - 1] === '\n';

        if (atLineStart && depth === 0) {
            const lineMatch = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)/.exec(
                masked.slice(index, index + 200)
            );
            const word = lineMatch?.[1];

            if (word && wanted.has(word.toLowerCase())) {
                const start = index + lineMatch[0].length - word.length;
                const afterKeyword = start + word.length;
                const nextChar = masked[afterKeyword] ?? '';

                // `Area:` or `Area.x` is not a block keyword (for example a Ref to a table
                // named Area), so only whitespace or a brace may follow the keyword.
                if (nextChar === '' || /[\s{"]/.test(nextChar)) {
                    const openBrace = findOpeningBrace(masked, afterKeyword);
                    if (openBrace === -1) {
                        malformed.push({
                            keyword: word,
                            start,
                            reason: 'missing_open_brace',
                        });
                        index = afterKeyword;
                        continue;
                    }

                    const closeBrace = findClosingBrace(masked, openBrace);
                    if (closeBrace === -1) {
                        malformed.push({
                            keyword: word,
                            start,
                            reason: 'missing_close_brace',
                        });
                        // Nothing after an unclosed block can be trusted.
                        break;
                    }

                    blocks.push({
                        keyword: word,
                        start,
                        openBrace,
                        closeBrace,
                        end: closeBrace + 1,
                        header: content.slice(afterKeyword, openBrace),
                        body: content.slice(openBrace + 1, closeBrace),
                    });
                    index = closeBrace + 1;
                    continue;
                }
            }
        }

        if (masked[index] === '{') depth++;
        else if (masked[index] === '}') depth = Math.max(0, depth - 1);
        index++;
    }

    return { blocks, malformed };
};

/**
 * Replaces a range of text with spaces, keeping newlines, so later line numbers (for example
 * in parser errors) still match the original file.
 *
 * @param content The text.
 * @param start First index to blank.
 * @param end Index just after the last one to blank.
 * @returns The text with that range blanked.
 */
export const blankRange = (
    content: string,
    start: number,
    end: number
): string =>
    content.slice(0, start) +
    content.slice(start, end).replace(/[^\n]/g, ' ') +
    content.slice(end);
