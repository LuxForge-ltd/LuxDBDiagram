/**
 * Editing a DBML file in place (LuxDBDiagram).
 *
 * Purpose: when a diagram opened from DBML files is saved back, only what the diagram changed is
 * changed in each file's own text, so its comments, its Project block, its commented-out drafts,
 * its table order and its author's layout are kept.
 * Scope: text only. It compares two texts LuxDBDiag wrote for the file (when the file was read,
 * and now), which are in the exporter's regular form, and applies the differences to the file's
 * own text. It never interprets DBML beyond tables, columns, notes, indexes, enums and
 * relationships; anything else in the file is left exactly as it is.
 * Operational role: used by Save to repository (`src/lib/github/repo-in-place.ts`), which checks
 * each result by importing it before offering it.
 *
 * What changes in the file's text:
 * - A changed table keeps its header, comments and untouched lines. Changed column lines are
 *   rewritten (keeping the column's name as written, its inline `ref:` settings that still hold,
 *   and its trailing comment); new columns go after the column before them; deleted columns'
 *   lines are removed. A changed table note or `indexes` block is replaced, added or removed.
 * - A new table, enum or relationship is added at the end of the file, as the exporter writes it.
 * - A deleted table, enum or relationship is removed from wherever the file has it, inline `ref:`
 *   settings included. One the file does not have is left to the files that do.
 */
import {
    findTopLevelBlocks,
    maskCommentsAndStrings,
    type TopLevelBlock,
} from './dbml-scanner';

export type InPlaceResult =
    | { ok: true; content: string }
    | { ok: false; reason: string };

const BLOCK_KEYWORDS = [
    'table',
    'enum',
    'ref',
    'project',
    'tablegroup',
    'tablepartial',
    'note',
    'records',
];

interface InlineRef {
    key: string;
    /** The item as written, for example `ref: > users.user_id`. */
    text: string;
}

interface ParsedColumn {
    key: string;
    /** The name as written, quotes included. */
    name: string;
    lineStart: number;
    defStart: number;
    defEnd: number;
    /** Index of the newline ending the column's last line (or of the table's closing brace). */
    lineEnd: number;
    /** Whether the column has its lines to itself (nothing but a comment beside it). */
    ownLines: boolean;
    /** Indices of the settings brackets, when the column has settings. */
    settings: { open: number; close: number } | null;
    settingItems: string[];
    inlineRefs: InlineRef[];
}

interface ParsedPart {
    lineStart: number;
    defStart: number;
    defEnd: number;
    lineEnd: number;
    ownLines: boolean;
    text: string;
}

interface ParsedTable {
    key: string;
    block: TopLevelBlock;
    headerRest: string;
    columns: ParsedColumn[];
    note: ParsedPart | null;
    indexes: ParsedPart | null;
    others: string[];
    text: string;
}

interface ParsedRef {
    /** The two ends, in a fixed order. */
    key: string;
    /** The relationship without its name, for comparing. */
    canonical: string;
    kind: 'line' | 'block' | 'inline';
    start: number;
    end: number;
    text: string;
}

interface ParsedEnum {
    key: string;
    block: TopLevelBlock;
    text: string;
}

interface ParsedDBML {
    text: string;
    tables: ParsedTable[];
    refs: ParsedRef[];
    enums: ParsedEnum[];
    others: string[];
}

class InPlaceError extends Error {}

const fail = (reason: string): never => {
    throw new InPlaceError(reason);
};

/** Collapses runs of whitespace, for comparing text. */
const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

const lineStartOf = (text: string, index: number) =>
    text.lastIndexOf('\n', index - 1) + 1;

const lineEndOf = (text: string, index: number) => {
    const end = text.indexOf('\n', index);
    return end === -1 ? text.length : end;
};

/** Index just after the newline ending the line that `lineEnd` points into. */
const afterLine = (text: string, lineEnd: number) =>
    text[lineEnd] === '\n' ? lineEnd + 1 : lineEnd;

const isBlank = (value: string) => value.trim() === '';

/**
 * Reads a dotted name such as `users`, `public.users`, `"public"."users"` or `t.(a, b)` from
 * `text` at `from`, skipping leading whitespace.
 */
