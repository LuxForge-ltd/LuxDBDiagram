import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { importDBMLToDiagram } from '@/lib/dbml/dbml-import/dbml-import';
import { DatabaseType } from '@/lib/domain/database-type';
import type { Diagram } from '@/lib/domain/diagram';
import type { AreaView } from '@/lib/domain/area-view';
import {
    AREA_LAYOUT_FILE,
    UNASSIGNED_FILE,
    assignAreaFilePaths,
    fileNameForAreaName,
    generateAreaFiles,
} from '../area-files';
import {
    composeFolderDBML,
    isDBMLPath,
    summarizeFolderFiles,
    withDefaultSelection,
} from '../dbml-folder';

const SCHEMA = `
Enum match_status {
  scheduled
  played
}

Table users {
  user_id bigint [pk]
  username text [not null]
}

Table user_profiles {
  profile_id bigint [pk]
  user_id bigint [ref: > users.user_id]
}

Table matches {
  match_id bigint [pk]
  status match_status
  created_by bigint [ref: > users.user_id]
}

Table audit_log {
  id bigint [pk]
  note text
}

Area "Users" [color: #8b5cf6] {
  users [x: 10, y: 20]
  user_profiles [x: 400, y: 20]
}

Area "Match teams" [color: #10b981, floats: all] {
  matches [x: 30, y: 40]
  users [x: 500, y: 40]
}
`;

const load = (text: string) =>
    importDBMLToDiagram(text, { databaseType: DatabaseType.POSTGRESQL });

/** Writes the diagram as files, then opens them again as a folder. */
const roundTrip = async (diagram: Diagram) => {
    const written = generateAreaFiles(diagram);
    const files = [
        ...written.files.map((f) => ({ path: f.path, content: f.content })),
        ...(written.layout
            ? [{ path: written.layout.path, content: written.layout.content }]
            : []),
    ].sort((a, b) => a.path.localeCompare(b.path));
    const composed = composeFolderDBML(withDefaultSelection(files));
    expect(composed.issues.filter((i) => i.severity === 'error')).toEqual([]);
    return { written, reopened: await load(composed.content) };
};

const tableNames = (diagram: Diagram) =>
    (diagram.tables ?? []).map((t) => `${t.schema}.${t.name}`).sort();

const relationshipKeys = (diagram: Diagram) => {
    const name = new Map(
        (diagram.tables ?? []).map((t) => [t.id, `${t.schema}.${t.name}`])
    );
    return (diagram.relationships ?? [])
        .map(
            (r) =>
                `${name.get(r.sourceTableId)}.${r.sourceFieldId ? '' : ''}>${name.get(r.targetTableId)}`
        )
        .sort();
};

