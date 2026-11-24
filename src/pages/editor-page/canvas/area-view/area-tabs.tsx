/**
 * Area tabs (LuxDBDiagram).
 *
 * Purpose: switches the canvas between "All tables" and each Area, offers "Back" to the
 * previously viewed Area, and creates new Areas.
 * Scope: navigation UI only.
 * Operational role: rendered as a panel at the top of the canvas.
 */
import React, { useCallback, useMemo } from 'react';
import { ArrowLeft, LayoutGrid, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChartDB } from '@/hooks/use-chartdb';
import { useAreaView } from '@/hooks/use-area-view';
import { getLiveInstances, sortAreaViews } from '@/lib/areas/area-view-ops';
import { cn } from '@/lib/utils';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/tooltip/tooltip';

interface TabButtonProps {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    title?: string;
}

const TabButton: React.FC<TabButtonProps> = ({
    active,
    onClick,
    children,
    title,
}) => (
    <button
        type="button"
        title={title}
        onClick={onClick}
        aria-pressed={active}
        className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors',
            active
                ? 'border border-border bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
    >
        {children}
    </button>
);

export const AreaTabs: React.FC = () => {
    const { t } = useTranslation();
    const { areaViews, tables, createAreaView, readonly } = useChartDB();
    const { currentAreaViewId, selectAreaView, backHistory, goBack } =
        useAreaView();

    const tableIds = useMemo(
        () => new Set(tables.map((table) => table.id)),
        [tables]
    );
    const ordered = useMemo(() => sortAreaViews(areaViews), [areaViews]);

    const previousName = useMemo(() => {
        if (backHistory.length === 0) return null;
        const previous = backHistory[backHistory.length - 1];
        return previous === null
            ? t('luxdb.areas.all_tables')
            : (areaViews.find((view) => view.id === previous)?.name ?? null);
    }, [backHistory, areaViews, t]);

    const handleCreate = useCallback(async () => {
        const areaView = await createAreaView();
        selectAreaView(areaView.id);
    }, [createAreaView, selectAreaView]);

    if (areaViews.length === 0 && readonly) {
        return null;
    }

    return (
        <div
            className="flex max-w-[min(72vw,760px)] items-center gap-1 overflow-x-auto rounded-lg border border-border bg-secondary/90 p-1 shadow-sm backdrop-blur"
            data-testid="area-tabs"
        >
            {previousName !== null ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            onClick={goBack}
                            aria-label={t('luxdb.areas.back', {
                                name: previousName,
                            })}
                            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <ArrowLeft className="size-4" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>
                        {t('luxdb.areas.back', { name: previousName })}
                    </TooltipContent>
                </Tooltip>
            ) : null}

            <TabButton
                active={currentAreaViewId === null}
                onClick={() => selectAreaView(null)}
            >
                <LayoutGrid className="size-3.5" />
                {t('luxdb.areas.all_tables')}
            </TabButton>

            {ordered.map((areaView) => (
                <TabButton
                    key={areaView.id}
                    active={currentAreaViewId === areaView.id}
                    onClick={() => selectAreaView(areaView.id)}
                    title={areaView.name}
                >
                    <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: areaView.color }}
                        aria-hidden
                    />
                    <span className="max-w-40 truncate">{areaView.name}</span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                        {getLiveInstances(areaView, tableIds).length}
                    </span>
                </TabButton>
            ))}

            {!readonly ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            onClick={handleCreate}
                            aria-label={t('luxdb.areas.new_area')}
                            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                            <Plus className="size-4" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>{t('luxdb.areas.new_area')}</TooltipContent>
                </Tooltip>
            ) : null}
        </div>
    );
};
