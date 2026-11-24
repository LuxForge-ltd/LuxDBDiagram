import { describe, expect, it } from 'vitest';
import {
    commentLossWarning,
    extractAreaBlocks,
    resolveParsedAreas,
    serializeAreaViews,
} from '../area-dbml';
import type { DBTable } from '@/lib/domain/db-table';
import type { DBRelationship } from '@/lib/domain/db-relationship';

const makeTable = (
    id: string,
    name: string,
    schema: string | null = null
): DBTable => ({
    id,
    name,
    schema,
    x: 0,
    y: 0,
    fields: [
        {
            id: `${id}_id`,
            name: 'id',
            type: { id: 'bigint', name: 'bigint' },
            primaryKey: true,
            unique: true,
            nullable: false,
            createdAt: 0,
        },
    ],
    indexes: [],
    color: '#8eb7ff',
    isView: false,
    createdAt: 0,
});

let idCounter = 0;
const generateId = () => `gen_${idCounter++}`;

const tables = [
    makeTable('t_users', 'users'),
    makeTable('t_auth', 'user_auth_identities'),
    makeTable('t_emails', 'user_additional_emails'),
    makeTable('t_matches', 'matches'),
    makeTable('t_teams', 'match_teams'),
];
const relationships: DBRelationship[] = [];

describe('extractAreaBlocks', () => {
    it('reads the brief syntax and blanks the blocks without changing line count', () => {
        const dbml = [
            'Table users {',
            '  id bigint [pk]',
            '}',
            '',
            'Area "Users" {',
            '    users',
            '    user_auth_identities',
            '}',
            '',
            'Area "Matches" {',
            '    matches',
            '    users',
            '}',
        ].join('\n');

        const result = extractAreaBlocks(dbml);

        expect(result.issues).toEqual([]);
        expect(result.areas.map((a) => a.name)).toEqual(['Users', 'Matches']);
        expect(result.areas[0].entries.map((e) => e.name)).toEqual([
            'users',
            'user_auth_identities',
        ]);
        expect(result.areas[0].line).toBe(5);
        expect(result.content.split('\n')).toHaveLength(
            dbml.split('\n').length
        );
        expect(result.content).not.toMatch(/Area/);
        expect(result.content).toContain('Table users {');
    });

    it('reads colours, positions, floats, schemas and quoted names', () => {
        const dbml = `Area "Finance & Money" [color: #8b5cf6] {
    public.users [x: 120, y: -80.5]
    "odd table" [x: 1, y: 2]
    float "public"."matches" [x: 900, y: 300, expanded]
}`;
        const { areas, issues } = extractAreaBlocks(dbml);

        expect(issues).toEqual([]);
        expect(areas[0]).toMatchObject({
            name: 'Finance & Money',
            color: '#8b5cf6',
        });
        expect(areas[0].entries).toEqual([
            {
                kind: 'table',
                schema: 'public',
                name: 'users',
                x: 120,
                y: -80.5,
                line: 2,
            },
            { kind: 'table', name: 'odd table', x: 1, y: 2, line: 3 },
            {
                kind: 'float',
                schema: 'public',
                name: 'matches',
                x: 900,
                y: 300,
                expanded: true,
                line: 4,
            },
        ]);
    });

    it('ignores comments and leaves tables, refs and strings that mention Area alone', () => {
        const dbml = `Table Area {
  id int [pk, note: 'Area "Fake" { users }']
}
Ref: Area.id > users.id
// Area "Commented" { users }
/* Area "Block" { users } */
Area "Real" {
    users // the main table
    /* matches */
}`;
        const { areas, issues, content } = extractAreaBlocks(dbml);

        expect(issues).toEqual([]);
        expect(areas.map((a) => a.name)).toEqual(['Real']);
        expect(areas[0].entries.map((e) => e.name)).toEqual(['users']);
        expect(content).toContain('Table Area {');
        expect(content).toContain('Ref: Area.id > users.id');
    });

    it('reports a block with no closing brace as an error with its line', () => {
        const { issues } = extractAreaBlocks(
            'Table t {\n id int\n}\nArea "Broken" {\n  t\n'
        );
        expect(issues).toEqual([
            expect.objectContaining({
                severity: 'error',
                code: 'area_malformed',
                line: 4,
            }),
        ]);
    });

    it('reports an unreadable line inside a block as an error with its line', () => {
        const { issues } = extractAreaBlocks(
            'Area "A" {\n  users\n  users matches\n}'
        );
        expect(issues).toEqual([
            expect.objectContaining({ severity: 'error', line: 3 }),
        ]);
    });

    it('warns about unknown settings and invalid colours but keeps the Area', () => {
        const { issues, areas } = extractAreaBlocks(
            'Area "A" [color: purple, zoom: 2] {\n  users [width: 3]\n}'
        );
        expect(areas).toHaveLength(1);
        expect(issues.map((i) => i.code).sort()).toEqual([
            'area_invalid_color',
            'area_unknown_setting',
            'area_unknown_setting',
        ]);
        expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    });
});

