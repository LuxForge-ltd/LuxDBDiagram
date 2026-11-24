/**
 * Empty Area message (LuxDBDiagram).
 *
 * Purpose: tells the user how to put tables into an Area that has none yet.
 * Scope: display only.
 * Operational role: shown over the canvas while the open Area has no tables.
 */
import React from 'react';
import { Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/button/button';
import { useLayout } from '@/hooks/use-layout';

export const AreaEmptyState: React.FC = () => {
    const { t } = useTranslation();
    const { showSidePanel, selectSidebarSection } = useLayout();

    return (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-2 rounded-lg border bg-background/90 px-5 py-4 text-center shadow-sm backdrop-blur-sm">
                <Layers className="size-6 text-muted-foreground" />
                <div className="text-sm font-medium">
                    {t('luxdb.areas.empty_area_title')}
                </div>
                <div className="text-xs text-muted-foreground">
                    {t('luxdb.areas.empty_area_description')}
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        showSidePanel();
                        selectSidebarSection('areaViews');
                    }}
                >
                    {t('luxdb.areas.open_panel')}
                </Button>
            </div>
        </div>
    );
};
