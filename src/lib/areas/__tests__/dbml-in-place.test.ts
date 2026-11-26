import { describe, expect, it } from 'vitest';
import { importDBMLToDiagram } from '@/lib/dbml/dbml-import/dbml-import';
import { DatabaseType } from '@/lib/domain/database-type';
import { tablesFileText } from '../area-files';
import { inFixedOrder } from '@/lib/github/repo-changes';
import { readsBackAs } from '@/lib/github/repo-in-place';
import { commentLineCount, editDBMLInPlace } from '../dbml-in-place';

// A hand-written file: comments, a Project block, a commented-out draft and inline refs.
const ORIGINAL = `// Schema for tests
Project test {
  database_type: "PostgreSQL"
  Note: "Kept as it is"
}

// People who sign in
Table users {
  user_id bigint [pk, increment] // the id
  // the name shown
  name text [not null]
  email text
}

/* A draft, not yet used:
Table drafts {
  draft_id bigint [pk]
}
*/

Table posts {
  post_id bigint [pk, increment]
  author_id bigint [not null, ref: > users.user_id] // who wrote it
  body text
}
`;

/** What LuxDBDiag writes for a DBML text, and the diagram it reads from it. */
const written = async (dbml: string) => {
    const diagram = await importDBMLToDiagram(dbml, {
        databaseType: DatabaseType.POSTGRESQL,
    });
    const sorted = inFixedOrder(diagram);
    const ids = new Set((sorted.tables ?? []).map((table) => table.id));
    return { diagram, text: tablesFileText(sorted, ids) };
};

/**
 * Saves `ORIGINAL` after the diagram was changed to what `edited` describes, and checks that the
 * result reads back as the changed diagram.
 */
const save = async (edited: string, original = ORIGINAL) => {
    const before = (await written(original)).text;
    const { diagram, text: after } = await written(edited);
    const result = editDBMLInPlace(original, before, after, {
        defaultSchema: 'public',
    });
    if (!result.ok) throw new Error(result.reason);
    expect(await readsBackAs(diagram, result.content, after)).toBeNull();
    return result.content;
};

describe('editing a DBML file in place', () => {
    it('leaves an unchanged file exactly as it is', async () => {
        expect(await save(ORIGINAL)).toBe(ORIGINAL);
    });

    it('rewrites only the line of a column whose type changed', async () => {
        const edited = ORIGINAL.replace(
            '  email text\n',
            '  email varchar(200)\n'
        );
        expect(await save(edited)).toBe(
            ORIGINAL.replace('  email text\n', '  email varchar(200)\n')
        );
    });

    it("keeps a changed column's name as written, its inline ref and its comment", async () => {
        const edited = ORIGINAL.replace(
            'author_id bigint [not null, ref:',
            'author_id int [not null, ref:'
        );
        expect(await save(edited)).toBe(
            ORIGINAL.replace(
                '  author_id bigint [not null, ref: > users.user_id] // who wrote it',
                '  author_id int [not null, ref: > users.user_id] // who wrote it'
            )
        );
    });

    it("adds a new column after the column before it, in the table's style", async () => {
        const edited = ORIGINAL.replace(
            '  email text\n',
            '  email text\n  created_at timestamptz\n'
        );
        expect(await save(edited)).toBe(
            ORIGINAL.replace(
                '  email text\n',
                '  email text\n  created_at timestamptz\n'
            )
        );
    });

    it('rewrites a renamed column where it is, keeping the comment above it', async () => {
        const edited = ORIGINAL.replace(
            '  name text [not null]\n',
            '  display_name text [not null]\n'
        );
        expect(await save(edited)).toBe(edited);
    });

    it('keeps a column deleted and another added in its place apart when they differ', async () => {
        const edited = ORIGINAL.replace(
            '  name text [not null]\n',
            '  nickname varchar(40)\n'
        );
        expect(await save(edited)).toBe(
            ORIGINAL.replace('  name text [not null]\n', '').replace(
                '  user_id bigint [pk, increment] // the id\n',
                '  user_id bigint [pk, increment] // the id\n  nickname varchar(40)\n'
            )
        );
    });

    it("removes a deleted column's line and keeps the comment above it", async () => {
        const edited = ORIGINAL.replace('  name text [not null]\n', '');
        expect(await save(edited)).toBe(
            ORIGINAL.replace('  name text [not null]\n', '')
        );
    });

    it("removes a deleted relationship from its column's settings", async () => {
        const edited = ORIGINAL.replace(', ref: > users.user_id', '');
        expect(await save(edited)).toBe(
            ORIGINAL.replace(', ref: > users.user_id', '')
        );
    });

    it('adds a new relationship as a Ref line at the end', async () => {
        const edited = `${ORIGINAL}\nRef: posts.body - users.email\n`;
        const saved = await save(edited);
        expect(saved.startsWith(ORIGINAL)).toBe(true);
        expect(saved.slice(ORIGINAL.length)).toMatch(
            /^\nRef "[^"]+":"public"\."(posts"\."body" - "public"\."users"\."email|users"\."email" - "public"\."posts"\."body)"\n$/
        );
    });

    it('adds a new table at the end and removes a deleted one', async () => {
        const added = await save(
            `${ORIGINAL}\nTable tags {\n  tag_id bigint [pk]\n}\n`
        );
        expect(added).toBe(
            `${ORIGINAL}\nTable "public"."tags" {\n  "tag_id" bigint [pk, not null]\n}\n`
        );

        const posts = ORIGINAL.slice(ORIGINAL.indexOf('Table posts'));
        const removed = await save(ORIGINAL.replace(posts, ''));
        expect(removed).toBe(ORIGINAL.replace(posts, ''));
        expect(removed).toContain('/* A draft, not yet used:');
    });

    it("adds a table's note before its closing brace", async () => {
        const edited = ORIGINAL.replace(
            '  email text\n}',
            "  email text\n  Note: 'People'\n}"
        );
        expect(await save(edited)).toBe(
            ORIGINAL.replace(
                '  email text\n}',
                "  email text\n  Note: 'People'\n}"
            )
        );
    });

    it('says why when a changed table is not in the file', async () => {
        const before = (await written(ORIGINAL)).text;
        const after = (
            await written(ORIGINAL.replace('  email text\n', '  email int\n'))
        ).text;
        const withoutUsers = ORIGINAL.replace(/\/\/ People[\s\S]*?\n}\n/, '');
        const result = editDBMLInPlace(withoutUsers, before, after, {
            defaultSchema: 'public',
        });
        expect(result).toEqual({
            ok: false,
            reason: 'public.users is not in this file',
        });
    });

    it('counts the lines that hold comments', () => {
        expect(commentLineCount(ORIGINAL)).toBe(10);
        expect(
            commentLineCount("Table t {\n  note text [note: '// no']\n}\n")
        ).toBe(0);
    });
});
