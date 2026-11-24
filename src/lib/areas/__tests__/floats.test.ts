import { describe, expect, it } from 'vitest';
import {
    deriveCrowFeet,
    estimateFloatHeight,
    FLOAT_COLLAPSED_ROWS,
    placeFloatCards,
    applyFloatFilter,
    placeFloatItems,
    resolveFloatCards,
} from '../floats';
import { projectAreaView } from '../resolve-area-view';
import type { DBTable } from '@/lib/domain/db-table';
import type { DBField } from '@/lib/domain/db-field';
import type { DBRelationship } from '@/lib/domain/db-relationship';
import type { AreaView } from '@/lib/domain/area-view';

const field = (
    tableId: string,
    name: string,
    options: Partial<DBField> = {}
): DBField => ({
    id: `${tableId}.${name}`,
    name,
    type: { id: 'bigint', name: 'bigint' },
    primaryKey: false,
    unique: false,
    nullable: true,
    createdAt: 0,
    ...options,
});

const table = (id: string, fields: DBField[]): DBTable => ({
    id,
    name: id,
    x: 0,
    y: 0,
    fields,
    indexes: [],
    color: '#8eb7ff',
    isView: false,
    createdAt: 0,
});

/**
 * A relationship the way ChartDB imports an inline DBML ref `child.fk > parent.pk`:
 * the referenced (one) end as source, the foreign key (many) end as target.
 */
const manyToOne = (
    id: string,
    child: string,
    fk: string,
    parent: string,
    pk: string
): DBRelationship => ({
    id,
    name: id,
    sourceTableId: parent,
    sourceFieldId: `${parent}.${pk}`,
    targetTableId: child,
    targetFieldId: `${child}.${fk}`,
    sourceCardinality: 'one',
    targetCardinality: 'many',
    createdAt: 0,
});

const pk = (tableId: string, name = 'id') =>
    field(tableId, name, { primaryKey: true, unique: true, nullable: false });

const users = table('users', [pk('users', 'user_id'), field('users', 'email')]);
const teamPlayer = table('team_player', [
    pk('team_player'),
    field('team_player', 'updated_by', { nullable: false }),
    field('team_player', 'created_by', { nullable: true }),
    field('team_player', 'team_id', { nullable: false }),
]);
const teams = table('teams', [pk('teams'), field('teams', 'updated_by')]);
const profiles = table('profiles', [
    pk('profiles'),
    field('profiles', 'user_id', { unique: true, nullable: false }),
]);

const relationships = [
    manyToOne('r_updated', 'team_player', 'updated_by', 'users', 'user_id'),
    manyToOne('r_created', 'team_player', 'created_by', 'users', 'user_id'),
    manyToOne('r_team', 'team_player', 'team_id', 'teams', 'id'),
    manyToOne('r_teams_updated', 'teams', 'updated_by', 'users', 'user_id'),
    manyToOne('r_profile', 'profiles', 'user_id', 'users', 'user_id'),
];
const tables = [users, teamPlayer, teams, profiles];

const area = (tableIds: string[]): AreaView => ({
    id: 'a',
    name: 'Matches',
    color: '#8eb7ff',
    order: 0,
    createdAt: 0,
    tables: tableIds.map((tableId, index) => ({
        tableId,
        x: index * 400,
        y: index * 50,
    })),
});

const cardsFor = (tableIds: string[], rels = relationships) => {
    const view = area(tableIds);
    const projection = projectAreaView({
        areaView: view,
        tables,
        relationships: rels,
        dependencies: [],
    });
    return resolveFloatCards({
        crossRelationships: projection.crossRelationships,
        tables,
        instances: view.tables,
    });
};

