/**
 * Import → edit → export → reimport (LuxDBDiagram).
 *
 * The schema must survive both export modes unchanged, and LuxDBDiagram DBML must also keep
 * every meaningful piece of presentation metadata: Areas, their order and colours, table
 * positions in each Area, Float positions and expanded state, and the Float filter.
 */
import { describe, expect, it } from 'vitest';
import { importDBMLToDiagram } from '@/lib/dbml/dbml-import/dbml-import';
import { DatabaseType } from '@/lib/domain/database-type';
import { effectiveFloatFilter } from '@/lib/domain/area-view';
import type { Diagram } from '@/lib/domain/diagram';
import {
    diagramFromJSONInput,
    diagramToJSONOutput,
} from '@/lib/export-import-utils';
import { dbmlFileName, exportDiagramAsDBML } from '../dbml-file-export';
import {
    addTableInstances,
    removeTableInstances,
    setFloatLayout,
    setInstancePositions,
} from '../area-view-ops';

const SCHEMA = `
Enum match_status {
  scheduled
  played
  cancelled
}

Table users {
  user_id bigint [pk, increment]
  username text [unique, not null]
  email text [not null]
  status smallint [not null, default: 1]
  updated_by bigint [not null, ref: > users.user_id]
}

Table teams {
  team_id int [pk]
  name text [not null]
  updated_by bigint [not null, ref: > users.user_id]
}

Table matches {
  match_id int [pk]
  status match_status [not null]
  home_team_id int [not null, ref: > teams.team_id]
  away_team_id int [not null, ref: > teams.team_id]
  referee_id bigint [ref: > users.user_id]
  kickoff timestamptz

  indexes {
    (home_team_id, kickoff) [unique, name: 'uq_home_kickoff']
  }
}

Table match_teams {
  match_team_id int [pk]
  match_id int [not null]
  team_id int [not null]
  updated_by bigint [not null]
}

Ref: match_teams.match_id > matches.match_id
Ref: match_teams.team_id > teams.team_id
Ref: match_teams.updated_by > users.user_id
`;

const AREAS = `
Area "Users" {
    users
}

Area "Matches" [color: #8eb7ff] {
    matches
    match_teams
    users
}
`;

