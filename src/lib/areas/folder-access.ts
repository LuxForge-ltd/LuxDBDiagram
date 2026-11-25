/**
 * Reading folders of DBML files in the browser (LuxDBDiagram).
 *
 * Purpose: lets the user choose a folder and returns its `.dbml` files.
 * Scope: Edge and Chrome offer the File System Access API (`showDirectoryPicker`), which also
 * gives a handle that can later be written back to. Other browsers use a folder upload input
 * (`webkitdirectory`), which can only read.
 * Operational role: used by the DBML import dialog's "Open folder…" button.
 */
import { isDBMLPath } from './dbml-folder';
import type { RepoFolderLink } from '@/lib/github/repo-source';

/** Minimal File System Access API types (not all TypeScript DOM libs include them). */
export interface FolderFileHandle {
    kind: 'file';
    name: string;
    getFile: () => Promise<File>;
}

export interface FolderDirectoryHandle {
    kind: 'directory';
    name: string;
    values: () => AsyncIterable<FolderFileHandle | FolderDirectoryHandle>;
}

type DirectoryPicker = (options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
}) => Promise<FolderDirectoryHandle>;

/** A folder the user opened. */
export interface OpenedFolder {
    /** The folder's own name. */
    name: string;
    files: { path: string; content: string }[];
    /** Present when the browser gave a folder handle (Edge and Chrome). */
    handle?: FolderDirectoryHandle;
    /** Present when the folder came from a GitHub repository. */
    repo?: RepoFolderLink;
}

/** Folders below this depth are not searched. */
const MAX_DEPTH = 4;

/** Folders that never hold schema files. */
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', 'build']);

/**
 * Whether the browser can open a folder through a picker that returns a handle.
 *
 * @returns True in Edge and Chrome.
 */
export const canPickFolder = (): boolean =>
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown })
        .showDirectoryPicker === 'function';

const sortByPath = <T extends { path: string }>(files: T[]): T[] =>
    files.sort((a, b) => a.path.localeCompare(b.path));

/**
 * Collects the `.dbml` files under a folder handle.
 *
 * @param directory Folder handle.
 * @param prefix Path of the folder inside the opened one ('' for the opened folder).
 * @param depth Current depth.
 * @returns The files found, with paths relative to the opened folder.
 */
export const readDBMLFilesFromHandle = async (
    directory: FolderDirectoryHandle,
    prefix = '',
    depth = 0
): Promise<{ path: string; content: string }[]> => {
    const files: { path: string; content: string }[] = [];
    for await (const entry of directory.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
            if (!isDBMLPath(entry.name)) continue;
            const file = await entry.getFile();
            files.push({ path, content: await file.text() });
        } else if (
            depth < MAX_DEPTH &&
            !entry.name.startsWith('.') &&
            !SKIPPED_FOLDERS.has(entry.name)
        ) {
            files.push(
                ...(await readDBMLFilesFromHandle(entry, path, depth + 1))
            );
        }
    }
    return sortByPath(files);
};

/**
 * Asks the user for a folder through the browser's folder picker.
 *
 * @returns The folder and its `.dbml` files, or null when the user cancelled.
 */
export const pickDBMLFolder = async (): Promise<OpenedFolder | null> => {
    const picker = (
        window as unknown as { showDirectoryPicker: DirectoryPicker }
    ).showDirectoryPicker;
    let handle: FolderDirectoryHandle;
    try {
        handle = await picker({ id: 'luxdb-dbml-folder', mode: 'read' });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            return null;
        }
        throw error;
    }
    return {
        name: handle.name,
        files: await readDBMLFilesFromHandle(handle),
        handle,
    };
};

/**
 * Reads the `.dbml` files chosen through a folder upload input (`webkitdirectory`).
 *
 * @param fileList Files the input returned; each has a `webkitRelativePath`.
 * @returns The folder and its `.dbml` files, or null when no file was chosen.
 */
export const readDBMLFolderFromFileList = async (
    fileList: FileList | readonly File[] | null
): Promise<OpenedFolder | null> => {
    const all = fileList ? [...fileList] : [];
    if (all.length === 0) return null;

    const relative = (file: File) =>
        (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    const folderName = relative(all[0]).split('/')[0] ?? '';

    const files = await Promise.all(
        all
            .filter((file) => isDBMLPath(file.name))
            .map(async (file) => {
                const parts = relative(file).split('/');
                // Drop the opened folder's own name from the path.
                const path =
                    parts.length > 1 && parts[0] === folderName
                        ? parts.slice(1).join('/')
                        : parts.join('/');
                return { path, content: await file.text() };
            })
    );
    return { name: folderName, files: sortByPath(files) };
};
