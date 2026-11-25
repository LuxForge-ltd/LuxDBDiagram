import { describe, expect, it } from 'vitest';
import {
    chooseBranches,
    repoDiagramName,
    repoFolderLabel,
    suggestedBranch,
    toRepoSource,
} from '../repo-source';

const base = {
    repo: 'LuxForge-ltd/Grassroots-Admin-Portal',
    folder: 'docs/architecture/schema',
    branches: ['Dev', 'main', 'luxdbdiag/schema-abc123'],
    defaultBranch: 'main',
    prefix: 'luxdbdiag/',
    seed: 'k3x9q2',
};

describe('repository links', () => {
    it('targets the branch read from, and names a working branch after the folder', () => {
        expect(chooseBranches({ ...base, branch: 'Dev' })).toEqual({
            baseBranch: 'Dev',
            workingBranch: 'luxdbdiag/schema-k3x9q2',
        });
        expect(chooseBranches({ ...base, branch: 'main', folder: '' })).toEqual(
            {
                baseBranch: 'main',
                workingBranch: 'luxdbdiag/grassroots-admin-portal-k3x9q2',
            }
        );
    });

    it('keeps committing to a working branch it was opened from, targeting Dev', () => {
        expect(
            chooseBranches({ ...base, branch: 'luxdbdiag/schema-abc123' })
        ).toEqual({
            baseBranch: 'Dev',
            workingBranch: 'luxdbdiag/schema-abc123',
        });
        expect(
            chooseBranches({
                ...base,
                branches: ['main'],
                branch: 'luxdbdiag/schema-abc123',
            }).baseBranch
        ).toBe('main');
    });

    it('suggests Dev when the repository has one', () => {
        expect(
            suggestedBranch({
                defaultBranch: 'main',
                branches: ['Dev', 'main'],
            })
        ).toBe('Dev');
        expect(
            suggestedBranch({ defaultBranch: 'main', branches: ['main'] })
        ).toBe('main');
    });

    it('names the diagram and the folder after the repository', () => {
        expect(repoDiagramName(base.repo, base.folder)).toBe(
            'Grassroots-Admin-Portal schema'
        );
        expect(repoDiagramName(base.repo, '')).toBe('Grassroots-Admin-Portal');
        expect(repoFolderLabel({ repo: base.repo, branch: 'Dev' })).toBe(
            'Grassroots-Admin-Portal · Dev'
        );
    });

    it('records which files were imported', () => {
        const source = toRepoSource(
            'diagram-1',
            {
                repo: base.repo,
                branch: 'Dev',
                folder: base.folder,
                commit: 'c'.repeat(40),
                baseBranch: 'Dev',
                workingBranch: 'luxdbdiag/schema-k3x9q2',
                files: [
                    { path: 'users.dbml', sha: 'a'.repeat(40), content: 'x' },
                    {
                        path: 'gap_combined.dbml',
                        sha: 'b'.repeat(40),
                        content: 'y',
                    },
                ],
            },
            ['users.dbml'],
            1000
        );
        expect(source.files.map((file) => [file.path, file.selected])).toEqual([
            ['users.dbml', true],
            ['gap_combined.dbml', false],
        ]);
        expect(source).toMatchObject({
            diagramId: 'diagram-1',
            linkedAt: 1000,
            pullRequestUrl: null,
        });
    });
});
