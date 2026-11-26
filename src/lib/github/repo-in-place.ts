/**
 * Saving changed files in place (LuxDBDiagram).
 *
 * Purpose: turns each changed file found by `repoChanges` into its own text with only the
 * diagram's changes applied (`src/lib/areas/dbml-in-place.ts`), so saving keeps the file's
 * comments, Project block, commented-out drafts and layout.
 * Safety: each edited file is imported again and must read back as the tables, enums and
 * relationships LuxDBDiag would write for it. A file that cannot be edited in place, or does not
 * read back, is rewritten whole by the exporter as before: it starts unticked, and the dialog says
 * why and how many lines with comments the rewrite drops.
 */
import type { Diagram } from '@/lib/domain/diagram';
import { defaultSchemas } from '@/lib/data/default-schemas';
import { importDBMLToDiagram } from '@/lib/dbml/dbml-import/dbml-import';
import { generateDBMLFromDiagram } from '@/lib/dbml/dbml-export/dbml-export';
import { tablesFileText } from '@/lib/areas/area-files';
import {
    commentLineCount,
    compareWrittenDBML,
    editDBMLInPlace,
    writtenDBMLKeys,
} from '@/lib/areas/dbml-in-place';
import {
    inFixedOrder,
    repoChanges,
    type RepoChanges,
    type RepoFileChange,
} from './repo-changes';
import type { RepoSource } from './repo-source';

const tableKey = (
    table: { schema?: string | null; name: string },
    defaultSchema: string
) => `${table.schema || defaultSchema}.${table.name}`.toLowerCase();

/**
 * A file's own text and what LuxDBDiag wrote for it when it was read: GitHub's text, or the text
 * as imported for a file edited before importing. Null when LuxDBDiag has no record of either.
 */
export const startingText = (
    source: RepoSource,
    path: string
): { original: string; before: string } | null => {
    const edited = source.editedFiles?.[path];
    if (edited) return { original: edited.text, before: edited.generated };
    const baseline = source.generated?.[path];
    const file = source.files.find((candidate) => candidate.path === path);
    if (file && typeof baseline === 'string') {
        return { original: file.content, before: baseline };
    }
    return null;
};

/**
 * Whether `content` reads back as `expected`, the text LuxDBDiag writes for the file. Tables in
 * other files that the file's relationships point to, and relationships and enums written only in
 * other files, are taken from the diagram, so the file can be read on its own.
 *
 * @returns null when it does, otherwise what differs.
 */
export const readsBackAs = async (
    diagram: Diagram,
    content: string,
    expected: string
): Promise<string | null> => {
    const defaultSchema = defaultSchemas[diagram.databaseType] ?? '';
    const mine = writtenDBMLKeys(content, { defaultSchema });
    const wanted = writtenDBMLKeys(expected, { defaultSchema });
    if (!mine || !wanted) return 'the file could not be read';

    const myTables = new Set(mine.tables);
    const wantedTables = new Set(wanted.tables);
    const myRefs = new Set(mine.refs.map((ref) => ref.key));
    const myEnums = new Set(mine.enums);
    const partnerKeys = new Set(
        wanted.refs
            .flatMap((ref) =>
                ref.ends.map((end) => end.split('.').slice(0, 2).join('.'))
            )
            .filter((key) => !wantedTables.has(key) && !myTables.has(key))
    );
    const partners = (diagram.tables ?? []).filter((table) =>
        partnerKeys.has(tableKey(table, defaultSchema))
    );
    const stubs =
        partners.length > 0
            ? generateDBMLFromDiagram({
                  ...diagram,
                  tables: partners,
                  relationships: [],
                  customTypes: [],
                  areas: [],
                  notes: [],
                  areaViews: [],
              })
            : null;
    if (stubs?.error) return stubs.error;

    const text = [
        content,
        stubs?.standardDbml ?? '',
        ...wanted.enumBlocks
            .filter((item) => !myEnums.has(item.key))
            .map((item) => item.text),
        ...wanted.refs
            .filter((ref) => !myRefs.has(ref.key))
            .map((ref) => ref.text),
    ].join('\n\n');

    let read: Diagram;
    try {
        read = await importDBMLToDiagram(text, {
            databaseType: diagram.databaseType,
        });
    } catch (error) {
        return error instanceof Error && error.message
            ? error.message
            : 'the file could not be imported';
    }
    const ids = new Set(
        (read.tables ?? [])
            .filter((table) => wantedTables.has(tableKey(table, defaultSchema)))
            .map((table) => table.id)
    );
    if (ids.size !== wantedTables.size) return 'a table is missing';
    return compareWrittenDBML(
        tablesFileText(inFixedOrder(read), ids),
        expected,
        { defaultSchema }
    );
};

/**
 * Edits each changed table file in place, falling back to the exporter's rewrite for a file that
 * cannot be edited in place or does not read back as the diagram.
 */
export const editChangesInPlace = async (
    diagram: Diagram,
    source: RepoSource,
    analysis: RepoChanges
): Promise<RepoChanges> => {
    const defaultSchema = defaultSchemas[diagram.databaseType] ?? '';
    const changes: RepoFileChange[] = [];
    const unchanged = [...analysis.unchanged];

    for (const change of analysis.changes) {
        if (change.kind !== 'changed' || change.role === 'layout') {
            changes.push(change);
            continue;
        }
        const rewritten = (reason: string): RepoFileChange => ({
            ...change,
            method: 'rewritten',
            rewriteReason: reason,
            lostCommentLines: commentLineCount(change.before ?? ''),
            selected: false,
        });

        const start = startingText(source, change.path);
        if (!start) {
            changes.push(
                rewritten('LuxDBDiag has no record of how it read this file')
            );
            continue;
        }
        const edited = editDBMLInPlace(
            start.original,
            start.before,
            change.after,
            { defaultSchema }
        );
        if (!edited.ok) {
            changes.push(rewritten(edited.reason));
            continue;
        }
        const problem = await readsBackAs(
            diagram,
            edited.content,
            change.after
        );
        if (problem) {
            changes.push(
                rewritten(
                    `the edited file did not read back as the diagram: ${problem}`
                )
            );
            continue;
        }
        if (edited.content === change.before) {
            unchanged.push(change.path);
            continue;
        }
        changes.push({ ...change, after: edited.content, method: 'in-place' });
    }

    return {
        ...analysis,
        changes,
        unchanged: unchanged.sort((a, b) => a.localeCompare(b)),
    };
};

/** What saving would change, with changed files edited in place where possible. */
export const analyzeRepoChanges = (
    diagram: Diagram,
    source: RepoSource
): Promise<RepoChanges> =>
    editChangesInPlace(diagram, source, repoChanges(diagram, source));
