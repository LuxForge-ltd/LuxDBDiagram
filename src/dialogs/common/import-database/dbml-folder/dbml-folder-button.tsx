/**
 * Open a folder of DBML files (LuxDBDiagram).
 *
 * Purpose: the "Open folder…" button of the DBML import editor. Edge and Chrome use their
 * folder picker; other browsers use a folder upload input.
 */
import React, { useCallback, useRef } from 'react';
import { FolderTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/button/button';
import { useToast } from '@/components/toast/use-toast';
import {
    canPickFolder,
    pickDBMLFolder,
    readDBMLFolderFromFileList,
    type OpenedFolder,
} from '@/lib/areas/folder-access';

export interface DBMLFolderButtonProps {
    onOpen: (folder: OpenedFolder) => void;
}

export const DBMLFolderButton: React.FC<DBMLFolderButtonProps> = ({
    onOpen,
}) => {
    const { t } = useTranslation();
    const { toast } = useToast();
    const inputRef = useRef<HTMLInputElement>(null);

    const accept = useCallback(
        (opened: OpenedFolder | null) => {
            if (!opened) return;
            if (opened.files.length === 0) {
                toast({
                    variant: 'destructive',
                    title: t('luxdb.import.folder_empty_title'),
                    description: t('luxdb.import.folder_empty_description'),
                });
                return;
            }
            onOpen(opened);
        },
        [onOpen, toast, t]
    );

    const handleClick = useCallback(async () => {
        if (!canPickFolder()) {
            inputRef.current?.click();
            return;
        }
        try {
            accept(await pickDBMLFolder());
        } catch (error) {
            toast({
                variant: 'destructive',
                title: t('luxdb.import.folder_read_failed'),
                description: error instanceof Error ? error.message : '',
            });
        }
    }, [accept, toast, t]);

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                data-testid="dbml-folder-input"
                // Folder upload: not in React's attribute types.
                {...{ webkitdirectory: '', directory: '' }}
                onChange={async (event) => {
                    accept(
                        await readDBMLFolderFromFileList(event.target.files)
                    );
                    event.target.value = '';
                }}
            />
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={handleClick}
                title={t('luxdb.import.open_folder_title')}
            >
                <FolderTree className="size-3.5" />
                {t('luxdb.import.open_folder')}
            </Button>
        </>
    );
};
