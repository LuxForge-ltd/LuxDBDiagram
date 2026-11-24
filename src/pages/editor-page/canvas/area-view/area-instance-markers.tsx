/**
 * Dupe markers (LuxDBDiagram).
 *
 * Purpose: shows small numbered markers in a table's header, one per Area that shows the
 * table ([1] [2] [3] ...). Clicking a number opens that Area, centres the table and briefly
 * highlights it, so the user never has to search for another appearance of the same table.
 * Scope: navigation only.
 * Operational role: rendered in ChartDB's table node header.
 *
 * Numbering follows Area order, so a table's numbers are the same in every view. The marker
 * for the open Area is filled with the Area's colour.
 */
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useChartDB } from '@/hooks/use-chartdb';
import { useAreaView } from '@/hooks/use-area-view';
import { getInstanceMarkers } from '@/lib/areas/area-view-ops';
import { cn } from '@/lib/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/tooltip/tooltip';

export interface AreaInstanceMarkersProps {
    tableId: string;
}

export const AreaInstanceMarkers: React.FC<AreaInstanceMarkersProps> = ({
    tableId,
}) => {
    const { t } = useTranslation();
    const { areaViews } = useChartDB();
    const { currentAreaViewId, selectAreaView, requestFocus } = useAreaView();

    const markers = useMemo(
        () => getInstanceMarkers(areaViews, tableId, currentAreaViewId),
        [areaViews, tableId, currentAreaViewId]
    );

    if (markers.length === 0) return null;

    return (
        <div
            className="nodrag flex shrink-0 items-center gap-0.5"
            data-testid="area-instance-markers"
        >
            {markers.map((marker) => (
                <Tooltip key={marker.areaViewId}>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            aria-current={marker.current || undefined}
                            aria-label={t('luxdb.dupes.go_to', {
                                number: marker.number,
                                area: marker.name,
                            })}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (marker.current) {
                                    requestFocus({ tableId });
                                } else {
                                    selectAreaView(marker.areaViewId, {
                                        focus: { tableId },
                                    });
                                }
                            }}
                            className={cn(
                                'flex h-4 min-w-4 items-center justify-center rounded border px-1 text-[10px] font-bold leading-none tabular-nums transition-colors',
                                marker.current
                                    ? 'text-slate-900'
                                    : 'bg-transparent text-foreground hover:bg-background'
                            )}
                            style={{
                                borderColor: marker.color,
                                ...(marker.current
                                    ? { backgroundColor: marker.color }
                                    : {}),
                            }}
                        >
                            {marker.number}
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>
                        {marker.current
                            ? t('luxdb.dupes.current', { area: marker.name })
                            : t('luxdb.dupes.go_to', {
                                  number: marker.number,
                                  area: marker.name,
                              })}
                    </TooltipContent>
                </Tooltip>
            ))}
        </div>
    );
};
