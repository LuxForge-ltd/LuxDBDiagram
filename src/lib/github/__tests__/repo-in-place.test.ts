import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importDBMLToDiagram } from '@/lib/dbml/dbml-import/dbml-import';
import { DatabaseType } from '@/lib/domain/database-type';
import type { Diagram } from '@/lib/domain/diagram';
import {
    composeFolderDBML,
    isDBMLPath,
    withDefaultSelection,
} from '@/lib/areas/dbml-folder';
import { commentLineCount } from '@/lib/areas/dbml-in-place';
import {
    afterCommit,
    pullRequestBody,
    repoBaseline,
    repoEditedFiles,
} from '../repo-changes';
import { analyzeRepoChanges } from '../repo-in-place';
import { toRepoSource, type RepoSource } from '../repo-source';

const USERS = `// People who sign in
Table users {
  user_id bigint [pk]
  name text [not null] // as shown
}

Table profiles {
  profile_id bigint [pk]
  user_id bigint [ref: > users.user_id]
}
`;
const MATCHES = `// Matches, with who created them (users is in users.dbml)
Table matches {
  match_id bigint [pk]
  created_by bigint [ref: > users.user_id]
}
`;

type GitHubFile = { path: string; content: string; sha: string };

const sha = (n: number) => String(n).repeat(40).slice(0, 40);

/** Opens the folder as the import dialog does, possibly after editing files in the editor. */
const open = async (
    onGitHub: GitHubFile[],
    edits: Record<string, string> = {}
): Promise<{ diagram: Diagram; source: RepoSource }> => {
    const files = withDefaultSelection(
        onGitHub.map(({ path, content }) => ({
            path,
            content: edits[path] ?? content,
        }))
    );
    const diagram = await importDBMLToDiagram(
        composeFolderDBML(files).content,
        { databaseType: DatabaseType.POSTGRESQL }
    );
    const imported = files.filter((file) => file.selected);
    const source = toRepoSource(
        'diagram-1',
        {
            repo: 'LuxForge-ltd/schema',
            branch: 'Dev',
            folder: 'docs',
            commit: 'e'.repeat(40),
            baseBranch: 'Dev',
            workingBranch: 'luxdbdiag/docs-abc123',
            files: onGitHub,
        },
        imported.map((file) => file.path),
        1000,
        repoBaseline(diagram, imported, onGitHub),
        repoEditedFiles(diagram, imported, onGitHub)
    );
    return { diagram, source };
};

const field = (diagram: Diagram, table: string, column: string) => {
    const found = diagram.tables
        ?.find((t) => t.name === table)
        ?.fields.find((f) => f.name === column);
    if (!found) throw new Error(`${table}.${column} not found`);
    return found;
};

const tableFiles = (changes: Awaited<ReturnType<typeof analyzeRepoChanges>>) =>
    changes.changes.filter((change) => change.role !== 'layout');

describe('saving changed files in place', () => {
    const folder: GitHubFile[] = [
        { path: 'users.dbml', content: USERS, sha: sha(1) },
        { path: 'matches.dbml', content: MATCHES, sha: sha(2) },
    ];

    it('changes only the edited line and keeps the comments', async () => {
        const { diagram, source } = await open(folder);
        field(diagram, 'users', 'name').type = { id: 'int', name: 'int' };

        const result = await analyzeRepoChanges(diagram, source);
        const [change, ...others] = tableFiles(result);
        expect(others).toEqual([]);
        expect(change).toMatchObject({
            path: 'users.dbml',
            kind: 'changed',
            method: 'in-place',
            selected: true,
        });
        expect(change.after).toBe(
            USERS.replace(
                '  name text [not null] // as shown',
                '  name int [not null] // as shown'
            )
        );
        expect(result.unchanged).toEqual(['matches.dbml']);
    });

    it('edits a file whose relationships point into another file', async () => {
        const { diagram, source } = await open(folder);
        field(diagram, 'matches', 'created_by').nullable = false;

        const [change] = tableFiles(await analyzeRepoChanges(diagram, source));
        expect(change).toMatchObject({
            path: 'matches.dbml',
            method: 'in-place',
        });
        expect(change.after).toBe(
            MATCHES.replace(
                'created_by bigint [ref: > users.user_id]',
                'created_by bigint [not null, ref: > users.user_id]'
            )
        );
    });

    it('edits a file edited in the import editor from the text as imported', async () => {
        const edited = USERS.replace(
            '// People',
            '// Fixed before importing\n// People'
        );
        const { diagram, source } = await open(folder, {
            'users.dbml': edited,
        });
        expect(source.editedFiles?.['users.dbml']?.text).toBe(edited);

        // Unedited since import, it already counts as changed: the edit is not on GitHub yet.
        const [unchanged] = tableFiles(
            await analyzeRepoChanges(diagram, source)
        );
        expect(unchanged).toMatchObject({ method: 'in-place' });
        expect(unchanged.after).toBe(edited);

        field(diagram, 'profiles', 'profile_id').type = {
            id: 'int',
            name: 'int',
        };
        const [change] = tableFiles(await analyzeRepoChanges(diagram, source));
        expect(change.after).toBe(
            edited.replace(
                '  profile_id bigint [pk]',
                '  profile_id int [pk, not null]'
            )
        );

        // Once committed, GitHub has the file, so it is no longer an edited file.
        const next = afterCommit(
            source,
            diagram,
            [
                {
                    path: change.path,
                    content: change.after,
                    sha: sha(3),
                    kind: change.kind,
                },
            ],
            {
                kind: 'committed',
                branch: source.workingBranch,
                commit: 'f'.repeat(40),
            }
        );
        expect(next.editedFiles).toEqual({});
        expect(tableFiles(await analyzeRepoChanges(diagram, next))).toEqual([]);
    });

    it('rewrites a file it cannot edit in place, unticked, and counts the comments lost', async () => {
        const { diagram, source } = await open(folder);
        const unlinked: RepoSource = { ...source, generated: undefined };
        field(diagram, 'users', 'name').type = { id: 'int', name: 'int' };

        // With no record of how it read the folder, every file looks changed.
        const change = tableFiles(
            await analyzeRepoChanges(diagram, unlinked)
        ).find((c) => c.path === 'users.dbml');
        expect(change).toMatchObject({
            path: 'users.dbml',
            method: 'rewritten',
            selected: false,
            lostCommentLines: 2,
            rewriteReason: 'LuxDBDiag has no record of how it read this file',
        });
        expect(change!.after).not.toContain('// People');
    });

    it('marks rewritten files in the pull request description', () => {
        const body = pullRequestBody([
            { path: 'users.dbml', kind: 'changed' },
            { path: 'matches.dbml', kind: 'changed', rewritten: true },
        ]);
        expect(body).toContain('- Updated `users.dbml`\n');
        expect(body).toContain(
            '- Updated `matches.dbml` (rewritten whole by the DBML exporter, without its comments)'
        );
        expect(body).toContain('Updated files are edited in place');
    });
});