/** Everything about the schema that must survive a round trip, in a comparable form. */
const schemaSignature = (diagram: Diagram) => ({
    tables: (diagram.tables ?? [])
        .map((table) => ({
            name: table.name,
            fields: table.fields.map((field) => ({
                name: field.name,
                type: field.type.name,
                primaryKey: field.primaryKey,
                unique: field.unique,
                nullable: field.nullable,
                default: field.default ?? null,
            })),
            indexes: table.indexes
                .filter((index) => !index.isPrimaryKey)
                .map((index) => ({
                    name: index.name,
                    unique: index.unique,
                    fields: index.fieldIds.map(
                        (id) => table.fields.find((f) => f.id === id)?.name
                    ),
                })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    relationships: (diagram.relationships ?? [])
        .map((rel) => {
            const name = (tableId: string, fieldId: string) => {
                const table = diagram.tables!.find((t) => t.id === tableId)!;
                return `${table.name}.${table.fields.find((f) => f.id === fieldId)!.name}`;
            };
            const source = `${name(rel.sourceTableId, rel.sourceFieldId)}[${rel.sourceCardinality}]`;
            const target = `${name(rel.targetTableId, rel.targetFieldId)}[${rel.targetCardinality}]`;
            // ChartDB may write a Ref either way round; the relationship is the same, so
            // compare it from its "many" (foreign key) end, or alphabetically when equal.
            const ends =
                rel.sourceCardinality === rel.targetCardinality
                    ? [source, target].sort()
                    : rel.sourceCardinality === 'many'
                      ? [source, target]
                      : [target, source];
            return ends.join(' -> ');
        })
        .sort(),
    enums: (diagram.customTypes ?? [])
        .map((type) => `${type.name}:${(type.values ?? []).join(',')}`)
        .sort(),
});

/** Everything about the Areas that must survive, by table name rather than id. */
const areaSignature = (diagram: Diagram) => {
    const tableName = (id: string) =>
        diagram.tables!.find((table) => table.id === id)?.name;
    return [...(diagram.areaViews ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((area) => ({
            name: area.name,
            color: area.color,
            floatFilter: effectiveFloatFilter(area.floatFilter),
            tables: area.tables.map((instance) => ({
                table: tableName(instance.tableId),
                x: instance.x,
                y: instance.y,
            })),
            floats: (area.floats ?? [])
                .filter((float) => tableName(float.tableId))
                .map((float) => ({
                    table: tableName(float.tableId),
                    x: float.x,
                    y: float.y,
                    expanded: !!float.expanded,
                })),
        }));
};

const importText = (text: string) =>
    importDBMLToDiagram(text, { databaseType: DatabaseType.POSTGRESQL });

/** Applies typical edits: schema and presentation. */
const edit = (diagram: Diagram): Diagram => {
    const tableId = (name: string) =>
        diagram.tables!.find((table) => table.name === name)!.id;
    const [usersArea, matchesArea] = [...diagram.areaViews!].sort(
        (a, b) => a.order - b.order
    );

    let users = addTableInstances(usersArea, [
        { tableId: tableId('teams'), x: 500, y: 40 },
    ]).areaView;
    users = setInstancePositions(users, [
        { tableId: tableId('users'), x: -120.5, y: 33 },
    ]);
    users = { ...users, color: '#ff9f74', floatFilter: 'all' };

    let matches = removeTableInstances(matchesArea, [tableId('match_teams')]);
    matches = setFloatLayout(matches, {
        tableId: tableId('teams'),
        x: 900,
        y: 120,
        expanded: true,
    });

    return {
        ...diagram,
        // A schema edit: a new column on a table shown in two Areas.
        tables: diagram.tables!.map((table) =>
            table.name === 'users'
                ? {
                      ...table,
                      fields: [
                          ...table.fields,
                          {
                              ...table.fields[2],
                              id: 'new-field',
                              name: 'display_name',
                              nullable: true,
                              unique: false,
                          },
                      ],
                  }
                : table
        ),
        areaViews: [users, matches],
    };
};

describe('DBML round trip', () => {
    it('keeps the schema and every Area detail through LuxDBDiagram DBML', async () => {
        const edited = edit(await importText(SCHEMA + AREAS));
        const exported = exportDiagramAsDBML(edited, { withAreas: true });

        expect(exported.warnings).toEqual([]);
        expect(exported.content).toContain('Area "Users"');

        const reimported = await importText(exported.content);

        expect(schemaSignature(reimported)).toEqual(schemaSignature(edited));
        expect(areaSignature(reimported)).toEqual(areaSignature(edited));
        expect(
            schemaSignature(reimported)
                .tables.find((t) => t.name === 'users')!
                .fields.map((f) => f.name)
        ).toContain('display_name');
    });

    it('writes standard DBML with no Area blocks that reimports to the same schema', async () => {
        const edited = edit(await importText(SCHEMA + AREAS));
        const exported = exportDiagramAsDBML(edited, { withAreas: false });

        expect(exported.content).not.toMatch(/^\s*Area\s/m);

        const reimported = await importText(exported.content);
        expect(schemaSignature(reimported)).toEqual(schemaSignature(edited));
        expect(reimported.areaViews).toBeUndefined();
    });

    it('survives a second round trip unchanged', async () => {
        const first = await importText(
            exportDiagramAsDBML(edit(await importText(SCHEMA + AREAS)), {
                withAreas: true,
            }).content
        );
        const second = await importText(
            exportDiagramAsDBML(first, { withAreas: true }).content
        );
        expect(schemaSignature(second)).toEqual(schemaSignature(first));
        expect(areaSignature(second)).toEqual(areaSignature(first));
    });

    it('reports tables the DBML export has to leave out', async () => {
        const diagram = await importText(SCHEMA);
        const withEmpty: Diagram = {
            ...diagram,
            tables: [
                ...diagram.tables!,
                {
                    ...diagram.tables![0],
                    id: 'empty',
                    name: 'draft',
                    fields: [],
                },
            ],
        };
        const { warnings } = exportDiagramAsDBML(withEmpty, {
            withAreas: false,
        });
        expect(warnings).toEqual([expect.stringContaining('draft')]);
    });

    it('names export files after the diagram', () => {
        expect(dbmlFileName('GAP: schema', false)).toBe('GAP_ schema.dbml');
        expect(dbmlFileName('GAP', true)).toBe('GAP.luxdb.dbml');
    });
});

describe('Diagram JSON round trip', () => {
    it('keeps Areas pointing at the same tables after export and import', async () => {
        const edited = edit(await importText(SCHEMA + AREAS));
        const reloaded = diagramFromJSONInput(diagramToJSONOutput(edited));

        expect(areaSignature(reloaded)).toEqual(areaSignature(edited));
        expect(schemaSignature(reloaded)).toEqual(schemaSignature(edited));
    });
});

describe('Malformed and incomplete input', () => {
    it('rejects an Area block that is not closed, pointing at its line', async () => {
        await expect(
            importText(`${SCHEMA}\nArea "Broken" {\n  users\n`)
        ).rejects.toMatchObject({
            name: 'DBMLValidationError',
            dbmlError: expect.objectContaining({
                line: SCHEMA.split('\n').length + 1,
            }),
        });
    });

    it('imports the schema and reports an Area reference to a missing table', async () => {
        const issues: string[] = [];
        const diagram = await importDBMLToDiagram(
            `${SCHEMA}\nArea "Ghosts" {\n  users\n  ghost_table\n}`,
            {
                databaseType: DatabaseType.POSTGRESQL,
                onIssues: (found) => issues.push(...found.map((i) => i.code)),
            }
        );
        expect(diagram.tables).toHaveLength(4);
        expect(diagram.areaViews![0].tables).toHaveLength(1);
        expect(issues).toContain('area_missing_table');
    });
});