const areaSummary = (diagram: Diagram) => {
    const name = new Map((diagram.tables ?? []).map((t) => [t.id, t.name]));
    return [...(diagram.areaViews ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((area) => ({
            name: area.name,
            fileName: area.fileName ?? null,
            floatFilter: area.floatFilter ?? null,
            tables: area.tables
                .map((i) => `${name.get(i.tableId)}@${i.x},${i.y}`)
                .sort(),
        }));
};

describe('file names for Areas', () => {
    it('makes safe file names from Area names', () => {
        expect(fileNameForAreaName('Match teams')).toBe('match_teams.dbml');
        expect(fileNameForAreaName('  Users / Auth ')).toBe('users_auth.dbml');
        expect(fileNameForAreaName('***')).toBe('area.dbml');
    });

    it('keeps stored names, avoids reserved files and never repeats a name', () => {
        const area = (
            id: string,
            name: string,
            order: number,
            fileName?: string
        ): AreaView => ({
            id,
            name,
            color: '#000000',
            order,
            tables: [],
            createdAt: 0,
            ...(fileName ? { fileName } : {}),
        });
        const paths = assignAreaFilePaths([
            area('a', 'Users', 0),
            area('b', 'users', 1),
            area('c', 'Other', 2, 'users.dbml'),
            area('d', 'Unassigned', 3),
            area('e', 'luxdbdiag.areas', 4),
        ]);
        expect(paths.get('c')).toBe('users.dbml');
        expect(paths.get('a')).toBe('users_2.dbml');
        expect(paths.get('b')).toBe('users_3.dbml');
        expect(paths.get('d')).toBe('unassigned_2.dbml');
        expect(paths.get('e')).toBe('luxdbdiag.areas_2.dbml');
    });
});

describe('writing a diagram as files', () => {
    it("puts each Area's tables in its file, a shared table in both, and the rest in unassigned", async () => {
        const diagram = await load(SCHEMA);
        const { files, layout } = generateAreaFiles(diagram);

        expect(files.map((f) => [f.path, f.tableCount])).toEqual([
            ['users.dbml', 2],
            ['match_teams.dbml', 2],
            [UNASSIGNED_FILE, 1],
        ]);
        const byPath = new Map(files.map((f) => [f.path, f.content]));
        const tablesIn = (path: string) =>
            summarizeFolderFiles([{ path, content: byPath.get(path)! }])[0]
                .tables;

        expect(tablesIn('users.dbml')).toEqual([
            '"public"."users"',
            '"public"."user_profiles"',
        ]);
        expect(tablesIn('match_teams.dbml')).toEqual([
            '"public"."users"',
            '"public"."matches"',
        ]);
        expect(tablesIn(UNASSIGNED_FILE)).toEqual(['"public"."audit_log"']);

        // The users table is written identically in both files.
        const usersBlock = (path: string) =>
            /Table "public"\."users" \{[^}]*\}/.exec(byPath.get(path)!)?.[0];
        expect(usersBlock('users.dbml')).toBe(usersBlock('match_teams.dbml'));

        // Relationships touching the file's tables are in the file, even to other files' tables.
        expect(byPath.get('users.dbml')).toMatch(/^Ref .*"matches"/m);
        expect(layout?.path).toBe(AREA_LAYOUT_FILE);
        expect(layout?.content).toContain('file: "match_teams.dbml"');
    });

    it('opens again as the same schema, Areas, file names and layout', async () => {
        const diagram = await load(SCHEMA);
        const { reopened } = await roundTrip(diagram);

        expect(tableNames(reopened)).toEqual(tableNames(diagram));
        expect(reopened.relationships?.length).toBe(
            diagram.relationships?.length
        );
        expect(relationshipKeys(reopened)).toEqual(relationshipKeys(diagram));
        expect(reopened.customTypes?.map((t) => t.name)).toEqual(
            diagram.customTypes?.map((t) => t.name)
        );

        const before = areaSummary(diagram).map((area) => ({
            ...area,
            fileName: area.name === 'Users' ? 'users.dbml' : 'match_teams.dbml',
        }));
        const after = areaSummary(reopened);
        // The two written Areas come back exactly; the unassigned table gets its own Area.
        expect(after.slice(0, 2)).toEqual(before);
        expect(after[2]).toMatchObject({
            name: 'unassigned',
            fileName: UNASSIGNED_FILE,
        });
    });

    it("adding a table to an Area adds its definition to that Area's file", async () => {
        const diagram = await load(SCHEMA);
        const audit = diagram.tables!.find((t) => t.name === 'audit_log')!;
        const withAudit: Diagram = {
            ...diagram,
            areaViews: diagram.areaViews!.map((area) =>
                area.name === 'Users'
                    ? {
                          ...area,
                          tables: [
                              ...area.tables,
                              { tableId: audit.id, x: 0, y: 300 },
                          ],
                      }
                    : area
            ),
        };
        const { files } = generateAreaFiles(withAudit);
        expect(files.map((f) => f.path)).toEqual([
            'users.dbml',
            'match_teams.dbml',
        ]);
        expect(files[0].content).toContain('Table "public"."audit_log"');
    });
});

const gapDir = process.env.LUXDB_GAP_SCHEMA_DIR;

describe.skipIf(!gapDir || !existsSync(gapDir))(
    'GAP schema as files (local only)',
    { timeout: 60_000 },
    () => {
        it('writes one file per domain Area and reads back the same schema', async () => {
            const diagram = await load(
                readFileSync(join(gapDir!, 'gap_combined.dbml'), 'utf8')
            );
            const domainFiles = readdirSync(gapDir!)
                .filter(isDBMLPath)
                .filter(
                    (name) =>
                        !['gap_combined.dbml', 'schema.dbml'].includes(name)
                )
                .sort()
                .map((name) => ({
                    path: name,
                    content: readFileSync(join(gapDir!, name), 'utf8'),
                }));
            const byName = new Map(
                diagram.tables!.map((t) => [t.name.toLowerCase(), t])
            );
            const areaViews: AreaView[] = summarizeFolderFiles(domainFiles)
                .filter((f) => f.tables.length > 0)
                .map((file, order) => ({
                    id: `area-${order}`,
                    name: file.path.replace(/\.dbml$/, ''),
                    color: '#8b5cf6',
                    order,
                    fileName: file.path,
                    createdAt: 0,
                    tables: file.tables
                        .map((name) =>
                            byName.get(
                                name
                                    .replace(/"/g, '')
                                    .split('.')
                                    .pop()!
                                    .toLowerCase()
                            )
                        )
                        .filter((t): t is NonNullable<typeof t> => !!t)
                        .map((t, i) => ({ tableId: t.id, x: i * 10, y: 0 })),
                }));

            const { written, reopened } = await roundTrip({
                ...diagram,
                areaViews,
            });
            expect(written.files.length).toBeGreaterThanOrEqual(
                areaViews.length
            );
            expect(tableNames(reopened)).toEqual(tableNames(diagram));
            expect(reopened.relationships?.length).toBe(
                diagram.relationships?.length
            );
            expect(
                areaSummary(reopened)
                    .slice(0, areaViews.length)
                    .map((a) => [a.fileName, a.tables.length])
            ).toEqual(areaViews.map((a) => [a.fileName, a.tables.length]));
        });
    }
);
