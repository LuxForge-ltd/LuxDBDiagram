/**
 * Enhanced DBML: Area blocks (LuxDBDiagram).
 *
 * Purpose: reads and writes the `Area` blocks that LuxDBDiagram adds to DBML, and turns them
 * into Areas that reference the diagram's canonical tables.
 * Scope: Area syntax only. Ordinary DBML is left to ChartDB's importer and exporter, which
 * never see an `Area` block: the blocks are lifted out first (line numbers preserved) and
 * written back after ChartDB's standard export.
 * Operational role: called by `importDBMLToDiagram` on every DBML import and by the enhanced
 * DBML export.
 *
 * Syntax (every setting optional):
 *
 *     Area "Users" [color: #8b5cf6] {
 *         users [x: 120, y: 80]
 *         public.user_auth_identities
 *         float matches [x: 900, y: 300, expanded]
 *     }
 */
import type { DBTable } from '@/lib/domain/db-table';
import type { DBRelationship } from '@/lib/domain/db-relationship';
import type {
    AreaView,
    AreaViewFloatLayout,
    AreaViewTableInstance,
    AreaFloatFilter,
} from '@/lib/domain/area-view';
import {
    DEFAULT_AREA_FLOAT_FILTER,
    effectiveFloatFilter,
} from '@/lib/domain/area-view';
import {
    blankRange,
    findTopLevelBlocks,
    maskCommentsAndStrings,
    positionAt,
} from './dbml-scanner';
import { buildAreaView, sortAreaViews } from './area-view-ops';
import { layoutAreaInstances } from './area-layout';

export type DBMLImportIssueSeverity = 'error' | 'warning';

/** A problem found while importing DBML, reported to the user rather than hidden. */
export interface DBMLImportIssue {
    severity: DBMLImportIssueSeverity;
    /** Stable identifier for tests and for grouping messages. */
    code:
        | 'area_malformed'
        | 'area_duplicate_name'
        | 'area_unknown_setting'
        | 'area_invalid_color'
        | 'area_duplicate_table'
        | 'area_missing_table'
        | 'area_ambiguous_table'
        | 'area_float_is_instance'
        | 'comments_not_kept'
        | 'file_duplicate_definition'
        | 'file_conflicting_definition'
        | 'file_duplicate_project';
    message: string;
    /** 1-based line in the text that was imported. */
    line?: number;
    column?: number;
    /** Source file name, when several files were merged. */
    file?: string;
}

/** One table line inside an `Area` block. */
export interface ParsedAreaEntry {
    kind: 'table' | 'float';
    schema?: string;
    name: string;
    x?: number;
    y?: number;
    expanded?: boolean;
    line: number;
}

/** An `Area` block as written, before table names are resolved. */
export interface ParsedArea {
    name: string;
    color?: string;
    floatFilter?: AreaFloatFilter;
    entries: ParsedAreaEntry[];
    line: number;
}

const NAME = String.raw`"(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_$]*`;
const HEADER_PATTERN = new RegExp(
    String.raw`^\s*(${NAME})\s*(?:\[([^\]]*)\])?\s*$`,
    's'
);
const ENTRY_PATTERN = new RegExp(
    String.raw`^(?:(float)\s+)?(?:(${NAME})\s*\.\s*)?(${NAME})\s*(?:\[([^\]]*)\])?\s*,?$`,
    'i'
);
const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;
const PLAIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Removes the quotes and escapes from a DBML name token. */
const unquote = (token: string): string =>
    token.startsWith('"') ? token.slice(1, -1).replace(/\\(.)/g, '$1') : token;

/** Writes a name as a DBML token, quoting it when it is not a plain identifier. */
const quoteName = (name: string): string =>
    PLAIN_NAME.test(name) ? name : `"${name.replace(/(["\\])/g, '\\$1')}"`;

/** Splits `key: value, flag` settings into pairs; flags get the value `true`. */
const parseSettings = (
    text: string | undefined
): { key: string; value: string | true }[] =>
    (text ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
            const colon = part.indexOf(':');
            if (colon === -1) {
                return { key: part.toLowerCase(), value: true as const };
            }
            return {
                key: part.slice(0, colon).trim().toLowerCase(),
                value: part.slice(colon + 1).trim(),
            };
        });

/**
 * Lifts every top-level `Area` block out of DBML text.
 *
 * The blocks are replaced with blank space (newlines kept), so ChartDB's parser sees ordinary
 * DBML and its error line numbers still match the original text.
 *
 * @param content DBML text that may contain Area blocks.
 * @returns The text without Area blocks, the parsed Areas, and any problems found.
 */
