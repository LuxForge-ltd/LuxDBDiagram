/**
 * Float navigation (LuxDBDiagram).
 *
 * Purpose: follows a Float row to the table and column it refers to.
 * Scope: navigation only.
 * Operational role: used by Float rows. The destination is the first Area (in Area order)
 * that shows the table; from there, the table's Dupe markers reach its other Areas.
 */
import { useCallback } from 'react';
import { useChartDB } from '@/hooks/use-chartdb';
import { useAreaView } from '@/hooks/use-area-view';
import { getAreaViewsContainingTable } from '@/lib/areas/area-view-ops';
import type { AreaView } from '@/lib/domain/area-view';

export const useFloatNavigation = () => {
    const { areaViews } = useChartDB();
    const { selectAreaView } = useAreaView();

    /** The first Area, in Area order, that shows the table; null when none does. */
    const findHomeArea = useCallback(
        (tableId: string): AreaView | null =>
            getAreaViewsContainingTable(areaViews, tableId)[0] ?? null,
        [areaViews]
    );

    /**
     * Opens the table's first Area, centres the table and highlights the column.
     *
     * @returns False when no Area shows the table (the caller offers alternatives).
     */
    const goToColumn = useCallback(
        (tableId: string, fieldId: string): boolean => {
            const home = findHomeArea(tableId);
            if (!home) return false;
            selectAreaView(home.id, { focus: { tableId, fieldId } });
            return true;
        },
        [findHomeArea, selectAreaView]
    );

    /** Shows the table in the "All tables" view, centred, with the column highlighted. */
    const showInAllTables = useCallback(
        (tableId: string, fieldId: string) =>
            selectAreaView(null, { focus: { tableId, fieldId } }),
        [selectAreaView]
    );

    return { findHomeArea, goToColumn, showInAllTables };
};