const readPath = (
    text: string,
    from: number
): { parts: string[]; end: number } | null => {
    let index = from;
    while (index < text.length && /\s/.test(text[index])) index++;
    const parts: string[] = [];
    for (;;) {
        const char = text[index];
        if (char === '"') {
            const close = text.indexOf('"', index + 1);
            if (close === -1) return null;
            parts.push(text.slice(index + 1, close));
            index = close + 1;
        } else if (char === '(') {
            const close = text.indexOf(')', index + 1);
            if (close === -1) return null;
            const names = text
                .slice(index + 1, close)
                .split(',')
                .map((name) => name.trim().replace(/^"(.*)"$/s, '$1'));
            parts.push(`(${names.join(',')})`);
            index = close + 1;
        } else {
            const match = /^[A-Za-z0-9_$]+/.exec(text.slice(index));
            if (!match) return null;
            parts.push(match[0]);
            index += match[0].length;
        }
        let next = index;
        while (text[next] === ' ' || text[next] === '\t') next++;
        if (text[next] !== '.') break;
        index = next + 1;
        while (text[index] === ' ' || text[index] === '\t') index++;
    }
    return parts.length > 0 ? { parts, end: index } : null;
};

/** `schema.table` in lower case, adding the default schema. */
const tableKeyOf = (parts: string[], defaultSchema: string) =>
    (parts.length === 1
        ? `${defaultSchema}.${parts[0]}`
        : `${parts[0]}.${parts[1]}`
    ).toLowerCase();

/** `schema.table.column` in lower case, adding the default schema. */
const endpointOf = (parts: string[], defaultSchema: string): string | null => {
    if (parts.length === 2) {
        return `${defaultSchema}.${parts[0]}.${parts[1]}`.toLowerCase();
    }
    if (parts.length === 3) return parts.join('.').toLowerCase();
    return null;
};

const FLIPPED: Record<string, string> = {
    '<': '>',
    '>': '<',
    '-': '-',
    '<>': '<>',
};

/** The key and name-free form of a relationship between `from` and `to`. */
const relationOf = (
    from: string,
    op: string,
    to: string,
    settings: string
): { key: string; canonical: string } => {
    const ordered = from <= to;
    const key = ordered ? `${from} | ${to}` : `${to} | ${from}`;
    const canonical = ordered
        ? `${from} ${op} ${to}`
        : `${to} ${FLIPPED[op]} ${from}`;
    return { key, canonical: `${canonical} ${squash(settings)}`.trim() };
};

/** Reads `A op B [settings]` from `text` at `from`. */
const readRelation = (
    text: string,
    from: number,
    defaultSchema: string
): { key: string; canonical: string } | null => {
    const left = readPath(text, from);
    if (!left) return null;
    const opMatch = /^\s*(<>|<|>|-)/.exec(text.slice(left.end));
    if (!opMatch) return null;
    const right = readPath(text, left.end + opMatch[0].length);
    if (!right) return null;
    const rest = text.slice(right.end).trim();
    if (rest !== '' && !/^\[[\s\S]*\]$/.test(rest)) return null;
    const a = endpointOf(left.parts, defaultSchema);
    const b = endpointOf(right.parts, defaultSchema);
    if (!a || !b) return null;
    return relationOf(a, opMatch[1], b, rest);
};

/** Splits `text` (between brackets) at top-level commas, using `structure` for the depth. */
const splitItems = (
    text: string,
    structure: string,
    start: number,
    end: number
): { start: number; end: number }[] => {
    const items: { start: number; end: number }[] = [];
    let depth = 0;
    let itemStart = start;
    for (let index = start; index <= end; index++) {
        const char = index < end ? structure[index] : ',';
        if (char === '(' || char === '[' || char === '{') depth++;
        else if (char === ')' || char === ']' || char === '}') depth--;
        else if (char === ',' && depth === 0) {
            let from = itemStart;
            let to = index;
            while (from < to && /\s/.test(text[from])) from++;
            while (to > from && /\s/.test(text[to - 1])) to--;
            if (to > from) items.push({ start: from, end: to });
            itemStart = index + 1;
        }
    }
    return items;
};

interface Element {
    lineStart: number;
    defStart: number;
    defEnd: number;
    lineEnd: number;
    ownLines: boolean;
}

/**
 * Finds the elements (columns, notes, `indexes` blocks and so on) between a table's braces. An
 * element ends at the first newline outside brackets, braces and parentheses. `structure` has
 * comments and strings blanked (for the nesting); `noComments` only comments (quoted names
 * such as `"user_id"` are strings to the scanner).
 */
const tableElements = (
    text: string,
    structure: string,
    noComments: string,
    block: TopLevelBlock
): Element[] => {
    const elements: Element[] = [];
    const stop = block.closeBrace;
    let index = block.openBrace + 1;
    while (index < stop) {
        if (/\s/.test(noComments[index])) {
            index++;
            continue;
        }
        const defStart = index;
        let depth = 0;
        let cursor = index;
        for (; cursor < stop; cursor++) {
            const char = structure[cursor];
            if (char === '{' || char === '[' || char === '(') depth++;
            else if (char === '}' || char === ']' || char === ')') depth--;
            else if (char === '\n' && depth <= 0) break;
        }
        if (depth > 0) fail('a table could not be read');
        let defEnd = cursor;
        while (defEnd > defStart && /\s/.test(noComments[defEnd - 1])) defEnd--;
        const lineStart = lineStartOf(text, defStart);
        const lineEnd = Math.min(lineEndOf(text, defEnd), stop);
        elements.push({
            lineStart,
            defStart,
            defEnd,
            lineEnd,
            ownLines:
                isBlank(noComments.slice(lineStart, defStart)) &&
                lineEnd < stop &&
                isBlank(noComments.slice(defEnd, lineEnd)),
        });
        index = cursor;
    }
    return elements;
};

