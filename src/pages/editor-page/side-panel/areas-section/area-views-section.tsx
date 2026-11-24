/**
 * Areas panel (LuxDBDiagram).
 *
 * Purpose: lists the diagram's Areas so they can be opened, created, renamed, recoloured,
 * reordered and deleted.
 * Scope: Area metadata only.
 * Operational role: the side-panel section opened from the "Areas" sidebar item.
 */
import React, { useCallback, useMemo } from 'react';
import { LayoutGrid, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    closestCenter,
    DndContext,
    type DragEndEvent,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useChartDB } from '@/hooks/use-chartdb';
import { useAreaView } from '@/hooks/use-area-view';
import { Button } from '@/components/button/button';
import { EmptyState } from '@/components/empty-state/empty-state';
import {
    getLiveInstances,
    reorderAreaViews,
    sortAreaViews,
} from '@/lib/areas/area-view-ops';
import { cn } from '@/lib/utils';
import { AreaViewListItem } from './area-view-list-item';
import { AreaTableLibrary } from './area-table-library';

export const AreaViewsSection: React.FC = () => {
    const { t } = useTranslation();
    const { areaViews, tables, createAreaView, updateAreaViews, readonly } =
        useChartDB();
    const { currentAreaViewId, selectAreaView } = useAreaView();
    const sensors = useSensors(useSensor(PointerSensor));

    const ordered = useMemo(() => sortAreaViews(areaViews), [areaViews]);
    const currentAreaView = useMemo(
        () => areaViews.find((view) => view.id === currentAreaViewId) ?? null,
        [areaViews, currentAreaViewId]
    );
    const tableIds = useMemo(
        () => new Set(tables.map((table) => table.id)),
        [tables]
    );

    const handleCreate = useCallback(async () => {
        const areaView = await createAreaView();
        selectAreaView(areaView.id);
    }, [createAreaView, selectAreaView]);

    const handleDragEnd = useCallback(
        ({ active, over }: DragEndEvent) => {
            if (!over || active.id === over.id) return;
            const ids = ordered.map((view) => view.id);
            const moved = arrayMove(
                ids,
                ids.indexOf(String(active.id)),
                ids.indexOf(String(over.id))
            );
            const changes = reorderAreaViews(areaViews, moved);
            if (changes.length > 0) {
                updateAreaViews(
                    changes.map(({ id, order }) => ({
                        id,
                        attributes: { order },
                    }))
                );
            }
        },
        [ordered, areaViews, updateAreaViews]
    );

    return (
        <section
            className="flex flex-1 flex-col overflow-hidden px-2"
            data-testid="areas-section"
        >
            <div className="flex items-center justify-between gap-4 py-1">
                <div className="text-sm font-semibold">
                    {t('luxdb.sidebar.areas')}
                </div>
                {!readonly ? (
                    <Button
                        variant="secondary"
                        className="h-8 p-2 text-xs"
                        onClick={handleCreate}
                    >
                        <Plus className="h-4" />
                        {t('luxdb.areas.new_area')}
                    </Button>
                ) : null}
            </div>

            {/* With an Area open, the list shares the panel with the table library. */}
            <div
                className={cn(
                    'overflow-y-auto',
                    currentAreaView ? 'max-h-[40%] shrink-0' : 'flex-1'
                )}
            >
                <div className="flex flex-col gap-1 pb-2">
                    <button
                        type="button"
                        onClick={() => selectAreaView(null)}
                        className={cn(
                            'flex h-11 w-full items-center gap-2 rounded-md border border-border px-3 text-left text-sm font-medium',
                            currentAreaViewId === null
                                ? 'bg-accent/60'
                                : 'hover:bg-accent/5'
                        )}
                    >
                        <LayoutGrid className="size-4 text-muted-foreground" />
                        <span className="flex-1">
                            {t('luxdb.areas.all_tables')}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                            {t('luxdb.areas.table_count', {
                                count: tables.length,
                            })}
                        </span>
                    </button>

                    {ordered.length === 0 ? (
                        <EmptyState
                            title={t('luxdb.areas.empty_title')}
                            description={t('luxdb.areas.empty_description')}
                            className="mt-12"
                            secondaryAction={
                                !readonly
                                    ? {
                                          label: t('luxdb.areas.new_area'),
                                          onClick: handleCreate,
                                      }
                                    : undefined
                            }
                        />
                    ) : (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={ordered.map((view) => view.id)}
                                strategy={verticalListSortingStrategy}
                            >
                                {ordered.map((areaView) => (
                                    <AreaViewListItem
                                        key={areaView.id}
                                        areaView={areaView}
                                        tableCount={
                                            getLiveInstances(areaView, tableIds)
                                                .length
                                        }
                                    />
                                ))}
                            </SortableContext>
                        </DndContext>
                    )}
                </div>
            </div>

            {currentAreaView ? (
                <AreaTableLibrary areaView={currentAreaView} />
            ) : null}
        </section>
    );
};
