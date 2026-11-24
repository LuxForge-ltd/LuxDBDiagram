/**
 * Area view resolution (LuxDBDiagram).
 *
 * Purpose: works out what an Area's canvas shows, from the canonical schema and the Area's
 * presentation metadata.
 * Scope: pure and deterministic. It never changes the schema: shown tables are copies with
 * the Area's positions and colour applied, and relationships are filtered, never created.
 * Operational role: the canvas draws whatever this returns when an Area is open.
 */
import type { AreaView } from '@/lib/domain/area-view';
import type { DBDependency } from '@/lib/domain/db-dependency';
import type { DBRelationship } from '@/lib/domain/db-relationship';
import type { DBTable } from '@/lib/domain/db-table';

export interface AreaProjection {
    /** Tables shown in the Area, in instance order, positioned and coloured for the Area. */
    tables: DBTable[];
    /** Ids of the canonical tables shown. */
    tableIds: Set<string>;
    /** Relationships with both ends shown: drawn as normal ChartDB relationship lines. */
    relationships: DBRelationship[];
    /** View dependencies with both ends shown. */
    dependencies: DBDependency[];
    /**
     * Relationships with exactly one end shown. Phase 05 draws these as Floats; they are
     * never hidden from the model.
     */
    crossRelationships: DBRelationship[];
}

/**
 * Projects the canonical schema through one Area.
 *
 * @param input The Area plus the canonical tables, relationships and dependencies.
 * @returns What the Area's canvas shows.
 */
export const projectAreaView = ({
    areaView,
    tables,
    relationships,
    dependencies,
}: {
    areaView: AreaView;
    tables: readonly DBTable[];
    relationships: readonly DBRelationship[];
    dependencies: readonly DBDependency[];
}): AreaProjection => {
    const tablesById = new Map(tables.map((table) => [table.id, table]));
    const shown: DBTable[] = [];
    const tableIds = new Set<string>();

    for (const instance of areaView.tables) {
        const table = tablesById.get(instance.tableId);
        // Instances of deleted tables are skipped (kept in storage so undo restores them).
        if (!table || tableIds.has(table.id)) continue;
        tableIds.add(table.id);
        shown.push({
            ...table,
            x: instance.x,
            y: instance.y,
            // The Area's colour is a visual property of this view only.
            color: areaView.color,
            // ChartDB Groups belong to the "All tables" layout, not to Areas.
            parentAreaId: null,
        });
    }

    const internal: DBRelationship[] = [];
    const cross: DBRelationship[] = [];
    for (const relationship of relationships) {
        const sourceShown = tableIds.has(relationship.sourceTableId);
        const targetShown = tableIds.has(relationship.targetTableId);
        if (sourceShown && targetShown) internal.push(relationship);
        else if (sourceShown || targetShown) cross.push(relationship);
    }

    return {
        tables: shown,
        tableIds,
        relationships: internal,
        dependencies: dependencies.filter(
            (dependency) =>
                tableIds.has(dependency.tableId) &&
                tableIds.has(dependency.dependentTableId)
        ),
        crossRelationships: cross,
    };
};
