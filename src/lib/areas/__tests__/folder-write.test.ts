import { describe, expect, it } from 'vitest';
import {
    writeFilesToFolder,
    type WritableDirectoryHandle,
} from '../folder-write';

/** An in-memory folder with the parts of the File System Access API the writer uses. */
const memoryFolder = (
    name: string,
    store: Map<string, string>,
    prefix = ''
): WritableDirectoryHandle => ({
    name,
    getDirectoryHandle: async (child) =>
        memoryFolder(child, store, `${prefix}${child}/`),
    getFileHandle: async (fileName) => ({
        createWritable: async () => {
            let text = '';
            return {
                write: async (data: string) => {
                    text += data;
                },
                close: async () => {
                    store.set(`${prefix}${fileName}`, text);
                },
            };
        },
    }),
});

describe('writing files to a folder', () => {
    it('writes each file, creating subfolders and replacing existing files', async () => {
        const store = new Map([['users.dbml', 'old']]);
        const count = await writeFilesToFolder(memoryFolder('schema', store), [
            { path: 'users.dbml', content: 'Table users {}' },
            { path: 'domain/matches.dbml', content: 'Table matches {}' },
        ]);
        expect(count).toBe(2);
        expect(Object.fromEntries(store)).toEqual({
            'users.dbml': 'Table users {}',
            'domain/matches.dbml': 'Table matches {}',
        });
    });
});
