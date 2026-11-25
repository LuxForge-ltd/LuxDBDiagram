import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GitHubClient, GitHubStatus } from '@/lib/github/github-client';
import { GitHubRepoPicker } from '../github-repo-picker';

const status = (overrides: Partial<GitHubStatus> = {}): GitHubStatus => ({
    configured: true,
    missing: [],
    signedIn: true,
    login: 'tester',
    installUrl: null,
    branchPrefix: 'luxdbdiag/',
    ...overrides,
});

const fakeClient = (overrides: Partial<GitHubClient> = {}): GitHubClient => ({
    status: vi.fn(async () => status()),
    repositories: vi.fn(async () => [
        {
            fullName: 'LuxForge-ltd/schema',
            defaultBranch: 'main',
            private: true,
            canPush: true,
        },
    ]),
    branches: vi.fn(async () => ({
        defaultBranch: 'main',
        branches: ['Dev', 'main'],
    })),
    folder: vi.fn(async (repo: string, branch: string, folder: string) => ({
        repo,
        branch,
        folder,
        commit: 'c'.repeat(40),
        files: [
            {
                path: 'users.dbml',
                sha: 'a'.repeat(40),
                content: 'Table users { id int }',
            },
        ],
    })),
    commit: vi.fn(),
    pullRequest: vi.fn(),
    signOut: vi.fn(async () => {}),
    ...overrides,
});

describe('opening a GitHub repository folder', () => {
    it('says when the server is not set up, naming the missing settings', async () => {
        const client = fakeClient({
            status: vi.fn(async () =>
                status({
                    configured: false,
                    signedIn: false,
                    missing: ['GITHUB_CLIENT_SECRET'],
                })
            ),
        });
        render(<GitHubRepoPicker onOpen={() => {}} client={client} />);
        expect(
            await screen.findByText('luxdb.github.not_configured')
        ).toBeTruthy();
        expect(client.repositories).not.toHaveBeenCalled();
    });

    it('offers to sign in when signed out', async () => {
        const client = fakeClient({
            status: vi.fn(async () => status({ signedIn: false, login: null })),
        });
        render(<GitHubRepoPicker onOpen={() => {}} client={client} />);
        expect(await screen.findByText('luxdb.github.sign_in')).toBeTruthy();
    });

    it('opens the folder of the only repository on Dev, with its repository link', async () => {
        const onOpen = vi.fn();
        const client = fakeClient();
        render(<GitHubRepoPicker onOpen={onOpen} client={client} />);

        await waitFor(() =>
            expect(client.branches).toHaveBeenCalledWith('LuxForge-ltd/schema')
        );
        const folder = await screen.findByLabelText('luxdb.github.folder');
        fireEvent.change(folder, {
            target: { value: 'docs/architecture/schema' },
        });
        const open = screen.getByText('luxdb.github.open').closest('button')!;
        await waitFor(() => expect(open.disabled).toBe(false));
        fireEvent.click(open);

        await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
        expect(client.folder).toHaveBeenCalledWith(
            'LuxForge-ltd/schema',
            'Dev',
            'docs/architecture/schema'
        );
        const opened = onOpen.mock.calls[0][0];
        expect(opened.name).toBe('schema · Dev');
        expect(opened.files).toEqual([
            { path: 'users.dbml', content: 'Table users { id int }' },
        ]);
        expect(opened.repo).toMatchObject({
            repo: 'LuxForge-ltd/schema',
            branch: 'Dev',
            baseBranch: 'Dev',
            folder: 'docs/architecture/schema',
            files: [{ path: 'users.dbml', sha: 'a'.repeat(40) }],
        });
        expect(opened.repo.workingBranch).toMatch(
            /^luxdbdiag\/schema-[a-z0-9]+$/
        );
    });
});