describe('resolveParsedAreas', () => {
    it('maps names to table ids and lays out tables without positions', () => {
        const { areas } = extractAreaBlocks(
            'Area "Users" {\n users\n user_auth_identities [x: 10, y: 20]\n}'
        );
        const { areaViews, issues } = resolveParsedAreas(areas, {
            tables,
            relationships,
            generateId,
        });

        expect(issues).toEqual([]);
        expect(areaViews).toHaveLength(1);
        expect(areaViews[0].tables.map((t) => t.tableId)).toEqual([
            't_users',
            't_auth',
        ]);
        const auth = areaViews[0].tables[1];
        expect([auth.x, auth.y]).toEqual([10, 20]);
        const users = areaViews[0].tables[0];
        expect(Number.isFinite(users.x) && Number.isFinite(users.y)).toBe(true);
    });

    it('lets one table appear in several Areas and assigns distinct palette colours', () => {
        const { areas } = extractAreaBlocks(
            'Area "Users" { \n users \n}\nArea "Matches" {\n matches\n users\n}\nArea "Finances" {\n users\n}'
        );
        const { areaViews } = resolveParsedAreas(areas, {
            tables,
            relationships,
            generateId,
        });

        expect(areaViews.map((a) => a.order)).toEqual([0, 1, 2]);
        expect(
            areaViews.every((a) =>
                a.tables.some((t) => t.tableId === 't_users')
            )
        ).toBe(true);
        expect(new Set(areaViews.map((a) => a.color)).size).toBe(3);
    });

    it('reports missing tables and repeats within an Area without failing', () => {
        const { areas } = extractAreaBlocks(
            'Area "A" {\n users\n ghost_table\n users\n}'
        );
        const { areaViews, issues } = resolveParsedAreas(areas, {
            tables,
            relationships,
            generateId,
        });

        expect(areaViews[0].tables.map((t) => t.tableId)).toEqual(['t_users']);
        expect(issues).toEqual([
            expect.objectContaining({
                code: 'area_missing_table',
                severity: 'warning',
                line: 3,
            }),
            expect.objectContaining({
                code: 'area_duplicate_table',
                severity: 'warning',
                line: 4,
            }),
        ]);
    });

    it('rejects two Areas with the same name', () => {
        const { areas } = extractAreaBlocks(
            'Area "A" {\n users\n}\nArea "a" {\n matches\n}'
        );
        const { issues } = resolveParsedAreas(areas, {
            tables,
            relationships,
            generateId,
        });
        expect(issues).toEqual([
            expect.objectContaining({
                code: 'area_duplicate_name',
                severity: 'error',
                line: 4,
            }),
        ]);
    });

    it('asks for a schema when a bare name matches tables in several non-default schemas', () => {
        const multiSchema = [
            makeTable('a', 'events', 'audit'),
            makeTable('b', 'events', 'billing'),
        ];
        const { areas } = extractAreaBlocks(
            'Area "A" {\n events\n billing.events\n}'
        );
        const { areaViews, issues } = resolveParsedAreas(areas, {
            tables: multiSchema,
            relationships,
            defaultSchema: 'public',
            generateId,
        });

        expect(issues).toEqual([
            expect.objectContaining({ code: 'area_ambiguous_table', line: 2 }),
        ]);
        expect(areaViews[0].tables.map((t) => t.tableId)).toEqual(['b']);
    });
});

