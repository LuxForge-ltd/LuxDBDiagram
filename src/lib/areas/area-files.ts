/**
 * A diagram as several files (LuxDBDiagram).
 *
 * Purpose: writes a diagram as a folder of DBML files, one per Area. Each Area's file holds the
 * definitions of every table the Area shows, so putting a table into an Area puts its
 * definition into that Area's file; a table shown by two Areas is written in both files.
 * Scope: text generation. The diagram still holds one definition of each table; the files are
 * how it is saved and shared.
 * Operational role: used by "Save files to folder", by the side panel's file view, and tests.
 *
 * Rules:
 * - A file holds its Area's tables, every relationship that touches them (as `Ref` lines, so a
 *   relationship between two files appears identically in both), and the enums. Files are
 *   written by ChartDB's own exporter, so each table is written the same way in every file.
 * - Tables that no Area shows go to `unassigned.dbml`, so saving never drops a table.
 * - `luxdbdiag.areas.dbml` holds the Area blocks (colours, positions, Floats, each with its
 *   `file:`), so opening the folder again restores the Areas and their layout. The table files
 *   stay plain DBML that any DBML tool can read.
 * - Opening the folder combines the files again; identical repeats of a table, enum or Ref are
 *   kept once.
 */
import type { Diagram } from '@/lib/domain/diagram';
import type { AreaView } from '@/lib/domain/area-view';
import type { DBTable } from '@/lib/domain/db-table';
import { generateDBMLFromDiagram } from '@/lib/dbml/dbml-export/dbml-export';
import { defaultSchemas } from '@/lib/data/default-schemas';
import { serializeAreaViews } from './area-dbml';
import { blankRange, findTopLevelBlocks } from './dbml-scanner';
import { sortAreaViews } from './area-view-ops';

/** File holding the Area blocks and their layout. */
export const AREA_LAYOUT_FILE = 'luxdbdiag.areas.dbml';

/** File holding tables that no Area shows. */
export const UNASSIGNED_FILE = 'unassigned.dbml';

/** First line of the layout file (not counted as a lost comment on import). */
export const AREA_LAYOUT_HEADER =
    '// ==== LuxDBDiag: Areas and their layout for the files in this folder ====';

export interface AreaFile {
    path: string;
    /** The Area the file stands for; null for `unassigned.dbml` and the layout file. */
    areaId: string | null;
    content: string;
    tableCount: number;
}

export interface AreaFilesExport {
    /** Table files, one per Area (and `unassigned.dbml` when needed). */
    files: AreaFile[];
    /** The Area blocks file; null when the diagram has no Areas. */
    layout: AreaFile | null;
    warnings: string[];
}

/**
 * A file name made from an Area name: lower case, safe characters only, `.dbml` added.
 *
 * @param name Area name.
 * @returns For example `match_teams.dbml` for "Match teams".
 */
export const fileNameForAreaName = (name: string): string => {
    const base = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '_')
        .replace(/^[_.]+|[_.]+$/g, '');
    return `${base || 'area'}.dbml`;
};

/**
 * The file each Area is written to: its stored file name, or one made from its name, never
 * the same as another Area's or a reserved file.
 *
 * @param areaViews Areas of the diagram.
 * @returns A map from Area id to file path.
 */
export const assignAreaFilePaths = (
    areaViews: readonly AreaView[]
): Map<string, string> => {
    const used = new Set([
        AREA_LAYOUT_FILE.toLowerCase(),
        UNASSIGNED_FILE.toLowerCase(),
    ]);
    const paths = new Map<string, string>();
    const ordered = sortAreaViews(areaViews);

    // Stored names first, so a renamed Area does not take another Area's file.
    for (const area of ordered) {
        if (area.fileName && !used.has(area.fileName.toLowerCase())) {
            paths.set(area.id, area.fileName);
            used.add(area.fileName.toLowerCase());
        }
    }
    for (const area of ordered) {
        if (paths.has(area.id)) continue;
        const wanted = fileNameForAreaName(area.name);
        let candidate = wanted;
        for (let n = 2; used.has(candidate.toLowerCase()); n++) {
            candidate = wanted.replace(/\.dbml$/, `_${n}.dbml`);
        }
        paths.set(area.id, candidate);
        used.add(candidate.toLowerCase());
    }
    return paths;
};