describe('resolveFloatCards', () => {
    it('groups every relationship to one off-Area table into a single Float', () => {
        const cards = cardsFor(['team_player', 'teams']);

        expect(cards.map((c) => c.tableName)).toEqual(['users']);
        expect(cards[0].rows.map((r) => r.relationshipId)).toEqual([
            'r_updated',
            'r_created',
            'r_teams_updated',
        ]);
    });

    it('keeps separate rows for several foreign keys between the same tables', () => {
        const [card] = cardsFor(['team_player']).filter(
            (c) => c.tableId === 'users'
        );
        expect(card.rows.map((r) => r.local.fieldName)).toEqual([
            'updated_by',
            'created_by',
        ]);
    });

    it('reads each row as referencing column -> referenced column, with direction', () => {
        const fromMatches = cardsFor(['team_player']).find(
            (c) => c.tableId === 'users'
        )!.rows[0];
        expect(fromMatches).toMatchObject({
            direction: 'outgoing',
            referencing: { tableName: 'team_player', fieldName: 'updated_by' },
            referenced: { tableName: 'users', fieldName: 'user_id' },
            local: { tableName: 'team_player' },
            external: { tableName: 'users' },
        });

        const fromUsers = cardsFor(['users'])
            .find((c) => c.tableId === 'team_player')!
            .rows.find((r) => r.relationshipId === 'r_updated');
        expect(fromUsers).toMatchObject({
            direction: 'incoming',
            referencing: { tableName: 'team_player', fieldName: 'updated_by' },
            referenced: { tableName: 'users', fieldName: 'user_id' },
            local: { tableName: 'users' },
            external: { tableName: 'team_player' },
        });
    });

    it('never makes a Float for a table shown in the Area', () => {
        const cards = cardsFor(['users', 'team_player', 'teams']);
        expect(cards.map((c) => c.tableName)).toEqual(['profiles']);
    });

    it('produces one Float with twenty rows for twenty references', () => {
        const children = Array.from({ length: 20 }, (_, i) =>
            table(`child_${String(i).padStart(2, '0')}`, [
                pk(`child_${String(i).padStart(2, '0')}`),
                field(`child_${String(i).padStart(2, '0')}`, 'user_id'),
            ])
        );
        const rels = children.map((child) =>
            manyToOne(`r_${child.id}`, child.id, 'user_id', 'users', 'user_id')
        );
        const view = area(children.map((c) => c.id));
        const all = [...tables, ...children];
        const projection = projectAreaView({
            areaView: view,
            tables: all,
            relationships: rels,
            dependencies: [],
        });
        const cards = resolveFloatCards({
            crossRelationships: projection.crossRelationships,
            tables: all,
            instances: view.tables,
        });

        expect(cards).toHaveLength(1);
        expect(cards[0].rows).toHaveLength(20);
        expect(
            cards[0].rows
                .slice(0, FLOAT_COLLAPSED_ROWS)
                .map((r) => r.local.tableName)
        ).toEqual(['child_00', 'child_01', 'child_02']);
    });

    it('is deterministic regardless of relationship order', () => {
        const forward = cardsFor(['team_player', 'teams']);
        const reversed = cardsFor(
            ['team_player', 'teams'],
            [...relationships].reverse()
        );
        expect(reversed).toEqual(forward);
    });
});

describe('deriveCrowFeet', () => {
    const feetOf = (relationshipId: string) => {
        const relationship = relationships.find(
            (r) => r.id === relationshipId
        )!;
        const fkTable = tables.find(
            (t) => t.id === relationship.targetTableId
        )!;
        const fkField = fkTable.fields.find(
            (f) => f.id === relationship.targetFieldId
        )!;
        return deriveCrowFeet({
            relationship,
            referencingTable: fkTable,
            referencingField: fkField,
        });
    };

    it('NOT NULL foreign key: exactly one referenced, zero or many referencing', () => {
        expect(feetOf('r_updated')).toEqual({
            referenced: 'exactly_one',
            referencing: 'zero_or_many',
        });
    });

    it('nullable foreign key: zero or one referenced', () => {
        expect(feetOf('r_created')).toEqual({
            referenced: 'zero_or_one',
            referencing: 'zero_or_many',
        });
    });

    it('unique foreign key: at most one referencing row', () => {
        expect(feetOf('r_profile')).toEqual({
            referenced: 'exactly_one',
            referencing: 'zero_or_one',
        });
    });

    it('handles the foreign key on the source end (many-to-one stored that way round)', () => {
        const relationship: DBRelationship = {
            ...relationships[0],
            sourceTableId: 'team_player',
            sourceFieldId: 'team_player.updated_by',
            targetTableId: 'users',
            targetFieldId: 'users.user_id',
            sourceCardinality: 'many',
            targetCardinality: 'one',
        };
        expect(
            deriveCrowFeet({
                relationship,
                referencingTable: teamPlayer,
                referencingField: teamPlayer.fields[1],
            })
        ).toEqual({ referenced: 'exactly_one', referencing: 'zero_or_many' });
    });

    it('declared one-to-one and many-to-many keep their declared maximums', () => {
        const oneToOne: DBRelationship = {
            ...relationships[1],
            sourceCardinality: 'one',
            targetCardinality: 'one',
        };
        expect(
            deriveCrowFeet({
                relationship: oneToOne,
                referencingTable: teamPlayer,
                referencingField: teamPlayer.fields[2],
            })
        ).toEqual({ referenced: 'zero_or_one', referencing: 'zero_or_one' });

        const manyToMany: DBRelationship = {
            ...relationships[0],
            sourceCardinality: 'many',
            targetCardinality: 'many',
        };
        expect(
            deriveCrowFeet({
                relationship: manyToMany,
                referencingTable: teamPlayer,
                referencingField: teamPlayer.fields[1],
            })
        ).toEqual({ referenced: 'zero_or_many', referencing: 'zero_or_many' });
    });
});

