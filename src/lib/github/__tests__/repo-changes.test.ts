import { describe, expect, it } from 'vitest';
import { importDBMLToDiagram } from '@/lib/dbml/dbml-import/dbml-import';
import { DatabaseType } from '@/lib/domain/database-type';
import type { Diagram } from '@/lib/domain/diagram';
import {
    composeFolderDBML,
    withDefaultSelection,
} from '@/lib/areas/dbml-folder';
import { AREA_LAYOUT_FILE } from '@/lib/areas/area-files';
import {
    afterCommit,
    defaultCommitMessage,
    pullRequestBody,
    repoBaseline,
    repoChanges,
} from '../repo-changes';
import { toRepoSource, type RepoSource } from '../repo-source';

const USERS = `// People who sign in
Table users {
  user_id bigint [pk]
  name text [not null]
}

Table profiles {
  profile_id bigint [pk]
  user_id bigint [ref: > users.user_id]
}
`;
const MATCHES = `Table matches {
  match_id bigint [pk]
  created_by bigint [ref: > users.user_id]
}
`;
const NOTES = `Table notes {
  note_id bigint [pk]
  body text
}
`;
const COMBINED = `${USERS}\n${MATCHES}\n${NOTES}`;

const onGitHub = [
    { path: 'users.dbml', content: USERS, sha: 'a'.repeat(40) },
    { path: 'matches.dbml', content: MATCHES, sha: 'b'.repeat(40) },
    { path: 'notes.dbml', content: NOTES, sha: 'c'.repeat(40) },
    { path: 'combined.dbml', content: COMBINED, sha: 'd'.repeat(40) },
];

/** Opens the folder as the import dialog does, possibly after editing files. */
const open = async (
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
            folder: 'docs/schema',
            commit: 'e'.repeat(40),
            baseBranch: 'Dev',
            workingBranch: 'luxdbdiag/schema-abc123',
            files: onGitHub,
        },
        imported.map((file) => file.path),
        1000,
        repoBaseline(diagram, imported, onGitHub)
    );
    return { diagram, source };
};

const withFieldType = (
    diagram: Diagram,
    tableName: string,
    fieldName: string,
    type: string
): Diagram => ({
    ...diagram,
    tables: diagram.tables?.map((table) =>
        table.name !== tableName
            ? table
            : {
                  ...table,
                  fields: table.fields.map((field) =>
                      field.name === fieldName
                          ? { ...field, type: { id: type, name: type } }
                          : field
                  ),
              }
    ),
});

