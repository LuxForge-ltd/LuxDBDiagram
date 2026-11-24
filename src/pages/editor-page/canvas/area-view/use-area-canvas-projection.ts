/**
 * Area canvas projection (LuxDBDiagram).
 *
 * Purpose: gives the canvas the tables, relationships and dependencies to draw for the open
 * Area, and routes canvas edits made inside an Area to the right place.
 * Scope: the bridge between ChartDB's canvas and Area metadata. In the "All tables" view it
 * passes ChartDB's data straight through, so ChartDB behaves exactly as before.
 * Operational role: called once by `Canvas`.
 *
 * Inside an Area:
 * - moving a table moves only this Area's instance;
 * - deleting a table node removes it from this Area only (the table stays in the schema);
 * - resizing a table changes its width everywhere (width is part of the table's display in
 *   every view).
 */
import { useCallback, useMemo } from 'react';
import type {
    NodeDimensionChange,
    NodePositionChange,
    NodeRemoveChange,
} from '@xyflow/react';
import { useChartDB } from '@/hooks/use-chartdb';
import { useAreaView } from '@/hooks/use-area-view';
import { projectAreaView } from '@/lib/areas/resolve-area-view';
import {
    removeTableInstances,
    setInstancePositions,
} from '@/lib/areas/area-view-ops';
import type { AreaView } from '@/lib/domain/area-view';

export interface AreaTableChanges {
    positionChanges: NodePositionChange[];
    removeChanges: NodeRemoveChange[];
    sizeChanges: NodeDimensionChange[];
}

export const useAreaCanvasProjection = () => {
    const {
        tables,
        relationships,
        dependencies,
        areaViews,
        mutateAreaView,
        updateTablesState,
    } = useChartDB();
    const { currentAreaViewId } = useAreaView();

    const currentAreaView: AreaView | null = useMemo(
        () => areaViews.find((view) => view.id === currentAreaViewId) ?? null,
        [areaViews, currentAreaViewId]
    );

    const projection = useMemo(
        () =>
            currentAreaView
                ? projectAreaView({
                      areaView: currentAreaView,
                      tables,
                      relationships,
                      dependencies,
                  })
                : null,
        [currentAreaView, tables, relationships, dependencies]
    );

    /**
     * Applies table node changes made while an Area is open. Moves and removals change only
     * the Area; width changes go to the canonical table.
     */
    const applyTableChanges = useCallback(
        ({ positionChanges, removeChanges, sizeChanges }: AreaTableChanges) => {
            if (!currentAreaView) return;

            const positions = positionChanges
                .filter((change) => change.position)
                .map((change) => ({
                    tableId: change.id,
                    x: change.position!.x,
                    y: change.position!.y,
                }));
            const removedIds = removeChanges.map((change) => change.id);

            if (positions.length > 0 || removedIds.length > 0) {
                mutateAreaView(currentAreaView.id, (view) =>
                    removeTableInstances(
                        setInstancePositions(view, positions),
                        removedIds
                    )
                );
            }

            if (sizeChanges.length > 0) {
                updateTablesState(
                    (current) =>
                        current.map((table) => {
                            const size = sizeChanges.find(
                                (change) => change.id === table.id
                            );
                            return size?.dimensions?.width
                                ? { ...table, width: size.dimensions.width }
                                : table;
                        }),
                    { updateHistory: true }
                );
            }
        },
        [currentAreaView, mutateAreaView, updateTablesState]
    );

    return {
        isAreaMode: !!projection,
        currentAreaView,
        tables: projection?.tables ?? tables,
        relationships: projection?.relationships ?? relationships,
        dependencies: projection?.dependencies ?? dependencies,
        crossRelationships: projection?.crossRelationships ?? [],
        applyTableChanges,
    };
};
