/**
 * Area membership actions (LuxDBDiagram).
 *
 * Purpose: adds tables to and removes tables from Areas, for the table library, drag and
 * drop, and the table menu.
 * Scope: Area metadata only. Adding a table never copies it; removing one never deletes the
 * table, its columns or relationships, or its appearances in other Areas.
 * Operational role: the single place where membership changes are made from the UI, so the
 * "one appearance per Area" rule and the user feedback are consistent everywhere.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useChartDB } from '@/hooks/use-chartdb';
import { useAreaView } from '@/hooks/use-area-view';
import { useToast } from '@/components/toast/use-toast';
import {
    addTableInstances,
    removeTableInstances,
} from '@/lib/areas/area-view-ops';
import { placeNewInstances } from '@/lib/areas/area-layout';

/** Drag data type used when a table is dragged from the table library. */
export const AREA_TABLE_DRAG_TYPE = 'application/x-luxdb-table';

export const useAreaMembership = () => {
    const { t } = useTranslation();
    const { toast } = useToast();
    const { tables, relationships, getAreaView, mutateAreaView } = useChartDB();
    const { currentAreaViewId, requestFocus } = useAreaView();

    const tableName = useCallback(
        (tableId: string) =>
            tables.find((table) => table.id === tableId)?.name ?? tableId,
        [tables]
    );

    /**
     * Adds tables to an Area. With a position (a drop), the first table goes there; without
     * one, the tables are placed below the Area's existing tables. Tables already in the Area
     * are not added again: the user is told, and the existing one is brought into view.
     *
     * @returns The ids actually added.
     */
    const addTablesToArea = useCallback(
        async (
            areaViewId: string,
            tableIds: string[],
            position?: { x: number; y: number }
        ): Promise<string[]> => {
            const areaView = getAreaView(areaViewId);
            if (!areaView) return [];

            const instances = position
                ? tableIds.map((tableId, index) => ({
                      tableId,
                      x: position.x + index * 40,
                      y: position.y + index * 40,
                  }))
                : placeNewInstances({
                      existing: areaView.tables,
                      tableIds,
                      tables,
                      relationships,
                  });

            let added: string[] = [];
            let skipped: string[] = [];
            await mutateAreaView(areaViewId, (view) => {
                const result = addTableInstances(view, instances);
                added = result.added;
                // Instances already present are filtered out by placeNewInstances, so work
                // out the skipped tables against the requested ids.
                skipped = tableIds.filter(
                    (id) =>
                        !result.added.includes(id) &&
                        view.tables.some((i) => i.tableId === id)
                );
                return result.areaView;
            });

            if (skipped.length > 0) {
                toast({
                    title: t('luxdb.membership.already_in_area_title', {
                        area: areaView.name,
                    }),
                    description: t(
                        'luxdb.membership.already_in_area_description',
                        { tables: skipped.map(tableName).join(', ') }
                    ),
                });
                if (areaViewId === currentAreaViewId && added.length === 0) {
                    requestFocus({ tableId: skipped[0] });
                }
            }

            return added;
        },
        [
            getAreaView,
            mutateAreaView,
            tables,
            relationships,
            toast,
            t,
            tableName,
            currentAreaViewId,
            requestFocus,
        ]
    );

    /**
     * Removes tables from one Area only.
     */
    const removeTablesFromArea = useCallback(
        async (areaViewId: string, tableIds: string[]) => {
            if (tableIds.length === 0) return;
            await mutateAreaView(areaViewId, (view) =>
                removeTableInstances(view, tableIds)
            );
        },
        [mutateAreaView]
    );

    return { addTablesToArea, removeTablesFromArea };
};
