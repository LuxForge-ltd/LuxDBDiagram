/**
 * DBML file export action (LuxDBDiagram).
 *
 * Purpose: downloads the open diagram as standard DBML or as LuxDBDiagram DBML (with Areas),
 * and tells the user about anything the export had to leave out.
 * Scope: file download and messages; the text comes from `exportDiagramAsDBML`.
 * Operational role: used by the Export menu.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useChartDB } from '@/hooks/use-chartdb';
import { useToast } from '@/components/toast/use-toast';
import {
    dbmlFileName,
    exportDiagramAsDBML,
} from '@/lib/areas/dbml-file-export';

/** Saves text as a file through the browser's download. */
const downloadText = (fileName: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('download', fileName);
    link.setAttribute('href', url);
    link.click();
    // Give the browser time to start the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const useDBMLFileExport = () => {
    const { t } = useTranslation();
    const { toast } = useToast();
    const { currentDiagram } = useChartDB();

    return useCallback(
        (withAreas: boolean) => {
            try {
                const { content, warnings } = exportDiagramAsDBML(
                    currentDiagram,
                    { withAreas }
                );
                downloadText(
                    dbmlFileName(currentDiagram.name, withAreas),
                    content
                );
                if (warnings.length > 0) {
                    toast({
                        title: t('luxdb.export.warnings_title'),
                        description: warnings.join(' '),
                    });
                }
            } catch (error) {
                toast({
                    variant: 'destructive',
                    title: t('luxdb.export.failed_title'),
                    description:
                        error instanceof Error ? error.message : String(error),
                });
            }
        },
        [currentDiagram, toast, t]
    );
};