export const extractAreaBlocks = (
    content: string
): { content: string; areas: ParsedArea[]; issues: DBMLImportIssue[] } => {
    const { blocks, malformed } = findTopLevelBlocks(content, ['area']);
    const issues: DBMLImportIssue[] = [];
    const areas: ParsedArea[] = [];
    let stripped = content;

    for (const bad of malformed) {
        const position = positionAt(content, bad.start);
        issues.push({
            severity: 'error',
            code: 'area_malformed',
            message:
                bad.reason === 'missing_open_brace'
                    ? `Area block has no opening "{".`
                    : `Area block is missing its closing "}".`,
            ...position,
        });
    }

    for (const block of blocks) {
        const position = positionAt(content, block.start);
        const parsed = parseAreaBlock(content, block, issues);
        if (parsed) {
            areas.push({ ...parsed, line: position.line });
        }
        stripped = blankRange(stripped, block.start, block.end);
    }

    return { content: stripped, areas, issues };
};

/** Parses one Area block's header and body, pushing problems onto `issues`. */
const parseAreaBlock = (
    content: string,
    block: { start: number; openBrace: number; header: string; body: string },
    issues: DBMLImportIssue[]
): Omit<ParsedArea, 'line'> | null => {
    const headerPosition = positionAt(content, block.start);
    const headerMatch = HEADER_PATTERN.exec(block.header);

    if (!headerMatch) {
        issues.push({
            severity: 'error',
            code: 'area_malformed',
            message: `Area block needs a name, for example: Area "Users" { ... }`,
            ...headerPosition,
        });
        return null;
    }

    const name = unquote(headerMatch[1]).trim();
    if (!name) {
        issues.push({
            severity: 'error',
            code: 'area_malformed',
            message: 'Area name cannot be empty.',
            ...headerPosition,
        });
        return null;
    }

    let color: string | undefined;
    let floatFilter: AreaFloatFilter | undefined;
    for (const setting of parseSettings(headerMatch[2])) {
        if (setting.key === 'color' && typeof setting.value === 'string') {
            if (COLOR_PATTERN.test(setting.value)) {
                color = setting.value;
            } else {
                issues.push({
                    severity: 'warning',
                    code: 'area_invalid_color',
                    message: `Area "${name}": "${setting.value}" is not a hex colour; a palette colour is used instead.`,
                    ...headerPosition,
                });
            }
        } else if (
            setting.key === 'floats' &&
            (setting.value === 'all' || setting.value === 'outgoing')
        ) {
            floatFilter = setting.value;
        } else {
            issues.push({
                severity: 'warning',
                code: 'area_unknown_setting',
                message: `Area "${name}": setting "${setting.key}" is not recognised and was ignored.`,
                ...headerPosition,
            });
        }
    }

    const bodyStart = block.openBrace + 1;
    const bodyLineOffset = positionAt(content, bodyStart).line;
    // Comments are blanked but quoted names are kept, so entries can be read line by line.
    const bodyText = maskCommentsAndStrings(block.body, {
        maskStrings: false,
    }).masked;

    const entries: ParsedAreaEntry[] = [];
    bodyText.split('\n').forEach((rawLine, lineIndex) => {
        const line = bodyLineOffset + lineIndex;
        const text = rawLine.trim();
        if (!text) return;

        const entry = parseAreaEntry(text, name, line, issues);
        if (entry) entries.push(entry);
    });

    return { name, color, floatFilter, entries };
};

/** Parses one line of an Area block, pushing problems onto `issues`. */
const parseAreaEntry = (
    text: string,
    areaName: string,
    line: number,
    issues: DBMLImportIssue[]
): ParsedAreaEntry | null => {
    const match = ENTRY_PATTERN.exec(text);
    if (!match) {
        issues.push({
            severity: 'error',
            code: 'area_malformed',
            message: `Area "${areaName}": cannot read "${text}". Each line should name one table, for example: users [x: 120, y: 80]`,
            line,
            column: 1,
        });
        return null;
    }

    const entry: ParsedAreaEntry = {
        kind: match[1] ? 'float' : 'table',
        schema: match[2] ? unquote(match[2]) : undefined,
        name: unquote(match[3]),
        line,
    };

    for (const setting of parseSettings(match[4])) {
        if (
            (setting.key === 'x' || setting.key === 'y') &&
            setting.value !== true
        ) {
            const value = Number(setting.value);
            if (Number.isFinite(value)) {
                if (setting.key === 'x') entry.x = value;
                else entry.y = value;
                continue;
            }
        }
        if (setting.key === 'expanded' && entry.kind === 'float') {
            entry.expanded = setting.value === true || setting.value === 'true';
            continue;
        }
        issues.push({
            severity: 'warning',
            code: 'area_unknown_setting',
            message: `Area "${areaName}": setting "${setting.key}" on "${entry.name}" is not recognised and was ignored.`,
            line,
            column: 1,
        });
    }

    return entry;
};

