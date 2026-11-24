import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
    composeFolderDBML,
    fileStem,
    FOLDER_AREAS_HEADER,
    isDBMLPath,
    summarizeFolderFiles,
    withDefaultSelection,
    type DBMLFolderFile,
} from '../dbml-folder';
import {
    commentLossWarning,
    extractAreaBlocks,
    normalizeAreaFileName,
    serializeAreaViews,
} from '../area-dbml';
import { readDBMLFolderFromFileList } from '../folder-access';
import { importDBMLToDiagram } from '@/lib/dbml/dbml-import/dbml-import';
import { DatabaseType } from '@/lib/domain/database-type';

const USERS = `Table users {
  id int [pk]
  name varchar
}

Table user_profiles {
  id int [pk]
  user_id int [ref: > users.id]
}`;

const MATCHES = `Table matches {
  id int [pk]
  created_by int [ref: > users.id]
}`;

/** A whole-schema copy of the two files above. */
const COMBINED = `${USERS}\n\n${MATCHES}`;

const file = (
    path: string,
    content: string,
    selected = true
): DBMLFolderFile => ({ path, content, selected });

describe('folder file names', () => {
    it('recognises .dbml files and their names', () => {
        expect(isDBMLPath('users.dbml')).toBe(true);
        expect(isDBMLPath('USERS.DBML')).toBe(true);
        expect(isDBMLPath('users.dbdiagram')).toBe(false);
        expect(fileStem('domain/users.dbml')).toBe('users');
    });

    it('cleans Area file settings and refuses unsafe paths', () => {
        expect(normalizeAreaFileName('"users.dbml"')).toBe('users.dbml');
        expect(normalizeAreaFileName("'domain\\users.dbml'")).toBe(
            'domain/users.dbml'
        );
        expect(normalizeAreaFileName('./users.dbml')).toBe('users.dbml');
        expect(normalizeAreaFileName('')).toBeNull();
        expect(normalizeAreaFileName('/etc/passwd')).toBeNull();
        expect(normalizeAreaFileName('C:/x.dbml')).toBeNull();
        expect(normalizeAreaFileName('../up.dbml')).toBeNull();
    });
});

describe('summarising a folder', () => {
    it('reads table names as written, without settings or alias', () => {
        const [summary] = summarizeFolderFiles([
            {
                path: 'a.dbml',
                content: `Table "public"."users" as U [headercolor: #fff] {\n id int\n}\nTable orders {\n id int\n}`,
            },
        ]);
        expect(summary.tables).toEqual(['"public"."users"', 'orders']);
        expect(summary.definesAreas).toBe(false);
    });

    it('spots a combined copy of smaller files and unticks it by default', () => {
        const files = [
            { path: 'combined.dbml', content: COMBINED },
            { path: 'matches.dbml', content: MATCHES },
            { path: 'users.dbml', content: USERS },
        ];
        const summaries = summarizeFolderFiles(files);
        expect(summaries.map((s) => s.looksCombined)).toEqual([
            true,
            false,
            false,
        ]);
        expect(withDefaultSelection(files).map((f) => f.selected)).toEqual([
            false,
            true,
            true,
        ]);
    });

    it('notices files that write their own Area blocks', () => {
        const [summary] = summarizeFolderFiles([
            { path: 'areas.dbml', content: 'Area "Users" {\n users\n}' },
        ]);
        expect(summary.definesAreas).toBe(true);
        expect(summary.tables).toEqual([]);
    });
});

describe('composing a folder for import', () => {
    it('makes one Area per file, named after it and listing its tables', () => {
        const composed = composeFolderDBML([
            file('users.dbml', USERS),
            file('matches.dbml', MATCHES),
        ]);
        expect(composed.issues).toEqual([]);
        expect(composed.areas).toEqual([
            { name: 'users', fileName: 'users.dbml', tableCount: 2 },
            { name: 'matches', fileName: 'matches.dbml', tableCount: 1 },
        ]);
        expect(composed.content).toContain(FOLDER_AREAS_HEADER);
        expect(composed.content).toContain(
            'Area "users" [file: "users.dbml"] {\n    users\n    user_profiles\n}'
        );
    });

    it('leaves unticked files out entirely', () => {
        const composed = composeFolderDBML([
            file('combined.dbml', COMBINED, false),
            file('users.dbml', USERS),
        ]);
        expect(composed.areas.map((a) => a.fileName)).toEqual(['users.dbml']);
        expect(composed.content).not.toContain('Table matches');
    });

    it('keeps a table defined identically in two files once, shown by both Areas', async () => {
        const composed = composeFolderDBML([
            file('users.dbml', USERS),
            file(
                'matches.dbml',
                `${MATCHES}\n\nTable users {\n  id int [pk]\n  name varchar\n}`
            ),
        ]);
        expect(composed.issues).toEqual([]);
        expect(composed.sharedTableCount).toBe(1);

        const diagram = await importDBMLToDiagram(composed.content, {
            databaseType: DatabaseType.POSTGRESQL,
        });
        expect(diagram.tables?.filter((t) => t.name === 'users')).toHaveLength(
            1
        );
        const users = diagram.tables!.find((t) => t.name === 'users')!;
        const areas = diagram.areaViews ?? [];
        expect(areas.map((a) => [a.name, a.fileName])).toEqual([
            ['users', 'users.dbml'],
            ['matches', 'matches.dbml'],
        ]);
        for (const area of areas) {
            expect(area.tables.some((i) => i.tableId === users.id)).toBe(true);
        }
    });

    it('stops on two different definitions of the same table and names both files', () => {
        const composed = composeFolderDBML([
            file('users.dbml', USERS),
            file('other.dbml', 'Table users {\n  id bigint [pk]\n}'),
        ]);
        const errors = composed.issues.filter((i) => i.severity === 'error');
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('users.dbml');
        expect(errors[0].message).toContain('other.dbml');
    });

    it('gives no Area to a file without tables or with its own Area blocks', () => {
        const composed = composeFolderDBML([
            file('users.dbml', USERS),
            file('empty.dbml', ''),
            file('areas.dbml', 'Area "Mine" {\n users\n}'),
        ]);
        expect(composed.areas.map((a) => a.fileName)).toEqual(['users.dbml']);
        expect(composed.content).toContain('Area "Mine"');
    });

    it('keeps the folder in the Area name when two files share a name', () => {
        const composed = composeFolderDBML([
            file('a/users.dbml', USERS),
            file('b/users.dbml', MATCHES),
        ]);
        expect(composed.areas.map((a) => a.name)).toEqual([
            'a/users',
            'b/users',
        ]);
    });
});

