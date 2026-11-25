/**
 * Folder mode state for the DBML import dialog (LuxDBDiagram).
 *
 * Purpose: holds an opened folder's files, which are ticked, which one the editor shows, and
 * the combined text to import.
 * Scope: state only; the dialog decides what the editor shows and what it imports.
 */
import { useCallback, useMemo, useState } from 'react';
import {
    composeFolderDBML,
    summarizeFolderFiles,
    withDefaultSelection,
    type DBMLFolderFile,
} from '@/lib/areas/dbml-folder';
import type {
    FolderDirectoryHandle,
    OpenedFolder,
} from '@/lib/areas/folder-access';
import type { RepoFolderLink } from '@/lib/github/repo-source';

export interface DBMLFolderState {
    name: string;
    files: DBMLFolderFile[];
    /** File shown in the editor; null shows the combined import (read-only). */
    activePath: string | null;
    handle?: FolderDirectoryHandle;
    /** The repository folder the files came from, with the files as GitHub has them. */
    repo?: RepoFolderLink;
}

export const useDBMLFolder = () => {
    const [folder, setFolder] = useState<DBMLFolderState | null>(null);

    const files = folder?.files;
    const composed = useMemo(
        () => (files ? composeFolderDBML(files) : null),
        [files]
    );
    const summaries = useMemo(
        () => (files ? summarizeFolderFiles(files) : []),
        [files]
    );

    const open = useCallback((opened: OpenedFolder) => {
        const files = withDefaultSelection(opened.files);
        setFolder({
            name: opened.name,
            files,
            activePath: files.find((file) => file.selected)?.path ?? null,
            handle: opened.handle,
            repo: opened.repo,
        });
    }, []);

    const close = useCallback(() => setFolder(null), []);

    const setActive = useCallback(
        (path: string | null) =>
            setFolder((current) =>
                current ? { ...current, activePath: path } : current
            ),
        []
    );

    const toggle = useCallback(
        (path: string, selected: boolean) =>
            setFolder((current) =>
                current
                    ? {
                          ...current,
                          files: current.files.map((file) =>
                              file.path === path ? { ...file, selected } : file
                          ),
                      }
                    : current
            ),
        []
    );

    /** Replaces one file's text (the path is passed so a late edit lands on the right file). */
    const updateFile = useCallback(
        (path: string, content: string) =>
            setFolder((current) =>
                current
                    ? {
                          ...current,
                          files: current.files.map((file) =>
                              file.path === path ? { ...file, content } : file
                          ),
                      }
                    : current
            ),
        []
    );

    const activeContent = useMemo(() => {
        if (!folder || folder.activePath === null) return null;
        return (
            folder.files.find((file) => file.path === folder.activePath)
                ?.content ?? null
        );
    }, [folder]);

    return {
        folder,
        composed,
        summaries,
        activeContent,
        open,
        close,
        setActive,
        toggle,
        updateFile,
    };
};

export type DBMLFolderController = ReturnType<typeof useDBMLFolder>;
