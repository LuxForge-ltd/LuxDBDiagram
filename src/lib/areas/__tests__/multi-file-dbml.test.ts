import { describe, expect, it } from 'vitest';
import {
    fileHeaderLine,
    locateMergedLine,
    mergeDBMLFiles,
} from '../multi-file-dbml';
import { importDBMLToDiagram } from '@/lib/dbml/dbml-import/dbml-import';
import { DatabaseType } from '@/lib/domain/database-type';

const usersFile = {
    name: 'users.dbml',
    content: `Table users {
  user_id bigint [pk, increment]
  email text [not null]
}`,
};

const matchesFile = {
    name: 'matches.dbml',
    content: `Table matches {
  match_id bigint [pk]
  updated_by bigint [not null, ref: > users.user_id]
}`,
};

describe('mergeDBMLFiles', () => {
    it('resolves references across files into one schema', async () => {
        const merged = mergeDBMLFiles([usersFile, matchesFile]);

        expect(merged.issues).toEqual([]);
        expect(merged.content).toContain(fileHeaderLine('users.dbml'));
        expect(merged.content).toContain(fileHeaderLine('matches.dbml'));

        const diagram = await importDBMLToDiagram(merged.content, {
            databaseType: DatabaseType.POSTGRESQL,
        });
        expect(diagram.tables?.map((t) => t.name).sort()).toEqual([
            'matches',
            'users',
        ]);
        expect(diagram.relationships).toHaveLength(1);
    });

    it('cannot import a file on its own when it references another file', async () => {
        await expect(
            importDBMLToDiagram(matchesFile.content, {
                databaseType: DatabaseType.POSTGRESQL,
            })
        ).rejects.toBeTruthy();
    });

    it('keeps one copy of a table defined identically in two files, with a warning', async () => {
        const copy = {
            name: 'copy.dbml',
            content: `// same table\n${usersFile.content}`,
        };
        const merged = mergeDBMLFiles([usersFile, matchesFile, copy]);

        expect(merged.issues).toEqual([
            expect.objectContaining({
                severity: 'warning',
                code: 'file_duplicate_definition',
                file: 'copy.dbml',
                line: 2,
            }),
        ]);
        const diagram = await importDBMLToDiagram(merged.content, {
            databaseType: DatabaseType.POSTGRESQL,
        });
        expect(diagram.tables).toHaveLength(2);
    });

    it('stops on two different definitions of the same table, naming both files', () => {
        const conflicting = {
            name: 'other.dbml',
            content: 'Table users {\n  user_id int [pk]\n}',
        };
        const merged = mergeDBMLFiles([usersFile, conflicting]);

        expect(merged.issues).toEqual([
            expect.objectContaining({
                severity: 'error',
                code: 'file_conflicting_definition',
            }),
        ]);
        expect(merged.issues[0].message).toContain('users.dbml (line 1)');
        expect(merged.issues[0].message).toContain('other.dbml (line 1)');
    });

    it('keeps the first Project block and repeated single-line refs once', async () => {
        const a = {
            name: 'a.dbml',
            content: `Project gap { database_type: 'PostgreSQL' }\n${usersFile.content}`,
        };
        const b = {
            name: 'b.dbml',
            content: `Project other { database_type: 'PostgreSQL' }\nTable teams {\n  team_id int [pk]\n  owner bigint\n}\nRef: teams.owner > users.user_id`,
        };
        const c = {
            name: 'c.dbml',
            content: 'Ref: teams.owner > users.user_id',
        };
        const merged = mergeDBMLFiles([a, b, c]);

        expect(merged.issues.map((i) => i.code)).toEqual([
            'file_duplicate_project',
        ]);
        const diagram = await importDBMLToDiagram(merged.content, {
            databaseType: DatabaseType.POSTGRESQL,
        });
        expect(diagram.relationships).toHaveLength(1);
    });

    it('carries Area blocks from a separate areas-only file', async () => {
        const areas = {
            name: 'areas.dbml',
            content:
                'Area "Users" {\n  users\n}\nArea "Matches" {\n  matches\n  users\n}',
        };
        const merged = mergeDBMLFiles([usersFile, matchesFile, areas]);
        const diagram = await importDBMLToDiagram(merged.content, {
            databaseType: DatabaseType.POSTGRESQL,
        });

        expect(diagram.areaViews?.map((a) => a.name)).toEqual([
            'Users',
            'Matches',
        ]);
        expect(diagram.areaViews?.[1].tables).toHaveLength(2);
    });

    it('maps merged line numbers back to the source file', () => {
        const merged = mergeDBMLFiles([usersFile, matchesFile]);
        const lines = merged.content.split('\n');
        const matchesLine = lines.indexOf('Table matches {') + 1;

        expect(locateMergedLine(merged.files, matchesLine)).toEqual({
            file: 'matches.dbml',
            line: 1,
        });
        expect(locateMergedLine(merged.files, 1)).toBeNull();
    });
});
