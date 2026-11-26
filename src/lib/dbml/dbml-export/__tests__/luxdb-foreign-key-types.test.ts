import { describe, expect, it } from 'vitest';
import { importDBMLToDiagram } from '@/lib/dbml/dbml-import/dbml-import';
import { generateDBMLFromDiagram } from '../dbml-export';
import { DatabaseType } from '@/lib/domain/database-type';

// LuxDBDiagram: GAP's schema has `goals.team_id bigint [ref: > teams.team_id]` where `teams.team_id`
// is an integer. The SQL step the exporter uses widened the referenced column to match, and did
// it by changing the diagram it was given, so the next export came out different again.
describe('exporting DBML keeps foreign key column types', () => {
    const dbml = `
Table teams {
  team_id integer [pk, increment]
  name text [not null]
}

Table goals {
  goal_id bigint [pk, increment]
  team_id bigint [not null, ref: > teams.team_id]
}

Table team_positions {
  team_position_id bigint [pk]
  team_id integer [ref: > teams.team_id]
}`;

    const columnLine = (text: string, table: string, column: string) => {
        const lines = text.split('\n');
        const start = lines.findIndex((line) =>
            line.startsWith(`Table "public"."${table}"`)
        );
        return lines
            .slice(start)
            .find((line) => line.trim().startsWith(`"${column}"`))
            ?.trim();
    };

    it('writes each column with the type the diagram has', async () => {
        const diagram = await importDBMLToDiagram(dbml, {
            databaseType: DatabaseType.POSTGRESQL,
        });
        const { standardDbml, error } = generateDBMLFromDiagram(diagram);
        expect(error).toBeUndefined();
        expect(columnLine(standardDbml, 'teams', 'team_id')).toMatch(
            /^"team_id" int /
        );
        expect(columnLine(standardDbml, 'goals', 'team_id')).toMatch(
            /^"team_id" bigint /
        );
        expect(columnLine(standardDbml, 'team_positions', 'team_id')).toMatch(
            /^"team_id" int/
        );
    });

    it('leaves the diagram unchanged, so exporting again gives the same text', async () => {
        const diagram = await importDBMLToDiagram(dbml, {
            databaseType: DatabaseType.POSTGRESQL,
        });
        const before = structuredClone(diagram);
        const first = generateDBMLFromDiagram(diagram).standardDbml;
        expect(diagram).toEqual(before);
        const second = generateDBMLFromDiagram(diagram).standardDbml;
        expect(second).toBe(first);
    });
});
