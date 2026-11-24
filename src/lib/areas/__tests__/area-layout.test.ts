import { describe, expect, it } from 'vitest';
import { layoutAreaInstances, placeNewInstances } from '../area-layout';
import type { DBTable } from '@/lib/domain/db-table';
import type { DBRelationship } from '@/lib/domain/db-relationship';

const table = (id: string): DBTable => ({
    id,
    name: id,
    x: 9999,
    y: 9999,
    fields: [
        {
            id: `${id}_id`,
            name: 'id',
            type: { id: 'int', name: 'int' },
            primaryKey: true,
            unique: true,
            nullable: false,
            createdAt: 0,
        },
    ],
    indexes: [],
    color: '#fff',
    isView: false,
    createdAt: 0,
});

const tables = ['a', 'b', 'c', 'd'].map(table);
const relationships: DBRelationship[] = [];

describe('placeNewInstances', () => {
    it('places new tables below existing ones without moving them', () => {
        const existing = [
            { tableId: 'a', x: 0, y: 0 },
            { tableId: 'b', x: 400, y: 0 },
        ];
        const placed = placeNewInstances({
            existing,
            tableIds: ['c', 'd'],
            tables,
            relationships,
        });

        expect(placed.map((p) => p.tableId)).toEqual(['c', 'd']);
        expect(placed.every((p) => p.y > 0)).toBe(true);
        expect(placed[0].x).toBe(0);
        expect(existing).toEqual([
            { tableId: 'a', x: 0, y: 0 },
            { tableId: 'b', x: 400, y: 0 },
        ]);
    });

    it('never returns a table that is already in the Area, nor a repeat', () => {
        const placed = placeNewInstances({
            existing: [{ tableId: 'a', x: 0, y: 0 }],
            tableIds: ['a', 'b', 'b'],
            tables,
            relationships,
        });
        expect(placed.map((p) => p.tableId)).toEqual(['b']);
    });

    it('lays out an empty Area as a whole, independent of canonical positions', () => {
        const placed = placeNewInstances({
            existing: [],
            tableIds: ['a', 'b'],
            tables,
            relationships,
        });
        expect(placed).toHaveLength(2);
        expect(placed.some((p) => p.x === 9999 && p.y === 9999)).toBe(false);
    });
});

describe('layoutAreaInstances', () => {
    it('keeps every given position', () => {
        const instances = [
            { tableId: 'a', x: 5, y: 6 },
            { tableId: 'b', x: 7, y: 8 },
        ];
        expect(
            layoutAreaInstances({ instances, tables, relationships })
        ).toEqual(instances);
    });
});