describe('serializeAreaViews', () => {
    it('round-trips names, order, colours, positions and Float layout', () => {
        const { areas } = extractAreaBlocks(`Area "Users" [color: #b067e9] {
    users [x: 120, y: 80]
    user_auth_identities [x: 480.25, y: 80]
    float matches [x: 900, y: 300, expanded]
}

Area "Matches" [color: #8eb7ff] {
    matches [x: 0, y: 0]
    users [x: 400, y: 0]
}`);
        const first = resolveParsedAreas(areas, {
            tables,
            relationships,
            generateId,
        }).areaViews;

        const text = serializeAreaViews(first, { tables });
        const reparsed = resolveParsedAreas(extractAreaBlocks(text).areas, {
            tables,
            relationships,
            generateId,
        }).areaViews;

        const strip = (views: typeof first) =>
            views.map(({ name, color, order, tables: t, floats }) => ({
                name,
                color,
                order,
                tables: t,
                floats,
            }));
        expect(strip(reparsed)).toEqual(strip(first));
        expect(text).toContain('float matches [x: 900, y: 300, expanded]');
    });

    it('leaves out instances of tables that no longer exist', () => {
        const text = serializeAreaViews(
            [
                {
                    id: 'a',
                    name: 'A',
                    color: '#b067e9',
                    order: 0,
                    createdAt: 0,
                    tables: [
                        { tableId: 't_users', x: 0, y: 0 },
                        { tableId: 'deleted', x: 0, y: 0 },
                    ],
                },
            ],
            { tables }
        );
        expect(text).toBe(
            'Area "A" [color: #b067e9] {\n    users [x: 0, y: 0]\n}'
        );
    });

    it('qualifies tables outside the default schema and quotes unusual names', () => {
        const text = serializeAreaViews(
            [
                {
                    id: 'a',
                    name: 'Say "hi"',
                    color: '#b067e9',
                    order: 0,
                    createdAt: 0,
                    tables: [
                        { tableId: 'p', x: 0, y: 0 },
                        { tableId: 'q', x: 1, y: 1 },
                    ],
                },
            ],
            {
                tables: [
                    makeTable('p', 'users', 'public'),
                    makeTable('q', 'line items', 'billing'),
                ],
                defaultSchema: 'public',
            }
        );
        expect(text).toContain('Area "Say \\"hi\\""');
        expect(text).toContain('    users [x: 0, y: 0]');
        expect(text).toContain('    billing."line items" [x: 1, y: 1]');
        expect(extractAreaBlocks(text).areas[0].name).toBe('Say "hi"');
    });
});

describe('commentLossWarning', () => {
    it('counts line comments outside strings', () => {
        const warning = commentLossWarning(
            "// one\nTable t {\n id int // two\n note: 'not // a comment'\n}"
        );
        expect(warning?.code).toBe('comments_not_kept');
        expect(warning?.message).toMatch(/^2 /);
    });

    it('returns null when there are none', () => {
        expect(commentLossWarning('Table t {\n id int\n}')).toBeNull();
    });
});

describe('Float filter setting', () => {
    it('reads and writes [floats: outgoing] on an Area', () => {
        const { areas, issues } = extractAreaBlocks(
            'Area "Users" [color: #b067e9, floats: outgoing] {\n  users\n}'
        );
        expect(issues).toEqual([]);
        const { areaViews } = resolveParsedAreas(areas, {
            tables,
            relationships,
            generateId,
        });
        expect(areaViews[0].floatFilter).toBe('outgoing');

        const text = serializeAreaViews(areaViews, { tables });
        expect(text).toContain('[color: #b067e9, floats: outgoing]');
    });
});
