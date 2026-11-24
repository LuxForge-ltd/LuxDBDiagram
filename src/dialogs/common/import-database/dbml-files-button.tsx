/**
 * Open DBML files (LuxDBDiagram).
 *
 * Purpose: loads one or more `.dbml` files into the DBML import editor. Several files are
 * merged into one schema (see `mergeDBMLFiles`), so a schema split across files, with
 * references between them, imports as one diagram. A file of Area blocks alone can be
 * included to bring the Areas with it.
 * Scope: reading files and filling the editor; validation and import are ChartDB's.
 * Operational role: shown above the DBML editor in the import dialogs.
 */
import React, { useCallback, useRef } from 'react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/button/button';
import { useToast } from '@/components/toast/use-toast';
import { mergeDBMLFiles } from '@/lib/areas/multi-file-dbml';

export interface DBMLFilesButtonProps {
    onLoad: (content: string) => void;
}

export const DBMLFilesButton: React.FC<DBMLFilesButtonProps> = ({ onLoad }) => {
    const { t } = useTranslation();
    const { toast } = useToast();
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFiles = useCallback(
        async (fileList: FileList | null) => {
            if (!fileList || fileList.length === 0) return;
            const files = await Promise.all(
                [...fileList].map(async (file) => ({
                    name: file.name,
                    content: await file.text(),
                }))
            );

            if (files.length === 1) {
                onLoad(files[0].content);
                return;
            }

            const merged = mergeDBMLFiles(files);
            const errors = merged.issues.filter(
                (issue) => issue.severity === 'error'
            );
            if (errors.length > 0) {
                toast({
                    variant: 'destructive',
                    title: t('luxdb.import.files_conflict_title'),
                    description: errors.map((e) => e.message).join(' '),
                });
                return;
            }

            onLoad(merged.content);
            const warnings = merged.issues.map((issue) => issue.message);
            toast({
                title: t('luxdb.import.files_merged_title', {
                    count: files.length,
                }),
                description:
                    warnings.length > 0
                        ? warnings.join(' ')
                        : t('luxdb.import.files_merged_description'),
            });
        },
        [onLoad, toast, t]
    );

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                multiple
                accept=".dbml,.txt,text/plain"
                className="hidden"
                data-testid="dbml-files-input"
                onChange={(event) => {
                    handleFiles(event.target.files);
                    // Allow choosing the same files again.
                    event.target.value = '';
                }}
            />
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={() => inputRef.current?.click()}
                title={t('luxdb.import.open_files_title')}
            >
                <FolderOpen className="size-3.5" />
                {t('luxdb.import.open_files')}
            </Button>
        </>
    );
};
