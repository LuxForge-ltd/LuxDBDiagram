/**
 * Area files in the DBML panel (LuxDBDiagram).
 *
 * Purpose: lets the DBML panel show the diagram as its files: pick the whole schema (ChartDB's
 * editable view) or one Area's file, which holds every table the Area shows and the
 * relationships that touch them. Files are built from the diagram, so they are read-only
 * here; "Save files" writes them all to a folder.
 */
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderDown } from 'lucide-react';
import { useChartDB } from '@/hooks/use-chartdb';
import { useTheme } from '@/hooks/use-theme';
import { useSaveAreaFiles } from '@/hooks/use-save-area-files';
import { CodeSnippet } from '@/components/code-snippet/code-snippet';
import { setupDBMLLanguage } from '@/components/code-snippet/languages/dbml-language';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/select/select';
import {
    AREA_LAYOUT_FILE,
    UNASSIGNED_FILE,
    generateAreaFiles,
    type AreaFilesExport,
} from '@/lib/areas/area-files';

/** The whole schema (ChartDB's own DBML editor). */
export const WHOLE_SCHEMA = '__schema__';

/**
 * Builds the diagram's files, or null when they cannot be built.
 *
 * @returns The files, recomputed when the diagram changes.
 */
const useAreaFiles = (): AreaFilesExport | null => {
    const { currentDiagram } = useChartDB();
    return useMemo(() => {
        try {
            return generateAreaFiles(currentDiagram);
        } catch {
            return null;
        }
    }, [currentDiagram]);
};

/** Key of a file in the picker: the Area id, or the reserved file's path. */
const fileKey = (file: { areaId: string | null; path: string }) =>
    file.areaId ?? file.path;

export interface AreaFileSelectProps {
    value: string;
    onChange: (value: string) => void;
}

export const AreaFileSelect: React.FC<AreaFileSelectProps> = ({
    value,
    onChange,
}) => {
    const { t } = useTranslation();
    const { currentDiagram } = useChartDB();
    const files = useAreaFiles();
    if (!files || (currentDiagram.areaViews?.length ?? 0) === 0) return null;

    const areaName = new Map(
        (currentDiagram.areaViews ?? []).map((area) => [area.id, area.name])
    );
    const label = (file: { areaId: string | null; path: string }) =>
        file.areaId
            ? `${file.path} · ${areaName.get(file.areaId) ?? ''}`
            : file.path === UNASSIGNED_FILE
              ? `${file.path} · ${t('luxdb.files.unassigned_file')}`
              : `${file.path} · ${t('luxdb.files.areas_file')}`;

    return (
        <div className="flex items-center gap-2 py-1 text-xs">
            <span className="text-muted-foreground">
                {t('luxdb.files.view_label')}
            </span>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger
                    className="h-7 flex-1 text-xs"
                    data-testid="dbml-file-select"
                >
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={WHOLE_SCHEMA} className="text-xs">
                        {t('luxdb.files.whole_schema')}
                    </SelectItem>
                    {[
                        ...files.files,
                        ...(files.layout ? [files.layout] : []),
                    ].map((file) => (
                        <SelectItem
                            key={fileKey(file)}
                            value={fileKey(file)}
                            className="text-xs"
                        >
                            {label(file)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
};

export interface AreaFileViewProps {
    /** An Area id, or the path of `unassigned.dbml` or the Areas file. */
    fileKey: string;
}

export const AreaFileView: React.FC<AreaFileViewProps> = ({ fileKey: key }) => {
    const { t } = useTranslation();
    const { effectiveTheme } = useTheme();
    const saveAreaFiles = useSaveAreaFiles();
    const files = useAreaFiles();

    const file = useMemo(
        () =>
            [
                ...(files?.files ?? []),
                ...(files?.layout ? [files.layout] : []),
            ].find((candidate) => fileKey(candidate) === key) ?? null,
        [files, key]
    );
    if (!file) return null;

    return (
        <div className="flex flex-1 flex-col overflow-hidden">
            <p className="pb-1 text-xs text-muted-foreground">
                {file.path === AREA_LAYOUT_FILE
                    ? file.path
                    : `${file.path} · ${t('luxdb.files.file_tables', {
                          count: file.tableCount,
                      })}`}
                {'. '}
                {file.path === AREA_LAYOUT_FILE
                    ? null
                    : t('luxdb.files.file_view_hint')}
            </p>
            <CodeSnippet
                code={file.content}
                language="dbml"
                className="my-0.5 flex-1"
                actionsTooltipSide="right"
                actions={[
                    {
                        label: t('luxdb.files.save_files'),
                        icon: FolderDown,
                        onClick: saveAreaFiles,
                    },
                ]}
                editorProps={{
                    height: '100%',
                    defaultLanguage: 'dbml',
                    beforeMount: setupDBMLLanguage,
                    theme:
                        effectiveTheme === 'dark' ? 'dbml-dark' : 'dbml-light',
                    options: {
                        wordWrap: 'off',
                        mouseWheelZoom: false,
                        readOnly: true,
                    },
                }}
            />
        </div>
    );
};