const gapDir = process.env.LUXDB_GAP_SCHEMA_DIR;

describe.skipIf(!gapDir || !existsSync(gapDir))(
    'saving GAP in place (local only)',
    () => {
        const read = (name: string): GitHubFile => ({
            path: name,
            content: readFileSync(join(gapDir!, name), 'utf8'),
            sha: sha(name.length),
        });

        it('keeps every comment of schema.dbml when one column changes', async () => {
            const file = read('schema.dbml');
            const { diagram, source } = await open([file]);
            const table = diagram.tables?.find((t) =>
                t.fields.some((f) => f.name === 'updated_by')
            );
            const changed = table!.fields.find((f) => f.name === 'updated_by')!;
            changed.default = '2';

            const [change, ...others] = tableFiles(
                await analyzeRepoChanges(diagram, source)
            );
            expect(others).toEqual([]);
            expect(change).toMatchObject({ method: 'in-place' });
            const before = file.content.split('\n');
            const after = change.after.split('\n');
            expect(after.length).toBe(before.length);
            const differing = after.filter((line, i) => line !== before[i]);
            expect(differing).toHaveLength(1);
            expect(differing[0]).toMatch(/updated_by .*default: 2/);
            expect(commentLineCount(change.after)).toBe(
                commentLineCount(file.content)
            );
        }, 60000);

        it('keeps the comments of the domain files when a table changes', async () => {
            const names = readdirSync(gapDir!).filter(isDBMLPath).sort();
            const files = names.map(read);
            // The two references that are broken in GAP's files, fixed in the import editor.
            const edits = {
                'finances.dbml': files
                    .find((f) => f.path === 'finances.dbml')!
                    .content.replace(
                        /match_team_players\./g,
                        'match_team_player.'
                    ),
            };
            const roles = files.find((f) => f.path === 'roles_groups.dbml')!;
            const { diagram, source } = await open(files, {
                ...edits,
                'roles_groups.dbml': roles.content.replace(
                    ', ref: > resource_groups.resource_group_id',
                    ''
                ),
            });
            expect(Object.keys(source.editedFiles ?? {}).sort()).toEqual([
                'finances.dbml',
                'roles_groups.dbml',
            ]);

            const users = diagram.tables?.find((t) => t.name === 'users');
            users!.comments = 'People who sign in';
            const result = await analyzeRepoChanges(diagram, source);
            const rewritten = tableFiles(result).filter(
                (change) => change.method === 'rewritten'
            );
            expect(
                rewritten.map((c) => `${c.path}: ${c.rewriteReason}`)
            ).toEqual([]);
            const usersFile = tableFiles(result).find((change) =>
                change.after.includes("Note: 'People who sign in'")
            );
            expect(usersFile).toMatchObject({ method: 'in-place' });
            for (const change of tableFiles(result)) {
                if (change.kind !== 'changed') continue;
                const start =
                    source.editedFiles?.[change.path]?.text ?? change.before!;
                expect(commentLineCount(change.after)).toBe(
                    commentLineCount(start)
                );
            }
        }, 120000);
    }
);
