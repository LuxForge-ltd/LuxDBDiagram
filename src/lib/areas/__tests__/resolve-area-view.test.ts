import { describe, expect, it } from 'vitest';
import { projectAreaView } from '../resolve-area-view';
import { getInstanceMarkers } from '../area-view-ops';
import type { AreaView } from '@/lib/domain/area-view';
import type { DBTable } from '@/lib/domain/db-table';
import type { DBRelationship } from '@/lib/domain/db-relationship';

const table = (id: string, fields: string[] = ['id']): DBTable => ({
    id,
    name: id,
    x: 0,
    y: 0,
    fields: fields.map((name) => ({
        id: `${id}.${name}`,
        name,
        type: { id: 'int', name: 'int' },
        primaryKey: name === 'id',
        unique: name === 'id',
        nullable: name !== 'id',
        createdAt: 0,
    })),
    indexes: [],
    color: '#8eb7ff',
    isView: false,
    createdAt: 0,
});

const rel = (
    id: string,
    source: string,
    sourceField: string,
    target: string,
    targetField: string
): DBRelationship => ({
    id,
    name: id,
    sourceTableId: source,
    sourceFieldId: `${source}.${sourceField}`,
    targetTableId: target,
    targetFieldId: `${target}.${targetField}`,
    sourceCardinality: 'one',
    targetCardinality: 'many',
    createdAt: 0,
});

const area = (
    id: string,
    order: number,
    tableIds: string[],
    color = '#b067e9'
): AreaView => ({
    id,
    name: id,
    color,
    order,
    createdAt: 0,
    tables: tableIds.map((tableId, index) => ({
        tableId,
        x: index * 300,
        y: order * 1000,
    })),
});

const tables = [
    table('users', ['id', 'updated_by']),
    table('matches', ['id', 'updated_by']),
    table('teams', ['id', 'match_id']),
];
const relationships = [
    rel('r1', 'users', 'id', 'matches', 'updated_by'),
    rel('r2', 'matches', 'id', 'teams', 'match_id'),
    rel('r3', 'users', 'id', 'users', 'updated_by'),
];

describe('projectAreaView', () => {
    it('shows only the Area tables, at Area positions and in the Area colour', () => {
        const projection = projectAreaView({
            areaView: area('Matches', 1, ['matches', 'teams'], '#8eb7ff'),
            tables,
            relationships,
            dependencies: [],
        });

        expect(projection.tables.map((t) => t.id)).toEqual([
            'matches',
            'teams',
        ]);
        expect(projection.tables.map((t) => [t.x, t.y])).toEqual([
            [0, 1000],
            [300, 1000],
        ]);
        expect(projection.tables.every((t) => t.color === '#8eb7ff')).toBe(
            true
        );
        // Canonical tables are untouched.
        expect(tables.find((t) => t.id === 'matches')).toMatchObject({
            x: 0,
            y: 0,
            color: '#8eb7ff',
        });
    });

    it('splits relationships into internal and cross-Area, never dropping one', () => {
        const projection = projectAreaView({
            areaView: area('Users', 0, ['users']),
            tables,
            relationships,
            dependencies: [],
        });

        expect(projection.relationships.map((r) => r.id)).toEqual(['r3']);
        expect(projection.crossRelationships.map((r) => r.id)).toEqual(['r1']);
    });

    it('reflects canonical table changes in every Area that shows the table', () => {
        const renamed = tables.map((t) =>
            t.id === 'users'
                ? {
                      ...t,
                      name: 'app_users',
                      fields: [
                          ...t.fields,
                          { ...t.fields[0], id: 'users.email', name: 'email' },
                      ],
                  }
                : t
        );
        const views = [
            area('A', 0, ['users']),
            area('B', 1, ['users', 'matches']),
        ];

        for (const view of views) {
            const shown = projectAreaView({
                areaView: view,
                tables: renamed,
                relationships,
                dependencies: [],
            }).tables.find((t) => t.id === 'users')!;
            expect(shown.name).toBe('app_users');
            expect(shown.fields.map((f) => f.name)).toContain('email');
        }
    });

    it('skips instances of deleted tables', () => {
        const projection = projectAreaView({
            areaView: area('A', 0, ['users', 'gone']),
            tables,
            relationships,
            dependencies: [],
        });
        expect(projection.tables.map((t) => t.id)).toEqual(['users']);
    });
});

describe('getInstanceMarkers (Dupe numbering)', () => {
    const views = [
        area('Finances', 2, ['users']),
        area('Users', 0, ['users']),
        area('Matches', 1, ['users', 'matches']),
        area('Permissions', 3, ['users']),
    ];

    it('numbers Areas by Area order, the same in every view, marking the open one', () => {
        const fromMatches = getInstanceMarkers(views, 'users', 'Matches');
        expect(fromMatches.map((m) => [m.number, m.name, m.current])).toEqual([
            [1, 'Users', false],
            [2, 'Matches', true],
            [3, 'Finances', false],
            [4, 'Permissions', false],
        ]);

        const fromFinances = getInstanceMarkers(views, 'users', 'Finances');
        expect(fromFinances.map((m) => m.number)).toEqual([1, 2, 3, 4]);
        expect(fromFinances.find((m) => m.current)?.name).toBe('Finances');
    });

    it('shows no markers inside an Area for a table that appears only there', () => {
        expect(getInstanceMarkers(views, 'matches', 'Matches')).toEqual([]);
    });

    it('shows markers in "All tables" for any table that is in an Area', () => {
        expect(
            getInstanceMarkers(views, 'matches', null).map((m) => m.name)
        ).toEqual(['Matches']);
        expect(getInstanceMarkers(views, 'teams', null)).toEqual([]);
    });
});