/** Treats the database's default schema and "no schema" as the same thing. */
const normalizeSchema = (
    schema: string | null | undefined,
    defaultSchema: string | undefined
): string => (!schema || schema === defaultSchema ? '' : schema);

/**
 * Finds the canonical table an Area line refers to.
 *
 * Exact names are preferred; a unique case-insensitive match is accepted. An unqualified
 * name shared by several schemas resolves to the default schema's table if there is one.
 */
const findTable = (
    entry: Pick<ParsedAreaEntry, 'schema' | 'name'>,
    tables: readonly DBTable[],
    defaultSchema: string | undefined
): { table?: DBTable; ambiguous?: boolean } => {
    const matchesName = (table: DBTable, exact: boolean) =>
        exact
            ? table.name === entry.name
            : table.name.toLowerCase() === entry.name.toLowerCase();

    for (const exact of [true, false]) {
        let candidates = tables.filter((table) => matchesName(table, exact));

        if (entry.schema !== undefined) {
            const wanted = normalizeSchema(entry.schema, defaultSchema);
            candidates = candidates.filter(
                (table) =>
                    normalizeSchema(table.schema, defaultSchema) === wanted
            );
        }

        if (candidates.length === 1) return { table: candidates[0] };
        if (candidates.length > 1) {
            const inDefault = candidates.filter(
                (table) => normalizeSchema(table.schema, defaultSchema) === ''
            );
            if (inDefault.length === 1) return { table: inDefault[0] };
            return { ambiguous: true };
        }
    }

    return {};
};

/** Formats a table reference for messages and for writing DBML. */
const describeRef = (entry: Pick<ParsedAreaEntry, 'schema' | 'name'>) =>
    entry.schema ? `${entry.schema}.${entry.name}` : entry.name;

/**
 * Turns parsed Area blocks into Areas that reference canonical table ids.
 *
 * Missing or ambiguous tables, repeated tables and repeated Area names are reported and
 * skipped; nothing is silently dropped. Tables listed without a position are laid out
 * automatically on that Area's canvas.
 *
 * @param parsed Area blocks from `extractAreaBlocks`.
 * @param context The diagram's canonical tables and relationships, its default schema, and
 *        an id generator.
 * @returns The Areas and the problems found while resolving them.
 */
export const resolveParsedAreas = (
    parsed: readonly ParsedArea[],
    context: {
        tables: readonly DBTable[];
        relationships: readonly DBRelationship[];
        defaultSchema?: string;
        generateId: () => string;
    }
): { areaViews: AreaView[]; issues: DBMLImportIssue[] } => {
    const issues: DBMLImportIssue[] = [];
    const areaViews: AreaView[] = [];
    const createdAt = Date.now();

    for (const area of parsed) {
        if (
            areaViews.some(
                (existing) =>
                    existing.name.toLowerCase() === area.name.toLowerCase()
            )
        ) {
            issues.push({
                severity: 'error',
                code: 'area_duplicate_name',
                message: `Area "${area.name}" is defined more than once. Area names must be unique.`,
                line: area.line,
                column: 1,
            });
            continue;
        }

        const instances: (Omit<AreaViewTableInstance, 'x' | 'y'> & {
            x?: number;
            y?: number;
        })[] = [];
        const floats: AreaViewFloatLayout[] = [];
        const seenTables = new Set<string>();

        for (const entry of area.entries) {
            const { table, ambiguous } = findTable(
                entry,
                context.tables,
                context.defaultSchema
            );

            if (!table) {
                issues.push({
                    severity: 'warning',
                    code: ambiguous
                        ? 'area_ambiguous_table'
                        : 'area_missing_table',
                    message: ambiguous
                        ? `Area "${area.name}": "${describeRef(entry)}" matches tables in several schemas; qualify it as schema.table. It was skipped.`
                        : `Area "${area.name}": table "${describeRef(entry)}" does not exist in the schema and was skipped.`,
                    line: entry.line,
                    column: 1,
                });
                continue;
            }

            if (entry.kind === 'float') {
                if (floats.some((f) => f.tableId === table.id)) continue;
                floats.push({
                    tableId: table.id,
                    x: entry.x ?? 0,
                    y: entry.y ?? 0,
                    expanded: entry.expanded ?? null,
                });
                continue;
            }

            if (seenTables.has(table.id)) {
                issues.push({
                    severity: 'warning',
                    code: 'area_duplicate_table',
                    message: `Area "${area.name}": table "${describeRef(entry)}" is listed more than once; a table appears at most once per Area.`,
                    line: entry.line,
                    column: 1,
                });
                continue;
            }

            seenTables.add(table.id);
            instances.push({ tableId: table.id, x: entry.x, y: entry.y });
        }

        const laidOut = layoutAreaInstances({
            instances,
            tables: context.tables,
            relationships: context.relationships,
        });

        areaViews.push(
            buildAreaView(
                areaViews,
                {
                    name: area.name,
                    color: area.color,
                    floatFilter: area.floatFilter ?? null,
                    order: areaViews.length,
                    tables: laidOut,
                    floats: floats.filter(
                        (float) => !seenTables.has(float.tableId)
                    ),
                    createdAt,
                },
                context.generateId
            )
        );
    }

    return { areaViews, issues };
};