describe('comments in a combined folder', () => {
    it('does not count the lines LuxDBDiag writes itself', () => {
        const composed = composeFolderDBML([
            file('users.dbml', USERS),
            file('matches.dbml', MATCHES),
        ]);
        expect(commentLossWarning(composed.content)).toBeNull();
        const withNote = composeFolderDBML([
            file(
                'users.dbml',
                `// owned by the users team
${USERS}`
            ),
        ]);
        expect(commentLossWarning(withNote.content)?.message).toMatch(
            /^1 "\/\/" comment line is not kept/
        );
    });
});

describe('Area file names in enhanced DBML', () => {
    it('reads and writes the file setting', () => {
        const { areas, issues } = extractAreaBlocks(
            'Area "Users" [color: #8b5cf6, file: "domain/users.dbml"] {\n users\n}'
        );
        expect(issues).toEqual([]);
        expect(areas[0].fileName).toBe('domain/users.dbml');

        const written = serializeAreaViews(
            [
                {
                    id: 'a1',
                    name: 'Users',
                    color: '#8b5cf6',
                    order: 0,
                    tables: [],
                    fileName: 'domain/users.dbml',
                    createdAt: 0,
                },
            ],
            { tables: [] }
        );
        expect(written).toContain(
            '[color: #8b5cf6, file: "domain/users.dbml"]'
        );
    });

    it('warns about and ignores an unusable file setting', () => {
        const { areas, issues } = extractAreaBlocks(
            'Area "Users" [file: "../outside.dbml"] {\n users\n}'
        );
        expect(areas[0].fileName).toBeUndefined();
        expect(issues.map((i) => i.code)).toEqual(['area_invalid_file']);
    });
});

describe('reading a folder upload', () => {
    it('keeps .dbml files with paths inside the chosen folder', async () => {
        const make = (relative: string, content: string) => {
            const name = relative.split('/').pop()!;
            const f = new File([content], name);
            Object.defineProperty(f, 'webkitRelativePath', { value: relative });
            return f;
        };
        const opened = await readDBMLFolderFromFileList([
            make('schema/users.dbml', USERS),
            make('schema/readme.md', '# notes'),
            make('schema/domain/matches.dbml', MATCHES),
        ]);
        expect(opened?.name).toBe('schema');
        expect(opened?.files.map((f) => f.path)).toEqual([
            'domain/matches.dbml',
            'users.dbml',
        ]);
        expect(await readDBMLFolderFromFileList([])).toBeNull();
    });
});

const gapDir = process.env.LUXDB_GAP_SCHEMA_DIR;

describe.skipIf(!gapDir || !existsSync(gapDir))(
    'GAP schema folder (local only)',
    () => {
        it('unticks the combined copies and makes one Area per domain file', () => {
            const files = readdirSync(gapDir!)
                .filter(isDBMLPath)
                .sort()
                .map((name) => ({
                    path: name,
                    content: readFileSync(join(gapDir!, name), 'utf8'),
                }));
            const selected = withDefaultSelection(files);
            const unticked = selected
                .filter((f) => !f.selected)
                .map((f) => f.path);
            expect(unticked).toEqual(['gap_combined.dbml', 'schema.dbml']);

            const composed = composeFolderDBML(selected);
            expect(
                composed.issues.filter((i) => i.severity === 'error')
            ).toEqual([]);
            const domainWithTables = selected.filter(
                (f) => f.selected && /^\s*Table\s/m.test(f.content)
            );
            expect(composed.areas.map((a) => a.fileName)).toEqual(
                domainWithTables.map((f) => f.path)
            );
        });
    }
);