/** The position prefix ChartDB's exporter adds to Ref names (`Ref "fk_3_name":`). */
const EXPORTER_REF_PREFIX = /^(Ref\s+")fk_\d+_([^"]*)(":)/gm;

/** Comparable key of a table: `schema.name` without quotes, lower case. */
const tableKey = (table: DBTable, defaultSchema?: string): string =>
    `${table.schema || defaultSchema || ''}.${table.name}`.toLowerCase();

/** Comparable key of a `Table` block header written by ChartDB (`"schema"."name"`). */
const headerKey = (header: string, defaultSchema?: string): string => {
    const name = header
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\s+as\s+\S+\s*$/i, '')
        .replace(/"/g, '')
        .replace(/\s*\.\s*/g, '.')
        .trim()
        .toLowerCase();
    return name.includes('.') ? name : `${defaultSchema ?? ''}.${name}`;
};

/**
 * Writes the DBML of a set of tables: the tables, every relationship touching them, and the
 * enums. Tables at the other end of a relationship are needed by the exporter and are removed
 * from the text afterwards.
 */
const tablesFileContent = (
    diagram: Diagram,
    tableIds: ReadonlySet<string>
): string => {
    const tables = diagram.tables ?? [];
    const relationships = (diagram.relationships ?? []).filter(
        (rel) =>
            tableIds.has(rel.sourceTableId) || tableIds.has(rel.targetTableId)
    );
    const neededIds = new Set(tableIds);
    relationships.forEach((rel) => {
        neededIds.add(rel.sourceTableId);
        neededIds.add(rel.targetTableId);
    });

    const result = generateDBMLFromDiagram({
        ...diagram,
        tables: tables.filter((table) => neededIds.has(table.id)),
        // Every relationship gets a fixed name here; the exporter would otherwise prefix it
        // with its position (and name unnamed ones at random), so the same relationship
        // would be written differently in each file and could not be recognised as a repeat.
        relationships: relationships.map((rel) => ({
            ...rel,
            name: rel.name || `ref_${rel.id}`,
        })),
        areas: [],
        notes: [],
        areaViews: [],
    });
    if (result.error) throw new Error(result.error);

    const defaultSchema = defaultSchemas[diagram.databaseType];
    const partnerKeys = new Set(
        tables
            .filter(
                (table) => neededIds.has(table.id) && !tableIds.has(table.id)
            )
            .map((table) => tableKey(table, defaultSchema))
    );

    let content = result.standardDbml.replace(EXPORTER_REF_PREFIX, '$1$2$3');
    const { blocks } = findTopLevelBlocks(content, ['table']);
    for (const block of [...blocks].reverse()) {
        if (partnerKeys.has(headerKey(block.header, defaultSchema))) {
            content = blankRange(content, block.start, block.end);
        }
    }
    return `${content
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()}\n`;
};

/**
 * The DBML LuxDBDiag writes for a set of tables, as in an Area's file: the tables, every
 * relationship touching them, and the enums.
 *
 * @param diagram The diagram.
 * @param tableIds The tables the file holds.
 * @throws Error when ChartDB's exporter cannot write the schema.
 */
export const tablesFileText = (
    diagram: Diagram,
    tableIds: ReadonlySet<string>
): string => tablesFileContent(diagram, tableIds);

/**
 * Writes a diagram as one DBML file per Area, plus the Area layout file.
 *
 * @param diagram The diagram.
 * @returns The files to write and any warnings.
 * @throws Error when ChartDB's exporter cannot write the schema.
 */
export const generateAreaFiles = (diagram: Diagram): AreaFilesExport => {
    const tables = diagram.tables ?? [];
    const existingIds = new Set(tables.map((table) => table.id));
    const areaViews = sortAreaViews(diagram.areaViews ?? []);
    const paths = assignAreaFilePaths(areaViews);
    const warnings: string[] = [];

    const emptyTables = tables.filter(
        (table) => !table.fields.some((field) => field.name !== '')
    );
    if (emptyTables.length > 0) {
        warnings.push(
            `${emptyTables.length} table${emptyTables.length === 1 ? ' has' : 's have'} no columns and ${emptyTables.length === 1 ? 'is' : 'are'} not written: ${emptyTables.map((t) => t.name).join(', ')}.`
        );
    }

    const files: AreaFile[] = [];
    const shown = new Set<string>();
    for (const area of areaViews) {
        const ids = new Set(
            area.tables
                .map((instance) => instance.tableId)
                .filter((id) => existingIds.has(id))
        );
        ids.forEach((id) => shown.add(id));
        files.push({
            path: paths.get(area.id)!,
            areaId: area.id,
            content: ids.size > 0 ? tablesFileContent(diagram, ids) : '',
            tableCount: ids.size,
        });
    }

    const unassigned = new Set(
        tables.map((table) => table.id).filter((id) => !shown.has(id))
    );
    if (unassigned.size > 0) {
        files.push({
            path: UNASSIGNED_FILE,
            areaId: null,
            content: tablesFileContent(diagram, unassigned),
            tableCount: unassigned.size,
        });
    }

    const layout =
        areaViews.length > 0
            ? {
                  path: AREA_LAYOUT_FILE,
                  areaId: null,
                  content: `${AREA_LAYOUT_HEADER}\n${serializeAreaViews(
                      areaViews.map((area) => ({
                          ...area,
                          fileName: paths.get(area.id) ?? null,
                      })),
                      {
                          tables,
                          defaultSchema: defaultSchemas[diagram.databaseType],
                      }
                  )}\n`,
                  tableCount: 0,
              }
            : null;

    return { files, layout, warnings };
};

/**
 * The DBML of one Area's file, for viewing.
 *
 * @param diagram The diagram.
 * @param areaId The Area.
 * @returns The file's path and text, or null when the Area does not exist.
 */
export const areaFileFor = (
    diagram: Diagram,
    areaId: string
): AreaFile | null =>
    generateAreaFiles(diagram).files.find((file) => file.areaId === areaId) ??
    null;