/** Rounds a coordinate for writing, keeping up to two decimals. */
const formatCoordinate = (value: number): string =>
    String(Math.round(value * 100) / 100);

/**
 * Writes Areas as enhanced DBML `Area` blocks.
 *
 * Instances of tables that no longer exist are left out. Tables are written by name, and
 * qualified with their schema when it is not the default schema or when the bare name would
 * be ambiguous.
 *
 * @param areaViews Areas to write.
 * @param context The canonical tables and the database's default schema.
 * @returns DBML text (empty when there are no Areas).
 */
export const serializeAreaViews = (
    areaViews: readonly AreaView[],
    context: { tables: readonly DBTable[]; defaultSchema?: string }
): string => {
    const tablesById = new Map(context.tables.map((t) => [t.id, t]));
    const nameCounts = new Map<string, number>();
    context.tables.forEach((table) =>
        nameCounts.set(table.name, (nameCounts.get(table.name) ?? 0) + 1)
    );

    const tableRef = (table: DBTable): string => {
        const schema = normalizeSchema(table.schema, context.defaultSchema);
        const ambiguous = (nameCounts.get(table.name) ?? 0) > 1;
        const qualifier =
            schema || (ambiguous && table.schema) ? table.schema : undefined;
        return qualifier
            ? `${quoteName(qualifier)}.${quoteName(table.name)}`
            : quoteName(table.name);
    };

    return sortAreaViews(areaViews)
        .map((area) => {
            const lines: string[] = [];
            const name = area.name.replace(/(["\\])/g, '\\$1');
            const floats =
                effectiveFloatFilter(area.floatFilter) ===
                DEFAULT_AREA_FLOAT_FILTER
                    ? ''
                    : `, floats: ${effectiveFloatFilter(area.floatFilter)}`;
            lines.push(`Area "${name}" [color: ${area.color}${floats}] {`);

            for (const instance of area.tables) {
                const table = tablesById.get(instance.tableId);
                if (!table) continue;
                lines.push(
                    `    ${tableRef(table)} [x: ${formatCoordinate(instance.x)}, y: ${formatCoordinate(instance.y)}]`
                );
            }

            const instanceIds = new Set(area.tables.map((t) => t.tableId));
            for (const float of area.floats ?? []) {
                const table = tablesById.get(float.tableId);
                if (!table || instanceIds.has(float.tableId)) continue;
                const expanded = float.expanded ? ', expanded' : '';
                lines.push(
                    `    float ${tableRef(table)} [x: ${formatCoordinate(float.x)}, y: ${formatCoordinate(float.y)}${expanded}]`
                );
            }

            lines.push('}');
            return lines.join('\n');
        })
        .join('\n\n');
};

/**
 * Builds the warning shown when DBML line comments will not survive the import. ChartDB's
 * schema model has nowhere to keep `//` comments; table and column `note:` values are kept.
 *
 * @param content The DBML that was imported.
 * @returns A warning, or null when there are no line comments.
 */
export const commentLossWarning = (content: string): DBMLImportIssue | null => {
    const { lineComments } = maskCommentsAndStrings(content);
    if (lineComments === 0) return null;
    return {
        severity: 'warning',
        code: 'comments_not_kept',
        message: `${lineComments} "//" comment line${lineComments === 1 ? ' is' : 's are'} not kept: the diagram stores schema structure and notes, not comments. Use note: '...' on tables and columns to keep text with the schema.`,
    };
};
