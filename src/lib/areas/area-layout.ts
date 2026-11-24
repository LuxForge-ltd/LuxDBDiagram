/**
 * Area layout (LuxDBDiagram).
 *
 * Purpose: gives positions to tables placed in an Area without one (for example from a bare
 * `Area` block, or when tables are added in bulk).
 * Scope: positions on an Area's own canvas only. Canonical table positions (the "All tables"
 * view) are never changed.
 * Operational role: reuses ChartDB's relationship-aware `adjustTablePositions` when a whole
 * Area needs laying out, and a simple grid when only some tables need a place.
 */
import type { AreaViewTableInstance } from '@/lib/domain/area-view';
import type { DBRelationship } from '@/lib/domain/db-relationship';
import type { DBTable } from '@/lib/domain/db-table';
import {
    adjustTablePositions,
    getTableDimensions,
} from '@/lib/domain/db-table';
import { AREA_LAYOUT_GAP } from './area-view-ops';

/** An instance that may not have a position yet. */
export type PendingInstance = Omit<AreaViewTableInstance, 'x' | 'y'> & {
    x?: number;
    y?: number;
};

const hasPosition = (
    instance: PendingInstance
): instance is AreaViewTableInstance =>
    typeof instance.x === 'number' && typeof instance.y === 'number';

/**
 * Fills in missing positions for an Area's instances.
 *
 * - Every instance already positioned: returned unchanged.
 * - None positioned: laid out with ChartDB's relationship-aware layout, using only the
 *   relationships between tables in this Area.
 * - Some positioned: the rest go in a grid below the positioned ones, so nothing that the
 *   user placed moves.
 *
 * @param input The instances, plus the canonical tables and relationships.
 * @returns Every instance with a position, in the original order.
 */
export const layoutAreaInstances = ({
    instances,
    tables,
    relationships,
}: {
    instances: readonly PendingInstance[];
    tables: readonly DBTable[];
    relationships: readonly DBRelationship[];
}): AreaViewTableInstance[] => {
    const tablesById = new Map(tables.map((table) => [table.id, table]));
    const unpositioned = instances.filter((i) => !hasPosition(i));

    if (unpositioned.length === 0) {
        return instances as AreaViewTableInstance[];
    }

    const positioned = instances.filter(hasPosition);

    if (positioned.length === 0) {
        return layoutWholeArea(instances, tablesById, relationships);
    }

    const placed = placeInGrid(unpositioned, tablesById, positioned);
    return instances.map((instance) =>
        hasPosition(instance)
            ? instance
            : (placed.get(instance.tableId) as AreaViewTableInstance)
    );
};

/** Lays out every instance with ChartDB's layout algorithm. */
const layoutWholeArea = (
    instances: readonly PendingInstance[],
    tablesById: Map<string, DBTable>,
    relationships: readonly DBRelationship[]
): AreaViewTableInstance[] => {
    const memberIds = new Set(instances.map((i) => i.tableId));
    const members = instances
        .map((i) => tablesById.get(i.tableId))
        .filter((table): table is DBTable => !!table);

    const arranged = adjustTablePositions({
        tables: members,
        relationships: relationships.filter(
            (rel) =>
                memberIds.has(rel.sourceTableId) &&
                memberIds.has(rel.targetTableId)
        ),
        mode: 'all',
    });
    const arrangedById = new Map(arranged.map((t) => [t.id, t]));

    return instances.map((instance) => {
        const table = arrangedById.get(instance.tableId);
        return {
            tableId: instance.tableId,
            x: table?.x ?? 0,
            y: table?.y ?? 0,
        };
    });
};

/**
 * Places instances in a roughly square grid starting below the bounding box of the
 * instances that already have positions.
 */
const placeInGrid = (
    pending: readonly PendingInstance[],
    tablesById: Map<string, DBTable>,
    positioned: readonly AreaViewTableInstance[]
): Map<string, AreaViewTableInstance> => {
    const sizeOf = (tableId: string) => {
        const table = tablesById.get(tableId);
        return table ? getTableDimensions(table) : { width: 224, height: 120 };
    };

    const left = Math.min(...positioned.map((p) => p.x));
    const bottom = Math.max(
        ...positioned.map((p) => p.y + sizeOf(p.tableId).height)
    );
    const columns = Math.max(1, Math.ceil(Math.sqrt(pending.length)));
    const placed = new Map<string, AreaViewTableInstance>();

    let rowTop = bottom + AREA_LAYOUT_GAP;
    for (let rowStart = 0; rowStart < pending.length; rowStart += columns) {
        const row = pending.slice(rowStart, rowStart + columns);
        let x = left;
        let rowHeight = 0;
        for (const instance of row) {
            const { width, height } = sizeOf(instance.tableId);
            placed.set(instance.tableId, {
                tableId: instance.tableId,
                x,
                y: rowTop,
            });
            x += width + AREA_LAYOUT_GAP;
            rowHeight = Math.max(rowHeight, height);
        }
        rowTop += rowHeight + AREA_LAYOUT_GAP;
    }

    return placed;
};
