/**
 * Files of an opened folder (LuxDBDiagram).
 *
 * Purpose: lists the folder's `.dbml` files beside the import editor. Tick a file to include it
 * (each included file becomes an Area); click a file to show and edit it in the editor; click
 * "Combined import" to see exactly what will be imported.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, FileCode2, Layers, X } from 'lucide-react';
import { Checkbox } from '@/components/checkbox/checkbox';
import { cn } from '@/lib/utils';
import type { DBMLFolderController } from './use-dbml-folder';

export interface DBMLFolderPanelProps {
    controller: DBMLFolderController;
}

export const DBMLFolderPanel: React.FC<DBMLFolderPanelProps> = ({
    controller,
}) => {
    const { t } = useTranslation();
    const { folder, composed, summaries, setActive, toggle, close } =
        controller;
    if (!folder || !composed) return null;

    const errors = composed.issues.filter(
        (issue) => issue.severity === 'error'
    );
    const warnings = composed.issues.filter(
        (issue) => issue.severity === 'warning'
    );

    return (
        <div
            className="flex w-56 shrink-0 flex-col overflow-hidden border-r pr-1 text-xs"
            data-testid="dbml-folder-panel"
        >
            <div className="flex items-center justify-between gap-1 px-1 py-0.5">
                <span className="truncate font-semibold" title={folder.name}>
                    {folder.name}
                </span>
                <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                    onClick={close}
                    title={t('luxdb.import.folder_close')}
                    aria-label={t('luxdb.import.folder_close')}
                >
                    <X className="size-3.5" />
                </button>
            </div>

            <button
                type="button"
                className={cn(
                    'flex items-center gap-1 rounded px-1 py-1 text-left hover:bg-accent',
                    folder.activePath === null &&
                        'bg-pink-100 font-semibold text-pink-900 dark:bg-pink-950 dark:text-pink-100'
                )}
                onClick={() => setActive(null)}
                title={t('luxdb.import.folder_combined_hint')}
            >
                <Layers className="size-3.5 shrink-0" />
                <span className="flex-1 truncate">
                    {t('luxdb.import.folder_combined')}
                </span>
                <span className="text-muted-foreground">
                    {t('luxdb.import.folder_areas', {
                        count: composed.areas.length,
                    })}
                </span>
            </button>

            <div className="mt-1 flex-1 overflow-y-auto">
                {folder.files.map((file, index) => {
                    const summary = summaries[index];
                    const active = folder.activePath === file.path;
                    return (
                        <div
                            key={file.path}
                            className={cn(
                                'flex items-center gap-1 rounded px-1 py-0.5',
                                active &&
                                    'bg-pink-100 text-pink-900 dark:bg-pink-950 dark:text-pink-100',
                                !file.selected && 'opacity-60'
                            )}
                        >
                            <Checkbox
                                checked={file.selected}
                                onCheckedChange={(checked) =>
                                    toggle(file.path, checked === true)
                                }
                                aria-label={t('luxdb.import.folder_include', {
                                    file: file.path,
                                })}
                            />
                            <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-1 text-left hover:underline"
                                onClick={() => setActive(file.path)}
                                title={file.path}
                            >
                                <FileCode2 className="size-3.5 shrink-0" />
                                <span className="truncate">{file.path}</span>
                            </button>
                            {summary?.looksCombined ? (
                                <span
                                    title={t(
                                        'luxdb.import.folder_looks_combined'
                                    )}
                                >
                                    <Copy className="size-3 text-amber-600" />
                                </span>
                            ) : null}
                            <span
                                className="shrink-0 text-muted-foreground"
                                title={
                                    summary?.definesAreas
                                        ? t('luxdb.import.folder_defines_areas')
                                        : undefined
                                }
                            >
                                {summary?.definesAreas
                                    ? 'Areas'
                                    : (summary?.tables.length ?? 0)}
                            </span>
                        </div>
                    );
                })}
            </div>

            {composed.sharedTableCount > 0 ? (
                <p className="p-1 text-muted-foreground">
                    {t('luxdb.import.folder_shared', {
                        count: composed.sharedTableCount,
                    })}
                </p>
            ) : null}
            {[...errors, ...warnings].length > 0 ? (
                <ul className="max-h-24 space-y-0.5 overflow-y-auto p-1">
                    {[...errors, ...warnings].map((issue, index) => (
                        <li
                            key={`${issue.code}-${index}`}
                            className={
                                issue.severity === 'error'
                                    ? 'text-destructive'
                                    : 'text-amber-600'
                            }
                        >
                            {issue.message}
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
};
