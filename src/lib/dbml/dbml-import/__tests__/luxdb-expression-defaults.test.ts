import { describe, expect, it } from 'vitest';
import { importDBMLToDiagram } from '../dbml-import';
import { generateDBMLFromDiagram } from '@/lib/dbml/dbml-export/dbml-export';
import { DatabaseType } from '@/lib/domain/database-type';

// LuxDBDiagram: GAP's users.dbml has `default: \`now() + interval '5 days'\``. Dropping the single
// quotes made the exporter's SQL invalid, so the whole diagram could not be exported.
describe('expression defaults with string literals', () => {
    const dbml = `
Table user_auth_identities {
  user_auth_identity_id bigint [pk]
  expires_at timestamptz [not null, default: \`now() + interval '5 days'\`]
  settings jsonb [default: \`'{}'::jsonb\`]
  label text [default: 'plain']
}`;

    it('keeps the single quotes of an expression, and still strips a plain string', async () => {
        const diagram = await importDBMLToDiagram(dbml, {
            databaseType: DatabaseType.POSTGRESQL,
        });
        const fields = Object.fromEntries(
            (diagram.tables?.[0]?.fields ?? []).map((field) => [
                field.name,
                field.default,
            ])
        );
        expect(fields.expires_at).toBe("now() + interval '5 days'");
        expect(fields.settings).toBe("'{}'::jsonb");
        expect(fields.label).toBe('plain');
    });

    it('exports the table again', async () => {
        const diagram = await importDBMLToDiagram(dbml, {
            databaseType: DatabaseType.POSTGRESQL,
        });
        const result = generateDBMLFromDiagram(diagram);
        expect(result.error).toBeUndefined();
        // @dbml/core writes the expression without spaces: `now()+interval'5 days'`.
        expect(result.standardDbml).toMatch(
            /now\(\)\s*\+\s*interval\s*'5 days'/
        );
    });
});
