/**
 * GAP schema checks (LuxDBDiagram).
 *
 * The Grassroots Admin Portal schema is a realistic large schema (60+ tables, 200 references,
 * split across domain files). It is not stored in this public repository: these tests run
 * only when LUXDB_GAP_SCHEMA_DIR points at GAP's `docs/architecture/schema` folder, and are
 * skipped otherwise.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { locateMergedLine, mergeDBMLFiles } from '../multi-file-dbml';
import { importDBMLToDiagram } from '@/lib/dbml/dbml-import/dbml-import';
import { DatabaseType } from '@/lib/domain/database-type';
import type { DBMLImportIssue } from '../area-dbml';
import { projectAreaView } from '../resolve-area-view';
import { resolveFloatCards } from '../floats';

const gapDir = process.env.LUXDB_GAP_SCHEMA_DIR;
const available = !!gapDir && existsSync(gapDir);

/** Domain files only: the combined and legacy whole-schema files would duplicate them. */
const WHOLE_SCHEMA_FILES = new Set(['gap_combined.dbml', 'schema.dbml']);

const readDomainFiles = () =>
    readdirSync(gapDir!)
        .filter((name) => name.endsWith('.dbml'))
        .filter((name) => !WHOLE_SCHEMA_FILES.has(name))
        .sort()
        .map((name) => ({
            name,
            content: readFileSync(join(gapDir!, name), 'utf8'),
        }));

const countTables = (content: string) =>
    (content.match(/^\s*Table\s/gm) ?? []).length;

interface CompilerDiag {
    message: string;
    location?: { start?: { line?: number } };
}

describe.skipIf(!available)('GAP schema (local only)', () => {
    /**
     * The domain files are the operator's working files and may contain broken references
     * at any moment. The test therefore checks the behaviour that matters: the files merge
     * into one schema with no conflicting definitions, references across files resolve, and
     * any reference that cannot resolve is reported with its own file and line.
     */
    it('merges the domain files into one schema and locates broken references', async () => {
        const files = readDomainFiles();
        const merged = mergeDBMLFiles(files);

        expect(merged.issues.filter((i) => i.severity === 'error')).toEqual([]);

        try {
            const diagram = await importDBMLToDiagram(merged.content, {
                databaseType: DatabaseType.POSTGRESQL,
            });
            const expectedTables = files.reduce(
                (sum, file) => sum + countTables(file.content),
                0
            );
            expect(diagram.tables).toHaveLength(expectedTables);
            expect(diagram.relationships!.length).toBeGreaterThan(100);
        } catch (error) {
            const diags = (error as { diags?: CompilerDiag[] }).diags ?? [];
            expect(diags.length).toBeGreaterThan(0);

            const located = diags.map((diag) => ({
                message: diag.message,
                at: locateMergedLine(
                    merged.files,
                    diag.location?.start?.line ?? 0
                ),
            }));
            // Only genuinely missing tables may fail the merged import, and each must be
            // traced back to the domain file and line that references it.
            for (const problem of located) {
                expect(problem.message).toMatch(/Can not find Table/);
                expect(problem.at?.file).toMatch(/\.dbml$/);
            }
            console.warn(
                'GAP domain files reference missing tables:',
                located
                    .map((p) => `${p.at?.file}:${p.at?.line} ${p.message}`)
                    .join('; ')
            );
        }
    });

    it('imports the combined file with Areas, sharing users between them', async () => {
        const combined = readFileSync(
            join(gapDir!, 'gap_combined.dbml'),
            'utf8'
        );
        const areas = `
Area "Users" {
    users
    user_auth_identities
    user_additional_emails
}

Area "Matches" {
    matches
    match_teams
    match_team_player
    users
}

Area "Finances" {
    transactions
    accounts
    bank_accounts
    users
}`;
        let issues: DBMLImportIssue[] = [];
        const diagram = await importDBMLToDiagram(combined + areas, {
            databaseType: DatabaseType.POSTGRESQL,
            onIssues: (found) => (issues = found),
        });
        const users = diagram.tables!.find((table) => table.name === 'users')!;

        expect(diagram.areaViews!.map((area) => area.name)).toEqual([
            'Users',
            'Matches',
            'Finances',
        ]);
        expect(
            diagram.areaViews!.every((area) =>
                area.tables.some((instance) => instance.tableId === users.id)
            )
        ).toBe(true);
        expect(diagram.tables!.filter((t) => t.name === 'users')).toHaveLength(
            1
        );
        expect(issues.filter((i) => i.code.startsWith('area_'))).toEqual([]);
        expect(issues.map((i) => i.code)).toContain('comments_not_kept');
    });

    it('groups references from the Matches Area to users into one Float', async () => {
        const combined = readFileSync(
            join(gapDir!, 'gap_combined.dbml'),
            'utf8'
        );
        const diagram = await importDBMLToDiagram(
            `${combined}
Area "Matches" {
  matches
  match_teams
  match_team_player
}`,
            { databaseType: DatabaseType.POSTGRESQL }
        );
        const area = diagram.areaViews![0];
        const projection = projectAreaView({
            areaView: area,
            tables: diagram.tables!,
            relationships: diagram.relationships!,
            dependencies: [],
        });
        const cards = resolveFloatCards({
            crossRelationships: projection.crossRelationships,
            tables: diagram.tables!,
            instances: area.tables,
        });
        const usersFloats = cards.filter((card) => card.tableName === 'users');

        expect(usersFloats).toHaveLength(1);
        expect(usersFloats[0].rows.length).toBeGreaterThanOrEqual(3);
        expect(
            usersFloats[0].rows.every(
                (row) =>
                    row.referenced.tableName === 'users' &&
                    row.direction === 'outgoing'
            )
        ).toBe(true);
        // Every relationship crossing the Area appears on exactly one Float row.
        expect(cards.flatMap((card) => card.rows).length).toBe(
            projection.crossRelationships.length
        );
    });
});