const parseColumn = (
    text: string,
    structure: string,
    noComments: string,
    element: Element,
    tableKey: string,
    defaultSchema: string
): ParsedColumn => {
    const { defStart, defEnd } = element;
    let nameEnd: number;
    if (text[defStart] === '"') {
        const close = text.indexOf('"', defStart + 1);
        if (close === -1 || close >= defEnd)
            fail('a column name could not be read');
        nameEnd = close + 1;
    } else {
        const match = /^[A-Za-z0-9_$]+/.exec(text.slice(defStart, defEnd));
        if (!match) fail('a column could not be read');
        nameEnd = defStart + match![0].length;
    }
    const name = text.slice(defStart, nameEnd);
    const key = name.replace(/^"(.*)"$/s, '$1').toLowerCase();

    // The settings are the bracket group ending the column (`text[]` is a type, not settings).
    let settings: ParsedColumn['settings'] = null;
    if (structure[defEnd - 1] === ']') {
        let depth = 0;
        let open = -1;
        for (let index = defEnd - 1; index >= nameEnd; index--) {
            const char = structure[index];
            if (char === ']') depth++;
            else if (char === '[') {
                depth--;
                if (depth === 0) {
                    open = index;
                    break;
                }
            }
        }
        if (
            open !== -1 &&
            (/\s/.test(text[open - 1] ?? '') ||
                !isBlank(noComments.slice(open + 1, defEnd - 1)))
        ) {
            settings = { open, close: defEnd - 1 };
        }
    }

    const settingItems: string[] = [];
    const inlineRefs: InlineRef[] = [];
    if (settings) {
        for (const item of splitItems(
            noComments,
            structure,
            settings.open + 1,
            settings.close
        )) {
            const itemText = noComments.slice(item.start, item.end);
            settingItems.push(itemText);
            const refMatch = /^ref\s*:\s*/i.exec(itemText);
            if (!refMatch) continue;
            const opMatch = /^(<>|<|>|-)/.exec(
                itemText.slice(refMatch[0].length)
            );
            const target = opMatch
                ? readPath(itemText, refMatch[0].length + opMatch[0].length)
                : null;
            const to = target ? endpointOf(target.parts, defaultSchema) : null;
            if (!opMatch || !to)
                fail(`a ref: setting on ${tableKey} could not be read`);
            const relation = relationOf(
                `${tableKey}.${key}`,
                opMatch![1],
                to!,
                ''
            );
            inlineRefs.push({ key: relation.key, text: itemText });
        }
    }

    return {
        key,
        name,
        ...element,
        settings,
        settingItems,
        inlineRefs,
    };
};