describe('what saving to the repository changes', () => {
    it('changes nothing right after opening, and leaves combined copies alone', async () => {
        const { diagram, source } = await open();
        expect(
            source.files.find((f) => f.path === 'combined.dbml')?.selected
        ).toBe(false);
        const result = repoChanges(diagram, source);
        expect(
            result.changes.filter((change) => change.kind === 'changed')
        ).toEqual([]);
        expect(result.unchanged).toEqual([
            'matches.dbml',
            'notes.dbml',
            'users.dbml',
        ]);
        expect(result.untouched).toEqual(['combined.dbml']);
        expect(result.removed).toEqual([]);
        // The Areas file is new, and only committed when ticked.
        expect(result.changes).toEqual([
            expect.objectContaining({
                path: AREA_LAYOUT_FILE,
                kind: 'new',
                selected: false,
            }),
        ]);
    });

    it('does not count a different order of tables and relationships as a change', async () => {
        // ChartDB's storage returns tables and relationships ordered by id, not as imported.
        const { diagram, source } = await open();
        const reloaded: Diagram = {
            ...diagram,
            tables: [...(diagram.tables ?? [])].reverse(),
            relationships: [...(diagram.relationships ?? [])].reverse(),
        };
        const changed = repoChanges(reloaded, source).changes.filter(
            (change) => change.kind === 'changed'
        );
        expect(changed).toEqual([]);
    });

    it('marks only the file whose table changed', async () => {
        const { diagram, source } = await open();
        const edited = withFieldType(diagram, 'notes', 'body', 'varchar');
        const result = repoChanges(edited, source);
        const changed = result.changes.filter(
            (change) => change.kind === 'changed'
        );
        expect(changed.map((change) => change.path)).toEqual(['notes.dbml']);
        expect(changed[0]).toMatchObject({
            before: NOTES,
            expectedSha: 'c'.repeat(40),
            selected: true,
        });
        expect(changed[0].after).toContain('varchar');
        expect(result.unchanged).toEqual(['matches.dbml', 'users.dbml']);
    });

    it('counts a file edited in the import editor as changed', async () => {
        const fixed = NOTES.replace('body text', 'body varchar');
        const { diagram, source } = await open({ 'notes.dbml': fixed });
        const changed = repoChanges(diagram, source).changes.filter(
            (change) => change.kind === 'changed'
        );
        expect(changed.map((change) => change.path)).toEqual(['notes.dbml']);
    });

    it('lists files of deleted Areas without deleting them, and adds files for new Areas', async () => {
        const { diagram, source } = await open();
        const notesArea = diagram.areaViews!.find(
            (area) => area.fileName === 'notes.dbml'
        )!;
        const usersArea = diagram.areaViews!.find(
            (area) => area.fileName === 'users.dbml'
        )!;
        const edited: Diagram = {
            ...diagram,
            areaViews: [
                ...diagram.areaViews!.filter(
                    (area) => area.id !== notesArea.id
                ),
                {
                    ...usersArea,
                    id: 'new-area',
                    name: 'People',
                    fileName: null,
                    order: 99,
                },
            ],
        };
        const result = repoChanges(edited, source);
        expect(result.removed).toEqual(['notes.dbml']);
        // notes is now in no Area, so it is written to unassigned.dbml.
        expect(
            result.changes
                .filter((c) => c.kind === 'new')
                .map((c) => [c.path, c.selected])
        ).toEqual([
            [AREA_LAYOUT_FILE, false],
            ['people.dbml', true],
            ['unassigned.dbml', true],
        ]);
    });

    it("after a commit, the committed files are GitHub's and unticked changes stay pending", async () => {
        const { diagram, source } = await open();
        const edited = withFieldType(
            withFieldType(diagram, 'notes', 'body', 'varchar'),
            'users',
            'name',
            'varchar'
        );
        const before = repoChanges(edited, source).changes.filter(
            (c) => c.kind === 'changed'
        );
        expect(before.map((c) => c.path)).toEqual(['notes.dbml', 'users.dbml']);

        const notes = before.find((c) => c.path === 'notes.dbml')!;
        const next = afterCommit(
            source,
            edited,
            [
                {
                    path: notes.path,
                    content: notes.after,
                    sha: 'f'.repeat(40),
                    kind: 'changed',
                },
            ],
            {
                kind: 'committed',
                branch: 'luxdbdiag/schema-abc123',
                commit: '1'.repeat(40),
            }
        );
        expect(next.lastCommit).toBe('1'.repeat(40));
        expect(next.committedFiles).toEqual([
            { path: 'notes.dbml', kind: 'changed' },
        ]);
        expect(next.files.find((f) => f.path === 'notes.dbml')).toMatchObject({
            sha: 'f'.repeat(40),
            content: notes.after,
        });
        const after = repoChanges(edited, next).changes.filter(
            (c) => c.kind === 'changed'
        );
        expect(after.map((c) => c.path)).toEqual(['users.dbml']);
        expect(after[0].expectedSha).toBe('a'.repeat(40));
    });

    it('writes a commit message and pull request description', () => {
        expect(defaultCommitMessage([{ path: 'users.dbml' } as never])).toBe(
            'Update users.dbml from LuxDBDiag'
        );
        expect(
            defaultCommitMessage([
                { path: 'a' } as never,
                { path: 'b' } as never,
            ])
        ).toBe('Update 2 schema files from LuxDBDiag');
        const body = pullRequestBody([
            { path: 'users.dbml', kind: 'changed' },
            { path: 'people.dbml', kind: 'new' },
        ]);
        expect(body).toContain('- Updated `users.dbml`');
        expect(body).toContain('- Added `people.dbml`');
    });
});
