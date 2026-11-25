/**
 * Where diagrams' repository links are kept (LuxDBDiagram).
 *
 * Purpose: one record per diagram linked to a GitHub repository folder (see `repo-source.ts`).
 * Scope: a separate IndexedDB database (`LuxDBDiag`), so ChartDB's own database and its
 * versions are untouched. A record outlives a deleted diagram harmlessly; it is never read again.
 */
import Dexie, { type EntityTable } from 'dexie';
import type { RepoSource } from './repo-source';

const db = new Dexie('LuxDBDiag') as Dexie & {
    repoSources: EntityTable<RepoSource, 'diagramId'>;
};

db.version(1).stores({
    repoSources: 'diagramId',
});

export const getRepoSource = async (
    diagramId: string
): Promise<RepoSource | null> => (await db.repoSources.get(diagramId)) ?? null;

export const saveRepoSource = async (source: RepoSource): Promise<void> => {
    await db.repoSources.put(source);
};

export const deleteRepoSource = async (diagramId: string): Promise<void> => {
    await db.repoSources.delete(diagramId);
};
