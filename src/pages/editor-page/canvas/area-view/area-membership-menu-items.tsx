/**
 * Table menu: Area membership items (LuxDBDiagram).
 *
 * Purpose: "Remove from Area" (inside an Area) and "Add to Area" (any view) for the table or
 * tables the menu was opened on, including "New Area" from a selection.
 * Scope: Area membership only; the tables themselves are never changed.
 * Operational role: rendered inside ChartDB's table node context menu.
 */
import React, { useCallback, useMemo } from 'react';
import { Check, Layers, MinusCircle, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from '@/components/context-menu/context-menu';
import { useChartDB } from '@/hooks/use-chartdb';
import { useAreaView } from '@/hooks/use-area-view';
import { sortAreaViews } from '@/lib/areas/area-view-ops';
import { placeNewInstances } from '@/lib/areas/area-layout';
import { useAreaMembership } from './use-area-membership';

export interface AreaMembershipMenuItemsProps {
    /** The table the menu was opened on, plus any others selected with it. */
    tableIds: string[];
}

export const AreaMembershipMenuItems: React.FC<
    AreaMembershipMenuItemsProps
> = ({ tableIds }) => {
    const { t } = useTranslation();
    const { areaViews, tables, relationships, createAreaView } = useChartDB();
    const { currentAreaViewId, selectAreaView } = useAreaView();
    const { addTablesToArea, removeTablesFromArea } = useAreaMembership();
    const ordered = useMemo(() => sortAreaViews(areaViews), [areaViews]);
    const count = tableIds.length;

    const createAreaFromTables = useCallback(async () => {
        const areaView = await createAreaView({
            tables: placeNewInstances({
                existing: [],
                tableIds,
                tables,
                relationships,
            }),
        });
        selectAreaView(areaView.id);
    }, [createAreaView, tableIds, tables, relationships, selectAreaView]);

    const suffix = count > 1 ? ` (${count})` : '';

    return (
        <>
            {currentAreaViewId ? (
                <ContextMenuItem
                    onClick={() =>
                        removeTablesFromArea(currentAreaViewId, tableIds)
                    }
                    className="flex justify-between gap-3"
                >
                    <span>{`${t('luxdb.membership.remove_from_area')}${suffix}`}</span>
                    <MinusCircle className="size-3.5" />
                </ContextMenuItem>
            ) : null}
            <ContextMenuSub>
                <ContextMenuSubTrigger className="flex items-center gap-3">
                    <span>{`${t('luxdb.membership.add_to_area')}${suffix}`}</span>
                    <Layers className="ml-auto size-3.5" />
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                    <ContextMenuItem
                        onClick={createAreaFromTables}
                        className="flex items-center gap-2"
                    >
                        <Plus className="size-3.5" />
                        <span>
                            {t('luxdb.membership.new_area_with_tables')}
                        </span>
                    </ContextMenuItem>
                    {ordered.length > 0 ? <ContextMenuSeparator /> : null}
                    {ordered.map((areaView) => {
                        const containsAll = tableIds.every((id) =>
                            areaView.tables.some(
                                (instance) => instance.tableId === id
                            )
                        );
                        return (
                            <ContextMenuItem
                                key={areaView.id}
                                disabled={containsAll}
                                onClick={() =>
                                    addTablesToArea(areaView.id, tableIds)
                                }
                                className="flex items-center gap-2"
                            >
                                <span
                                    className="size-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: areaView.color }}
                                />
                                <span>{areaView.name}</span>
                                {containsAll ? (
                                    <Check className="ml-auto size-3.5" />
                                ) : null}
                            </ContextMenuItem>
                        );
                    })}
                </ContextMenuSubContent>
            </ContextMenuSub>
        </>
    );
};