const parseTable = (
    text: string,
    structure: string,
    noComments: string,
    block: TopLevelBlock,
    defaultSchema: string
): ParsedTable => {
    const header = noComments.slice(
        block.start + block.keyword.length,
        block.openBrace
    );
    const path = readPath(header, 0);
    if (!path || path.parts.length > 2) fail('a table name could not be read');
    const key = tableKeyOf(path!.parts, defaultSchema);
    const table: ParsedTable = {
        key,
        block,
        headerRest: squash(header.slice(path!.end)),
        columns: [],
        note: null,
        indexes: null,
        others: [],
        text: noComments.slice(block.start, block.end),
    };
    for (const element of tableElements(text, structure, noComments, block)) {
        const elementText = noComments.slice(element.defStart, element.defEnd);
        if (/^note\s*[:{]/i.test(elementText)) {
            if (table.note) fail(`${key} has two notes`);
            table.note = { ...element, text: elementText };
        } else if (/^indexes\s*\{/i.test(elementText)) {
            if (table.indexes) fail(`${key} has two indexes blocks`);
            table.indexes = { ...element, text: elementText };
        } else if (/^[A-Za-z0-9_$"]/.test(elementText)) {
            table.columns.push(
                parseColumn(
                    text,
                    structure,
                    noComments,
                    element,
                    key,
                    defaultSchema
                )
            );
        } else {
            table.others.push(squash(elementText));
        }
    }
    return table;
};

/** Reads a DBML text's tables, enums and relationships, with where each one is written. */
const parseDBML = (text: string, defaultSchema: string): ParsedDBML => {
    const structure = maskCommentsAndStrings(text).masked;
    const noComments = maskCommentsAndStrings(text, {
        maskStrings: false,
    }).masked;
    const { blocks, malformed } = findTopLevelBlocks(text, BLOCK_KEYWORDS);
    if (
        malformed.some(
            (block) =>
                block.reason === 'missing_close_brace' ||
                block.keyword.toLowerCase() !== 'ref'
        )
    ) {
        fail('the file has a block that is not closed');
    }

    const parsed: ParsedDBML = {
        text,
        tables: [],
        refs: [],
        enums: [],
        others: [],
    };
    const inBlock = new Uint8Array(text.length);

    for (const block of blocks) {
        inBlock.fill(1, block.start, block.end);
        const keyword = block.keyword.toLowerCase();
        if (keyword === 'table') {
            const table = parseTable(
                text,
                structure,
                noComments,
                block,
                defaultSchema
            );
            parsed.tables.push(table);
            for (const column of table.columns) {
                for (const inline of column.inlineRefs) {
                    parsed.refs.push({
                        key: inline.key,
                        canonical: '',
                        kind: 'inline',
                        start: column.defStart,
                        end: column.defEnd,
                        text: inline.text,
                    });
                }
            }
        } else if (keyword === 'enum') {
            const header = noComments.slice(
                block.start + block.keyword.length,
                block.openBrace
            );
            const path = readPath(header, 0);
            if (!path || path.parts.length > 2)
                fail('an enum name could not be read');
            parsed.enums.push({
                key: tableKeyOf(path!.parts, defaultSchema),
                block,
                text: squash(noComments.slice(block.start, block.end)),
            });
        } else if (keyword === 'ref') {
            const body = noComments
                .slice(block.openBrace + 1, block.closeBrace)
                .trim();
            const relation = readRelation(body, 0, defaultSchema);
            if (!relation) fail('a Ref block could not be read');
            parsed.refs.push({
                ...relation!,
                kind: 'block',
                start: block.start,
                end: block.end,
                text: noComments.slice(block.start, block.end),
            });
        } else {
            parsed.others.push(
                squash(noComments.slice(block.start, block.end))
            );
        }
    }

    // Lines outside every block: short `Ref` lines, and anything else.
    let lineStart = 0;
    while (lineStart < text.length) {
        const lineEnd = lineEndOf(text, lineStart);
        let outside = '';
        for (let index = lineStart; index < lineEnd; index++) {
            if (!inBlock[index]) outside += structure[index];
        }
        if (!isBlank(outside)) {
            const line = noComments.slice(lineStart, lineEnd);
            const refMatch = /^\s*ref\b/i.exec(line);
            if (
                refMatch &&
                !inBlock.subarray(lineStart, lineEnd).some(Boolean)
            ) {
                const colon = structure.indexOf(
                    ':',
                    lineStart + refMatch[0].length
                );
                const relation =
                    colon !== -1 && colon < lineEnd
                        ? readRelation(
                              noComments.slice(colon + 1, lineEnd),
                              0,
                              defaultSchema
                          )
                        : null;
                if (!relation) fail('a Ref line could not be read');
                parsed.refs.push({
                    ...relation!,
                    kind: 'line',
                    start: lineStart + line.search(/\S/),
                    end: lineStart + line.trimEnd().length,
                    text: line.trim(),
                });
            } else {
                parsed.others.push(squash(outside));
            }
        }
        lineStart = lineEnd + 1;
    }
    return parsed;
};

const byKey = <T extends { key: string }>(items: T[], what: string) => {
    const map = new Map<string, T>();
    for (const item of items) {
        if (map.has(item.key)) fail(`${what} ${item.key} is written twice`);
        map.set(item.key, item);
    }
    return map;
};

const sameList = (a: string[], b: string[]) =>
    a.length === b.length &&
    [...a].sort().join('\n') === [...b].sort().join('\n');

interface Edit {
    start: number;
    end: number;
    text: string;
}

/** The indentation of the line holding `index`, when only whitespace precedes it. */
const indentAt = (text: string, index: number, fallback: string) => {
    const before = text.slice(lineStartOf(text, index), index);
    return isBlank(before) ? before : fallback;
};

/** Re-indents a part the exporter wrote (such as an `indexes` block) to `indent`. */
const reindent = (after: string, part: ParsedPart, indent: string) => {
    const from = after.slice(part.lineStart, part.defStart);
    return part.text
        .split('\n')
        .map((line, index) =>
            index === 0
                ? line
                : indent +
                  (line.startsWith(from)
                      ? line.slice(from.length)
                      : line.trimStart())
        )
        .join('\n');
};

/** Removes whole lines from `lineStart` to the end of the line `lineEnd` points into. */
const removeLines = (
    text: string,
    lineStart: number,
    lineEnd: number
): Edit => ({
    start: lineStart,
    end: afterLine(text, lineEnd),
    text: '',
});

/** Inserts a new line holding `line` before the table's closing brace. */
const insertBeforeClose = (
    text: string,
    table: ParsedTable,
    line: string
): Edit => {
    const close = table.block.closeBrace;
    const closeLine = lineStartOf(text, close);
    return isBlank(text.slice(closeLine, close))
        ? { start: closeLine, end: closeLine, text: `${line}\n` }
        : { start: close, end: close, text: `\n${line}\n` };
};

/** Inserts a new line holding `line` after the element ending at `lineEnd`. */
const insertAfter = (text: string, lineEnd: number, line: string): Edit =>
    text[lineEnd] === '\n'
        ? { start: lineEnd, end: lineEnd, text: `\n${line}` }
        : { start: lineEnd, end: lineEnd, text: `\n${line}\n` };

/** A column's definition rebuilt from its settings, without the removed `ref:` items. */
const withoutRefs = (
    text: string,
    column: ParsedColumn,
    removed: ReadonlySet<string>
): string => {
    const kept = column.settingItems.filter((item) => {
        const inline = column.inlineRefs.find((ref) => ref.text === item);
        return !inline || !removed.has(inline.key);
    });
    const { open } = column.settings!;
    let typeEnd = open;
    while (typeEnd > column.defStart && /\s/.test(text[typeEnd - 1])) typeEnd--;
    const head = text.slice(column.defStart, typeEnd);
    return kept.length > 0 ? `${head} [${kept.join(', ')}]` : head;
};

/** A changed column: the new definition under `name`, with the `ref:` items kept. */
const changedDefinition = (
    after: string,
    name: string,
    updated: ParsedColumn,
    keptRefs: string[]
): string => {
    const nameLength = updated.name.length;
    const definition = after.slice(updated.defStart, updated.defEnd);
    if (keptRefs.length === 0) {
        return name + definition.slice(nameLength);
    }
    if (updated.settings) {
        const close = updated.settings.close - updated.defStart;
        const empty = isBlank(
            definition.slice(
                updated.settings.open - updated.defStart + 1,
                close
            )
        );
        return `${name}${definition.slice(nameLength, close)}${empty ? '' : ', '}${keptRefs.join(', ')}]`;
    }
    return `${name}${definition.slice(nameLength)} [${keptRefs.join(', ')}]`;
};

/**
 * A column name in the table's own style: without quotes when the table writes its columns
 * without them and the name needs none.
 */
const nameInStyle = (table: ParsedTable, written: string): string => {
    const bare = written.replace(/^"(.*)"$/s, '$1');
    const quotedCount = table.columns.filter((column) =>
        column.name.startsWith('"')
    ).length;
    const quoted = quotedCount * 2 > table.columns.length;
    return !quoted &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(bare) &&
        !/^(note|indexes|ref)$/i.test(bare)
        ? bare
        : written;
};

/**
 * Columns that were renamed: one disappears where one with the same definition (apart from its
 * name) appears, between the same neighbours.
 *
 * @returns A map from the new column's key to the old one's.
 */
const renamedColumns = (
    { before, after }: Texts,
    change: TableChange
): Map<string, string> => {
    const beforeKeys = new Set(change.before.columns.map((c) => c.key));
    const afterKeys = new Set(change.after.columns.map((c) => c.key));
    const rest = (text: string, column: ParsedColumn) =>
        squash(text.slice(column.defStart + column.name.length, column.defEnd));
    // Columns that only one side has, grouped by the shared column before them.
    const bySlot = (columns: ParsedColumn[], shared: Set<string>) => {
        const slots = new Map<string, ParsedColumn[]>();
        let anchor = '';
        for (const column of columns) {
            if (shared.has(column.key)) anchor = column.key;
            else slots.set(anchor, [...(slots.get(anchor) ?? []), column]);
        }
        return slots;
    };
    const gone = bySlot(change.before.columns, afterKeys);
    const added = bySlot(change.after.columns, beforeKeys);
    const renames = new Map<string, string>();
    for (const [anchor, olds] of gone) {
        const news = added.get(anchor);
        if (
            olds.length === 1 &&
            news?.length === 1 &&
            rest(before, olds[0]) === rest(after, news[0])
        ) {
            renames.set(news[0].key, olds[0].key);
        }
    }
    return renames;
};

interface TableChange {
    before: ParsedTable;
    after: ParsedTable;
}

/** The texts being compared and edited. */
interface Texts {
    original: string;
    before: string;
    after: string;
}

/** Inserts new column lines where the diagram has them: after the column before them. */
const columnInserts = (
    { original, after }: Texts,
    table: ParsedTable,
    change: TableChange,
    renames: ReadonlyMap<string, string>,
    indent: string
): Edit[] => {
    const beforeColumns = new Set(change.before.columns.map((c) => c.key));
    const originalColumns = new Map(table.columns.map((c) => [c.key, c]));
    const groups: { anchor: number | null; lines: string[] }[] = [];
    let anchor: number | null = null;
    let group: { anchor: number | null; lines: string[] } | null = null;
    for (const column of change.after.columns) {
        const existing = beforeColumns.has(column.key)
            ? column.key
            : renames.get(column.key);
        if (existing) {
            anchor = originalColumns.get(existing)?.lineEnd ?? anchor;
            group = null;
            continue;
        }
        if (!group) {
            group = { anchor, lines: [] };
            groups.push(group);
        }
        group.lines.push(
            indent +
                nameInStyle(table, column.name) +
                after.slice(column.defStart + column.name.length, column.defEnd)
        );
    }
    return groups.map(({ anchor: at, lines }) => {
        if (at !== null) return insertAfter(original, at, lines.join('\n'));
        const first = table.columns[0];
        if (!first) {
            return insertAfter(
                original,
                lineEndOf(original, table.block.openBrace),
                lines.join('\n')
            );
        }
        if (!isBlank(original.slice(first.lineStart, first.defStart))) {
            fail(`the first column of ${table.key} shares a line`);
        }
        const text = lines.map((line) => `${line}\n`).join('');
        return { start: first.lineStart, end: first.lineStart, text };
    });
};

/** The edits to one table of the original file. */
const tableEdits = (
    texts: Texts,
    table: ParsedTable,
    change: TableChange | null,
    removedRefs: ReadonlySet<string>
): Edit[] => {
    const { original, before, after } = texts;
    const edits: Edit[] = [];
    const removedColumns = new Set<string>();
    const changedColumns = new Map<string, ParsedColumn>();
    const renamedFrom = new Set<string>();
    const indent = table.columns[0]
        ? indentAt(original, table.columns[0].defStart, '  ')
        : '  ';

    if (change) {
        if (change.before.headerRest !== change.after.headerRest) {
            fail(`the settings of ${table.key} changed`);
        }
        if (!sameList(change.before.others, change.after.others)) {
            fail(`a part of ${table.key} that LuxDBDiag does not edit changed`);
        }
        const beforeColumns = byKey(
            change.before.columns,
            `${table.key} column`
        );
        const afterColumns = byKey(change.after.columns, `${table.key} column`);
        const originalColumns = byKey(table.columns, `${table.key} column`);
        for (const column of change.before.columns) {
            if (!afterColumns.has(column.key)) removedColumns.add(column.key);
        }
        for (const column of change.after.columns) {
            const previous = beforeColumns.get(column.key);
            if (
                previous &&
                squash(after.slice(column.defStart, column.defEnd)) !==
                    squash(before.slice(previous.defStart, previous.defEnd))
            ) {
                changedColumns.set(column.key, column);
            }
        }
        // A renamed column is rewritten where it is, under its new name.
        const renames = renamedColumns(texts, change);
        for (const [newKey, oldKey] of renames) {
            removedColumns.delete(oldKey);
            changedColumns.set(oldKey, afterColumns.get(newKey)!);
            renamedFrom.add(oldKey);
        }
        for (const key of [...removedColumns, ...changedColumns.keys()]) {
            if (!originalColumns.has(key)) {
                fail(`column ${key} of ${table.key} is not in this file`);
            }
        }
        edits.push(...columnInserts(texts, table, change, renames, indent));

        // The table's note and indexes block.
        for (const kind of ['note', 'indexes'] as const) {
            const was = change.before[kind];
            const now = change.after[kind];
            if (squash(was?.text ?? '') === squash(now?.text ?? '')) continue;
            const mine = table[kind];
            if (now) {
                const text = reindent(after, now, indent);
                edits.push(
                    mine
                        ? { start: mine.defStart, end: mine.defEnd, text }
                        : insertBeforeClose(original, table, indent + text)
                );
            } else if (mine) {
                if (!mine.ownLines)
                    fail(`the ${kind} of ${table.key} shares a line`);
                edits.push(removeLines(original, mine.lineStart, mine.lineEnd));
            }
        }
    }

    for (const column of table.columns) {
        if (removedColumns.has(column.key)) {
            if (!column.ownLines)
                fail(`column ${column.key} of ${table.key} shares a line`);
            edits.push(removeLines(original, column.lineStart, column.lineEnd));
            continue;
        }
        const dropped = column.inlineRefs.filter((ref) =>
            removedRefs.has(ref.key)
        );
        const updated = changedColumns.get(column.key);
        if (updated) {
            const kept = column.inlineRefs
                .filter((ref) => !removedRefs.has(ref.key))
                .map((ref) => ref.text);
            const name = renamedFrom.has(column.key)
                ? nameInStyle(table, updated.name)
                : column.name;
            edits.push({
                start: column.defStart,
                end: column.defEnd,
                text: changedDefinition(after, name, updated, kept),
            });
        } else if (dropped.length > 0) {
            edits.push({
                start: column.defStart,
                end: column.defEnd,
                text: withoutRefs(original, column, removedRefs),
            });
        }
    }
    return edits;
};

/** Applies non-overlapping edits, in order, to `text`. */
const applyEdits = (text: string, edits: Edit[]): string => {
    const ordered = edits
        .map((edit, index) => ({ ...edit, index }))
        .sort(
            (a, b) => a.start - b.start || a.end - b.end || a.index - b.index
        );
    let result = '';
    let cursor = 0;
    for (const edit of ordered) {
        if (edit.start < cursor) fail('two changes overlap');
        result += text.slice(cursor, edit.start) + edit.text;
        cursor = edit.end;
    }
    return result + text.slice(cursor);
};

/**
 * Applies to a file's own text what changed between two texts LuxDBDiag wrote for it.
 *
 * @param original The file as written by its author (for example as it is on GitHub).
 * @param before What LuxDBDiag wrote for the file when it was read.
 * @param after What LuxDBDiag writes for the file now.
 * @param options `defaultSchema` (for example `public`) completes names written without one.
 * @returns The edited text, or why the file cannot be edited in place.
 */
export const editDBMLInPlace = (
    original: string,
    before: string,
    after: string,
    options: { defaultSchema?: string } = {}
): InPlaceResult => {
    const defaultSchema = (options.defaultSchema ?? 'public').toLowerCase();
    try {
        const texts: Texts = { original, before, after };
        const mine = parseDBML(original, defaultSchema);
        const was = parseDBML(before, defaultSchema);
        const now = parseDBML(after, defaultSchema);
        if (!sameList(was.others, now.others)) {
            fail('a part of the file LuxDBDiag does not edit changed');
        }

        const myTables = byKey(mine.tables, 'table');
        const wasTables = byKey(was.tables, 'table');
        const nowTables = byKey(now.tables, 'table');
        const wasRefs = byKey(was.refs, 'relationship');
        const nowRefs = byKey(now.refs, 'relationship');
        const myEnums = byKey(mine.enums, 'enum');
        const wasEnums = byKey(was.enums, 'enum');
        const nowEnums = byKey(now.enums, 'enum');

        const removedRefs = new Set<string>();
        const addedRefs: ParsedRef[] = [];
        for (const ref of was.refs) {
            const next = nowRefs.get(ref.key);
            if (!next || next.canonical !== ref.canonical)
                removedRefs.add(ref.key);
        }
        for (const ref of now.refs) {
            const previous = wasRefs.get(ref.key);
            if (!previous || previous.canonical !== ref.canonical)
                addedRefs.push(ref);
        }

        const edits: Edit[] = [];
        const appended: string[] = [];

        // Tables.
        const removedTables = new Set(
            was.tables.filter((t) => !nowTables.has(t.key)).map((t) => t.key)
        );
        const changes = new Map<string, TableChange>();
        for (const table of now.tables) {
            const previous = wasTables.get(table.key);
            if (!previous) {
                if (myTables.has(table.key))
                    fail(`${table.key} is already in this file`);
                appended.push(after.slice(table.block.start, table.block.end));
            } else if (squash(previous.text) !== squash(table.text)) {
                if (!myTables.has(table.key))
                    fail(`${table.key} is not in this file`);
                changes.set(table.key, { before: previous, after: table });
            }
        }
        const structure = maskCommentsAndStrings(original).masked;
        for (const table of mine.tables) {
            if (removedTables.has(table.key)) {
                const { block } = table;
                const lineStart = lineStartOf(original, block.start);
                const lineEnd = lineEndOf(original, block.end);
                if (
                    !isBlank(structure.slice(lineStart, block.start)) ||
                    !isBlank(structure.slice(block.end, lineEnd))
                ) {
                    fail(`${table.key} shares a line with something else`);
                }
                edits.push(removeLines(original, lineStart, lineEnd));
                continue;
            }
            edits.push(
                ...tableEdits(
                    texts,
                    table,
                    changes.get(table.key) ?? null,
                    removedRefs
                )
            );
        }

        // Enums.
        for (const item of now.enums) {
            const previous = wasEnums.get(item.key);
            const existing = myEnums.get(item.key);
            if (previous && previous.text === item.text) continue;
            const text = after.slice(item.block.start, item.block.end);
            if (existing) {
                edits.push({
                    start: existing.block.start,
                    end: existing.block.end,
                    text,
                });
            } else if (!previous) {
                appended.push(text);
            }
        }
        for (const item of was.enums) {
            const existing = myEnums.get(item.key);
            if (!nowEnums.has(item.key) && existing) {
                edits.push(
                    removeLines(
                        original,
                        lineStartOf(original, existing.block.start),
                        lineEndOf(original, existing.block.end)
                    )
                );
            }
        }

        // Relationships written as their own `Ref` (inline ones are handled with their column).
        const myRefs = new Map<string, ParsedRef[]>();
        for (const ref of mine.refs) {
            myRefs.set(ref.key, [...(myRefs.get(ref.key) ?? []), ref]);
        }
        for (const key of removedRefs) {
            const found = myRefs.get(key) ?? [];
            if (found.length > 1)
                fail(`the relationship ${key} is written twice`);
            const [ref] = found;
            if (!ref || ref.kind === 'inline') continue;
            const lineStart = lineStartOf(original, ref.start);
            const lineEnd = lineEndOf(original, ref.end);
            edits.push(removeLines(original, lineStart, lineEnd));
        }
        const addedRefLines = addedRefs.map((ref) => ref.text);

        let content = applyEdits(original, edits);
        const tail = [
            ...appended,
            ...(addedRefLines.length > 0 ? [addedRefLines.join('\n')] : []),
        ];
        if (tail.length > 0) {
            const separator = content.endsWith('\n\n')
                ? ''
                : content.endsWith('\n')
                  ? '\n'
                  : content.length > 0
                    ? '\n\n'
                    : '';
            content = `${content}${separator}${tail.join('\n\n')}\n`;
        }
        return { ok: true, content };
    } catch (error) {
        if (error instanceof InPlaceError)
            return { ok: false, reason: error.message };
        throw error;
    }
};

/**
 * Whether two texts LuxDBDiag wrote describe the same tables, enums and relationships. Tables and
 * enums are compared as written; relationships by their two ends and kind, not their names.
 *
 * @returns null when they match, otherwise what differs.
 */
export const compareWrittenDBML = (
    a: string,
    b: string,
    options: { defaultSchema?: string } = {}
): string | null => {
    const defaultSchema = (options.defaultSchema ?? 'public').toLowerCase();
    try {
        const left = parseDBML(a, defaultSchema);
        const right = parseDBML(b, defaultSchema);
        const tables = (file: ParsedDBML) =>
            file.tables.map((table) => `${table.key}\n${squash(table.text)}`);
        const enums = (file: ParsedDBML) => file.enums.map((item) => item.text);
        const refs = (file: ParsedDBML) =>
            file.refs.map((ref) => ref.canonical);
        if (!sameList(tables(left), tables(right))) return 'the tables differ';
        if (!sameList(enums(left), enums(right))) return 'the enums differ';
        if (!sameList(refs(left), refs(right)))
            return 'the relationships differ';
        if (!sameList(left.others, right.others)) return 'other parts differ';
        return null;
    } catch (error) {
        if (error instanceof InPlaceError) return error.message;
        throw error;
    }
};

/** What a file shows of its tables and relationships: their keys, for checking a file. */
export const writtenDBMLKeys = (
    text: string,
    options: { defaultSchema?: string } = {}
): {
    tables: string[];
    enums: string[];
    refs: { key: string; text: string; ends: string[] }[];
    enumBlocks: { key: string; text: string }[];
} | null => {
    const defaultSchema = (options.defaultSchema ?? 'public').toLowerCase();
    try {
        const file = parseDBML(text, defaultSchema);
        return {
            tables: file.tables.map((table) => table.key),
            enums: file.enums.map((item) => item.key),
            refs: file.refs.map((ref) => ({
                key: ref.key,
                text: ref.text,
                ends: ref.key.split(' | '),
            })),
            enumBlocks: file.enums.map((item) => ({
                key: item.key,
                text: text.slice(item.block.start, item.block.end),
            })),
        };
    } catch (error) {
        if (error instanceof InPlaceError) return null;
        throw error;
    }
};

/** How many lines of `text` hold a comment (all of them are lost when a file is rewritten). */
export const commentLineCount = (text: string): number => {
    const masked = maskCommentsAndStrings(text, { maskStrings: false }).masked;
    const lines = text.split('\n');
    const maskedLines = masked.split('\n');
    return lines.filter((line, index) => line !== maskedLines[index]).length;
};
