/**
 * DBML file export (LuxDBDiagram).
 *
 * Purpose: produces the two DBML exports:
 * - standard DBML: the schema only, exactly as ChartDB writes it, readable by any DBML tool;
 * - LuxDBDiagram DBML: the same schema followed by the diagram's Area blocks, which
 *   LuxDBDiagram reads back into the same Areas, positions, colours and Float layout.
 * Scope: text generation. The schema part is always ChartDB's own exporter, so both exports
 * describe the schema identically.
 * Operational role: used by the Export menu, and by the round-trip tests.
 */
import type { Diagram } from '@/lib/domain/diagram';
import { generateDBMLFromDiagram } from '@/lib/dbml/dbml-export/dbml-export';
import { defaultSchemas } from '@/lib/data/default-schemas';
import { serializeAreaViews } from './area-dbml';

export interface DBMLFileExport {
    content: string;
    /** Things the export could not include, to tell the user about. */
    warnings: string[];
}

/**
 * Builds a DBML export of a diagram.
 *
 * @param diagram The diagram to export.
 * @param options `withAreas: true` appends the Area blocks (LuxDBDiagram DBML).
 * @returns The DBML text and any warnings.
 * @throws Error when ChartDB's exporter cannot produce DBML for the schema.
 */
export const exportDiagramAsDBML = (
    diagram: Diagram,
    options: { withAreas: boolean }
): DBMLFileExport => {
    const result = generateDBMLFromDiagram(diagram);
    if (result.error) {
        throw new Error(result.error);
    }

    // ChartDB's exporter leaves out tables without columns (DBML cannot express them).
    const warnings: string[] = [];
    const emptyTables = (diagram.tables ?? []).filter(
        (table) => !table.fields.some((field) => field.name !== '')
    );
    if (emptyTables.length > 0) {
        warnings.push(
            `${emptyTables.length} table${emptyTables.length === 1 ? ' has' : 's have'} no columns and ${emptyTables.length === 1 ? 'is' : 'are'} not in the export: ${emptyTables.map((t) => t.name).join(', ')}.`
        );
    }

    let content = result.standardDbml.trimEnd();
    if (options.withAreas && (diagram.areaViews?.length ?? 0) > 0) {
        const areas = serializeAreaViews(diagram.areaViews ?? [], {
            tables: diagram.tables ?? [],
            defaultSchema: defaultSchemas[diagram.databaseType],
        });
        content = `${content}\n\n${areas}`;
    }

    return { content: `${content}\n`, warnings };
};

/** A file name for a DBML export, based on the diagram name. */
export const dbmlFileName = (diagramName: string, withAreas: boolean) => {
    const base = diagramName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'diagram';
    return withAreas ? `${base}.luxdb.dbml` : `${base}.dbml`;
};
