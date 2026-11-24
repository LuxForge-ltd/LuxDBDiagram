/**
 * Table library (LuxDBDiagram).
 *
 * Purpose: a searchable list of every table in the schema, for putting tables into the open
 * Area: drag one onto the canvas, or use its add button. Dropping a table node from the
 * canvas back onto the library removes it from the Area.
 * Scope: Area membership only; the library never edits tables.
 * Operational role: shown in the Areas panel while an Area is open.
 */
import React, { useMemo, useState } from 'react';
import { Check, GripVertical, Plus, Search, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChartDB } from '@/hooks/use-chartdb';
import { useAreaView } from '@/hooks/use-area-view';
import { Input } from '@/components/input/input';
import { ScrollArea } from '@/components/scroll-area/scroll-area';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/tooltip/tooltip';
import { cn } from '@/lib/utils';
import { defaultSchemas } from '@/lib/data/default-schemas';
import type { AreaView } from '@/lib/domain/area-view';
import {
    AREA_TABLE_DRAG_TYPE,
    useAreaMembership,
} from '@/pages/editor-page/canvas/area-view/use-area-membership';
import { AREA_LIBRARY_DROPZONE_ATTRIBUTE } from '@/pages/editor-page/canvas/area-view/use-area-drag-and-drop';

export interface AreaTableLibraryProps {
    areaView: AreaView;
}

export const AreaTableLibrary: React.FC<AreaTableLibraryProps> = ({
    areaView,
}) => {
    const { t } = useTranslation();
    const { tables, areaViews, databaseType, readonly } = useChartDB();
    const { draggingTableIds, requestFocus } = useAreaView();
    const { addTablesToArea } = useAreaMembership();
    const [search, setSearch] = useState('');

    const inArea = useMemo(
        () => new Set(areaView.tables.map((instance) => instance.tableId)),
        [areaView]
    );

    const areaCountByTable = useMemo(() => {
        const counts = new Map<string, number>();
        areaViews.forEach((view) =>
            view.tables.forEach((instance) =>
                counts.set(
                    instance.tableId,
                    (counts.get(instance.tableId) ?? 0) + 1
                )
            )
        );
        return counts;
    }, [areaViews]);

    const defaultSchema = defaultSchemas[databaseType];
    const rows = useMemo(() => {
        const query = search.trim().toLowerCase();
        return tables
            .map((table) => ({
                table,
                label:
                    table.schema && table.schema !== defaultSchema
                        ? `${table.schema}.${table.name}`
                        : table.name,
            }))
            .filter(
                ({ label }) => !query || label.toLowerCase().includes(query)
            )
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [tables, search, defaultSchema]);

    const draggingFromCanvas = draggingTableIds.length > 0;

    return (
        <div
            {...{ [AREA_LIBRARY_DROPZONE_ATTRIBUTE]: '' }}
            className={cn(
                'flex min-h-0 flex-1 flex-col gap-1 rounded-md border border-dashed p-2 transition-colors',
                draggingFromCanvas
                    ? 'border-pink-600 bg-pink-600/10'
                    : 'border-transparent'
            )}
            data-testid="area-table-library"
        >
            <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('luxdb.library.title')}
                </div>
                <div className="text-xs text-muted-foreground">
                    {t('luxdb.library.in_area_count', {
                        count: inArea.size,
                        total: tables.length,
                    })}
                </div>
            </div>

            {draggingFromCanvas ? (
                <div className="flex items-center gap-2 rounded-md bg-background/80 px-2 py-1.5 text-xs font-medium text-pink-600">
                    <Undo2 className="size-3.5" />
                    {t('luxdb.library.drop_to_remove', {
                        count: draggingTableIds.length,
                        area: areaView.name,
                    })}
                </div>
            ) : (
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('luxdb.library.search')}
                        className="h-8 pl-7 focus-visible:ring-0"
                    />
                </div>
            )}

            <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col">
                    {rows.map(({ table, label }) => {
                        const present = inArea.has(table.id);
                        const areaCount = areaCountByTable.get(table.id) ?? 0;
                        return (
                            <div
                                key={table.id}
                                draggable={!readonly && !present}
                                onDragStart={(event) => {
                                    event.dataTransfer.setData(
                                        AREA_TABLE_DRAG_TYPE,
                                        table.id
                                    );
                                    event.dataTransfer.effectAllowed = 'copy';
                                }}
                                className={cn(
                                    'group flex h-8 items-center gap-1.5 rounded px-1 text-sm',
                                    present
                                        ? 'text-muted-foreground'
                                        : 'cursor-grab hover:bg-accent active:cursor-grabbing'
                                )}
                                data-testid={`library-table-${table.name}`}
                            >
                                <GripVertical
                                    className={cn(
                                        'size-3.5 shrink-0',
                                        present
                                            ? 'opacity-0'
                                            : 'text-muted-foreground'
                                    )}
                                />
                                <span
                                    className="size-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: table.color }}
                                    aria-hidden
                                />
                                <button
                                    type="button"
                                    className="min-w-0 flex-1 truncate text-left"
                                    onClick={() =>
                                        present &&
                                        requestFocus({ tableId: table.id })
                                    }
                                    title={label}
                                >
                                    {label}
                                </button>
                                {areaCount > 0 ? (
                                    <span
                                        className="shrink-0 rounded bg-secondary px-1 text-[10px] tabular-nums text-muted-foreground"
                                        title={t('luxdb.library.area_count', {
                                            count: areaCount,
                                        })}
                                    >
                                        {areaCount}
                                    </span>
                                ) : null}
                                {present ? (
                                    <Check
                                        className="size-3.5 shrink-0 text-pink-600"
                                        aria-label={t('luxdb.library.in_area')}
                                    />
                                ) : !readonly ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    addTablesToArea(
                                                        areaView.id,
                                                        [table.id]
                                                    )
                                                }
                                                aria-label={t(
                                                    'luxdb.library.add',
                                                    { area: areaView.name }
                                                )}
                                                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-background hover:text-foreground group-hover:opacity-100"
                                            >
                                                <Plus className="size-3.5" />
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {t('luxdb.library.add', {
                                                area: areaView.name,
                                            })}
                                        </TooltipContent>
                                    </Tooltip>
                                ) : null}
                            </div>
                        );
                    })}
                    {rows.length === 0 ? (
                        <div className="py-6 text-center text-xs text-muted-foreground">
                            {t('luxdb.library.no_results')}
                        </div>
                    ) : null}
                </div>
            </ScrollArea>
        </div>
    );
};
