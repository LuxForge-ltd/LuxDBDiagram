/**
 * Writing files to a folder in the browser (LuxDBDiagram).
 *
 * Purpose: saves a diagram's files into a folder the user picks (Edge and Chrome, through the
 * File System Access API), or downloads them one by one where the browser cannot write to
 * folders.
 * Scope: only the files given are written; other files in the folder are left alone.
 */

interface WritableFile {
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
}

interface WritableFileHandle {
    createWritable: () => Promise<WritableFile>;
}

export interface WritableDirectoryHandle {
    name: string;
    getFileHandle: (
        name: string,
        options?: { create?: boolean }
    ) => Promise<WritableFileHandle>;
    getDirectoryHandle: (
        name: string,
        options?: { create?: boolean }
    ) => Promise<WritableDirectoryHandle>;
}

type WritableDirectoryPicker = (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
}) => Promise<WritableDirectoryHandle>;

export interface FileToWrite {
    /** Path inside the folder, with `/` separators. */
    path: string;
    content: string;
}

/**
 * Whether the browser can write into a folder the user picks.
 *
 * @returns True in Edge and Chrome.
 */
export const canWriteFolder = (): boolean =>
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown })
        .showDirectoryPicker === 'function';

/**
 * Asks the user for a folder to write to. Must be called from a click, before any await.
 *
 * @returns The folder, or null when the user cancelled.
 */
export const pickWritableFolder =
    async (): Promise<WritableDirectoryHandle | null> => {
        const picker = (
            window as unknown as {
                showDirectoryPicker: WritableDirectoryPicker;
            }
        ).showDirectoryPicker;
        try {
            return await picker({ id: 'luxdb-dbml-folder', mode: 'readwrite' });
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return null;
            }
            throw error;
        }
    };

/**
 * Writes files into a folder, creating subfolders as needed and replacing files of the same
 * name.
 *
 * @param folder Folder to write into.
 * @param files Files to write.
 * @returns The number of files written.
 */
export const writeFilesToFolder = async (
    folder: WritableDirectoryHandle,
    files: readonly FileToWrite[]
): Promise<number> => {
    for (const file of files) {
        const parts = file.path.split('/').filter(Boolean);
        const name = parts.pop();
        if (!name) continue;
        let directory = folder;
        for (const part of parts) {
            directory = await directory.getDirectoryHandle(part, {
                create: true,
            });
        }
        const handle = await directory.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(file.content);
        await writable.close();
    }
    return files.length;
};

/**
 * Downloads files one by one (for browsers that cannot write to folders). Folder parts of a
 * path become part of the file name.
 *
 * @param files Files to download.
 */
export const downloadFiles = (files: readonly FileToWrite[]): void => {
    files.forEach((file, index) => {
        setTimeout(() => {
            const blob = new Blob([file.content], {
                type: 'text/plain;charset=utf-8',
            });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('download', file.path.replace(/\//g, '__'));
            link.setAttribute('href', url);
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
        }, index * 300);
    });
};
