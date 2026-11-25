/**
 * The open diagram's link to a GitHub repository folder, if it has one (LuxDBDiagram).
 *
 * Purpose: loads the link (see `src/lib/github/repo-source.ts`) when the diagram changes and
 * keeps it after a commit or pull request. Nothing is loaded when the server has no GitHub
 * service.
 */
import { useCallback, useEffect, useState } from 'react';
import { useChartDB } from '@/hooks/use-chartdb';
import { isGitHubAvailable } from '@/lib/github/github-client';
import type { RepoSource } from '@/lib/github/repo-source';
import { getRepoSource, saveRepoSource } from '@/lib/github/repo-source-store';

export const useRepositoryLink = () => {
    const { diagramId } = useChartDB();
    const [source, setSource] = useState<RepoSource | null>(null);

    useEffect(() => {
        setSource(null);
        if (!diagramId || !isGitHubAvailable()) return;
        let current = true;
        getRepoSource(diagramId)
            .then((found) => current && setSource(found))
            .catch(() => current && setSource(null));
        return () => {
            current = false;
        };
    }, [diagramId]);

    const update = useCallback(async (next: RepoSource) => {
        await saveRepoSource(next);
        setSource(next);
    }, []);

    return { source, update };
};
