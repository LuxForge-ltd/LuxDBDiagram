/**
 * Float filter control (LuxDBDiagram).
 *
 * Purpose: shows how many Floats the open Area has and switches between showing every
 * Float and showing outgoing Floats only (incoming references are then summarised on one
 * card, never hidden).
 * Scope: the Area's `floatFilter` presentation setting.
 * Operational role: a small panel at the top right of the canvas while an Area is open.
 */
import React from 'react';
import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChartDB } from '@/hooks/use-chartdb';
import type { AreaFloatFilter, AreaView } from '@/lib/domain/area-view';
import { cn } from '@/lib/utils';

export interface AreaFloatControlsProps {
    areaView: AreaView;
    counts: { shown: number; total: number; incomingReferences: number };
}

export const AreaFloatControls: React.FC<AreaFloatControlsProps> = ({
    areaView,
    counts,
}) => {
    const { t } = useTranslation();
    const { updateAreaViews, readonly } = useChartDB();
    const filter: AreaFloatFilter = areaView.floatFilter ?? 'all';

    if (counts.total === 0) return null;

    const option = (value: AreaFloatFilter, label: string, title: string) => (
        <button
            type="button"
            disabled={readonly}
            title={title}
            aria-pressed={filter === value}
            onClick={() =>
                filter !== value &&
                updateAreaViews([
                    { id: areaView.id, attributes: { floatFilter: value } },
                ])
            }
            className={cn(
                'h-6 rounded px-2 text-[11px] font-medium transition-colors',
                filter === value
                    ? 'border border-border bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
        >
            {label}
        </button>
    );

    return (
        <div
            className="flex items-center gap-1 rounded-lg border border-border bg-secondary/90 p-1 shadow-sm backdrop-blur"
            data-testid="area-float-controls"
        >
            <span
                className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground"
                title={t('luxdb.floats.controls_title')}
            >
                <Link2 className="size-3.5" />
                {t('luxdb.floats.count', { count: counts.shown })}
            </span>
            {option(
                'all',
                t('luxdb.floats.filter_all'),
                t('luxdb.floats.filter_all_title')
            )}
            {option(
                'outgoing',
                t('luxdb.floats.filter_outgoing'),
                t('luxdb.floats.filter_outgoing_title', {
                    count: counts.incomingReferences,
                })
            )}
        </div>
    );
};
