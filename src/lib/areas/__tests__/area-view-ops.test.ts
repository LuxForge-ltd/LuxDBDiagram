import { describe, expect, it } from 'vitest';
import {
    AREA_PALETTE,
    addTableInstances,
    buildAreaView,
    getAreaViewsContainingTable,
    getLiveInstances,
    pickAreaColor,
    remapAreaViewIds,
    removeTableInstances,
    reorderAreaViews,
    setFloatLayout,
    setInstancePositions,
    sortAreaViews,
    uniqueAreaName,
} from '../area-view-ops';
import type { AreaView } from '@/lib/domain/area-view';
import { cloneDiagram } from '@/lib/clone';
import { DatabaseType } from '@/lib/domain/database-type';

const area = (overrides: Partial<AreaView> = {}): AreaView => ({
    id: 'a1',
    name: 'Users',
    color: AREA_PALETTE[0],
    order: 0,
    tables: [],
    floats: [],
    createdAt: 1,
    ...overrides,
});

describe('area view operations', () => {
    it('never adds a table twice to the same Area', () => {
        const start = area({ tables: [{ tableId: 'users', x: 0, y: 0 }] });
        const { areaView, added, skipped } = addTableInstances(start, [
            { tableId: 'users', x: 50, y: 50 },
            { tableId: 'emails', x: 10, y: 10 },
            { tableId: 'emails', x: 99, y: 99 },
        ]);

        expect(added).toEqual(['emails']);
        expect(skipped).toEqual(['users', 'emails']);
        expect(areaView.tables).toEqual([
            { tableId: 'users', x: 0, y: 0 },
            { tableId: 'emails', x: 10, y: 10 },
        ]);
    });

    it('removes only the instance, leaving other Areas alone', () => {
        const users = area({
            tables: [
                { tableId: 'users', x: 0, y: 0 },
                { tableId: 'emails', x: 1, y: 1 },
            ],
        });
        const matches = area({
            id: 'a2',
            tables: [{ tableId: 'users', x: 5, y: 5 }],
        });

        const updated = removeTableInstances(users, ['users']);

        expect(updated.tables.map((t) => t.tableId)).toEqual(['emails']);
        expect(matches.tables).toHaveLength(1);
    });

    it('moves instances independently per Area', () => {
        const users = area({ tables: [{ tableId: 'users', x: 0, y: 0 }] });
        const moved = setInstancePositions(users, [
            { tableId: 'users', x: 300, y: 40 },
            { tableId: 'not-here', x: 1, y: 1 },
        ]);
        expect(moved.tables).toEqual([{ tableId: 'users', x: 300, y: 40 }]);
    });

    it('stores and updates Float layout', () => {
        const withFloat = setFloatLayout(area(), {
            tableId: 'matches',
            x: 9,
            y: 8,
        });
        const expanded = setFloatLayout(withFloat, {
            tableId: 'matches',
            expanded: true,
        });
        expect(expanded.floats).toEqual([
            { tableId: 'matches', x: 9, y: 8, expanded: true },
        ]);
    });

    it('picks unused palette colours first, then cycles', () => {
        expect(pickAreaColor([])).toBe(AREA_PALETTE[0]);
        expect(pickAreaColor([area()])).toBe(AREA_PALETTE[1]);
        const all = AREA_PALETTE.map((color, i) => area({ id: `${i}`, color }));
        expect(pickAreaColor(all)).toBe(
            AREA_PALETTE[all.length % AREA_PALETTE.length]
        );
    });

    it('generates unique names', () => {
        expect(uniqueAreaName([])).toBe('Area 1');
        expect(uniqueAreaName([area({ name: 'Area 1' })])).toBe('Area 2');
        expect(uniqueAreaName([area({ name: 'Users' })], 'users')).toBe(
            'users 2'
        );
        expect(uniqueAreaName([area({ name: 'Users' })], 'Matches')).toBe(
            'Matches'
        );
    });

    it('builds a new Area after the last one with defaults', () => {
        const built = buildAreaView([area({ order: 4 })], {}, () => 'new');
        expect(built).toMatchObject({
            id: 'new',
            name: 'Area 2',
            order: 5,
            color: AREA_PALETTE[1],
            tables: [],
        });
    });

    it('orders Areas deterministically and finds the ones containing a table', () => {
        const views = [
            area({
                id: 'c',
                order: 2,
                tables: [{ tableId: 'users', x: 0, y: 0 }],
            }),
            area({
                id: 'a',
                order: 0,
                tables: [{ tableId: 'users', x: 0, y: 0 }],
            }),
            area({ id: 'b', order: 1, tables: [] }),
        ];
        expect(sortAreaViews(views).map((v) => v.id)).toEqual(['a', 'b', 'c']);
        expect(
            getAreaViewsContainingTable(views, 'users').map((v) => v.id)
        ).toEqual(['a', 'c']);
    });

    it('computes order changes when Areas are reordered', () => {
        const views = [
            area({ id: 'a', order: 0 }),
            area({ id: 'b', order: 1 }),
            area({ id: 'c', order: 2 }),
        ];
        expect(reorderAreaViews(views, ['c', 'a', 'b'])).toEqual([
            { id: 'c', order: 0 },
            { id: 'a', order: 1 },
            { id: 'b', order: 2 },
        ]);
        expect(reorderAreaViews(views, ['a', 'b', 'c'])).toEqual([]);
    });

    it('hides instances whose table was deleted', () => {
        const users = area({
            tables: [
                { tableId: 'users', x: 0, y: 0 },
                { tableId: 'gone', x: 0, y: 0 },
            ],
        });
        expect(getLiveInstances(users, new Set(['users']))).toEqual([
            { tableId: 'users', x: 0, y: 0 },
        ]);
    });

    it('remaps table ids and drops instances with no new id', () => {
        const ids = new Map([
            ['a1', 'A1'],
            ['users', 'USERS'],
            ['matches', 'MATCHES'],
        ]);
        const [remapped] = remapAreaViewIds(
            [
                area({
                    tables: [
                        { tableId: 'users', x: 1, y: 2 },
                        { tableId: 'unknown', x: 0, y: 0 },
                    ],
                    floats: [{ tableId: 'matches', x: 3, y: 4 }],
                }),
            ],
            (id) => ids.get(id) ?? null,
            () => 'fallback'
        );
        expect(remapped.id).toBe('A1');
        expect(remapped.tables).toEqual([{ tableId: 'USERS', x: 1, y: 2 }]);
        expect(remapped.floats).toEqual([{ tableId: 'MATCHES', x: 3, y: 4 }]);
    });

    it('keeps Areas pointing at the right tables when a diagram is cloned', () => {
        const { diagram } = cloneDiagram({
            id: 'd',
            name: 'D',
            databaseType: DatabaseType.POSTGRESQL,
            createdAt: new Date(),
            updatedAt: new Date(),
            tables: [
                {
                    id: 'users',
                    name: 'users',
                    x: 0,
                    y: 0,
                    fields: [],
                    indexes: [],
                    color: '#fff',
                    isView: false,
                    createdAt: 0,
                },
            ],
            areaViews: [area({ tables: [{ tableId: 'users', x: 7, y: 8 }] })],
        });

        const newTableId = diagram.tables![0].id;
        expect(newTableId).not.toBe('users');
        expect(diagram.areaViews![0].tables).toEqual([
            { tableId: newTableId, x: 7, y: 8 },
        ]);
        expect(diagram.areaViews![0].id).not.toBe('a1');
    });
});
