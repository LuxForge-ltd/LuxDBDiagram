/**
 * Save the diagram as files (LuxDBDiagram).
 *
 * Purpose: writes the open diagram as one DBML file per Area, plus the Areas file, into a
 * folder the user picks (Edge and Chrome), or downloads the files elsewhere. The user confirms
 * first, seeing which files will be written and what the exporter changes.
 * Scope: the files come from `generateAreaFiles`.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useChartDB } from '@/hooks/use-chartdb';
import { useToast } from '@/components/toast/use-toast';
import { useAlert } from '@/context/alert-context/alert-context';
import { generateAreaFiles } from '@/lib/areas/area-files';
import {
    canWriteFolder,
    downloadFiles,
    pickWritableFolder,
    writeFilesToFolder,
    type FileToWrite,
} from '@/lib/areas/folder-write';

export const useSaveAreaFiles = () => {
    const { t } = useTranslation();
    const { toast } = useToast();
    const { showAlert } = useAlert();
    const { currentDiagram } = useChartDB();

    const fail = useCallback(
        (error: unknown) =>
            toast({
                variant: 'destructive',
                title: t('luxdb.files.save_failed'),
                description:
                    error instanceof Error ? error.message : String(error),
            }),
        [toast, t]
    );

    const write = useCallback(
        async (files: FileToWrite[], warnings: string[]) => {
            if (!canWriteFolder()) {
                downloadFiles(files);
                toast({
                    title: t('luxdb.files.downloaded_title'),
                    description: [
                        t('luxdb.files.downloaded_description'),
                        ...warnings,
                    ].join(' '),
                });
                return;
            }
            try {
                const folder = await pickWritableFolder();
                if (!folder) return;
                const count = await writeFilesToFolder(folder, files);
                toast({
                    title: t('luxdb.files.saved_title', {
                        count,
                        folder: folder.name,
                    }),
                    description: warnings.join(' ') || undefined,
                });
            } catch (error) {
                fail(error);
            }
        },
        [fail, toast, t]
    );

    return useCallback(() => {
        let files: FileToWrite[];
        let warnings: string[];
        try {
            const written = generateAreaFiles(currentDiagram);
            files = [
                ...written.files,
                ...(written.layout ? [written.layout] : []),
            ].map((file) => ({ path: file.path, content: file.content }));
            warnings = written.warnings;
        } catch (error) {
            fail(error);
            return;
        }
        if (files.length === 0) {
            toast({ title: t('luxdb.files.nothing_to_save') });
            return;
        }

        showAlert({
            title: t('luxdb.files.save_title'),
            description: t('luxdb.files.save_description', {
                count: files.length,
                files: files.map((file) => file.path).join(', '),
            }),
            actionLabel: canWriteFolder()
                ? t('luxdb.files.choose_folder')
                : t('luxdb.files.download_files'),
            closeLabel: t('luxdb.common.cancel'),
            // The folder picker needs the click, so writing starts straight from it.
            onAction: () => {
                void write(files, warnings);
            },
        });
    }, [currentDiagram, fail, showAlert, toast, t, write]);
};