describe('placeFloatCards', () => {
    const size = () => ({ width: 224, height: 200 });

    it('keeps stored positions and places others in a column to the right, without overlap', () => {
        const cards = cardsFor(['team_player']);
        const instances = area(['team_player']).tables;
        const positions = placeFloatCards({
            cards,
            instances,
            tableSize: size,
            stored: new Map([['teams', { x: -500, y: 40 }]]),
        });

        expect(positions.get('teams')).toEqual({ x: -500, y: 40 });
        const usersPosition = positions.get('users')!;
        expect(usersPosition.x).toBeGreaterThan(224);
    });

    it('stacks unplaced cards vertically', () => {
        const cards = cardsFor(['team_player']);
        const positions = placeFloatCards({
            cards,
            instances: area(['team_player']).tables,
            tableSize: size,
            stored: new Map(),
        });
        const ys = cards
            .map((c) => positions.get(c.tableId)!.y)
            .sort((a, b) => a - b);
        expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(
            estimateFloatHeight(1, false)
        );
    });
});

describe('applyFloatFilter', () => {
    it('passes every card through for "all" (and by default)', () => {
        const cards = cardsFor(['users']);
        expect(applyFloatFilter(cards, 'all').cards).toEqual(cards);
        expect(applyFloatFilter(cards, undefined).incoming).toEqual([]);
    });

    it('summarises incoming references per shown column for "outgoing", dropping nothing', () => {
        const cards = cardsFor(['users', 'teams']);
        const incomingRows = cards.flatMap((card) =>
            card.rows.filter((row) => row.direction === 'incoming')
        );
        const { cards: kept, incoming } = applyFloatFilter(cards, 'outgoing');

        expect(
            kept.every((card) =>
                card.rows.every((row) => row.direction === 'outgoing')
            )
        ).toBe(true);
        expect(
            incoming.reduce((sum, row) => sum + row.relationshipIds.length, 0)
        ).toBe(incomingRows.length);
        expect(
            incoming.find((row) => row.local.tableName === 'users')
        ).toMatchObject({
            local: { fieldName: 'user_id' },
            tableNames: ['profiles', 'team_player'],
        });
    });
});

describe('placeFloatItems', () => {
    it('wraps a long run of cards into further columns instead of one tall stack', () => {
        const items = Array.from({ length: 40 }, (_, i) => ({
            id: `t${i}`,
            name: `t${String(i).padStart(2, '0')}`,
            localTableIds: ['a'],
            height: 60,
        }));
        const positions = placeFloatItems({
            items,
            instances: [{ tableId: 'a', x: 0, y: 0 }],
            tableSize: () => ({ width: 224, height: 300 }),
            stored: new Map(),
        });

        const columns = new Set([...positions.values()].map((p) => p.x));
        expect(columns.size).toBeGreaterThan(1);
        for (const x of columns) {
            const ys = [...positions.values()]
                .filter((p) => p.x === x)
                .map((p) => p.y)
                .sort((a, b) => a - b);
            ys.slice(1).forEach((y, i) =>
                expect(y - ys[i]).toBeGreaterThanOrEqual(60)
            );
        }
    });
});
