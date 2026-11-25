// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
    commitFiles,
    createGitHubApi,
    createPullRequest,
    gitBlobSha,
    listBranches,
    listRepositories,
    readFolder,
} from '../src/github.ts';
import { parseRepo } from '../src/paths.ts';
import { REPO, createFakeGitHub } from './fake-github.ts';

const repo = parseRepo(REPO)!;
const FOLDER = 'docs/architecture/schema';

const setup = () => {
    const github = createFakeGitHub({
        'README.md': '# schema',
        [`${FOLDER}/users.dbml`]: 'Table users { id int }\n',
        [`${FOLDER}/domain/matches.dbml`]:
            '// matches\nTable matches { id int }\n',
        [`${FOLDER}/notes.txt`]: 'not dbml',
        [`${FOLDER}/node_modules/x.dbml`]: 'Table x { id int }',
        [`${FOLDER}/.hidden/y.dbml`]: 'Table y { id int }',
        'other/z.dbml': 'Table z { id int }',
    });
    github.allowToken('token');
    return { github, api: createGitHubApi('token', github.fetch) };
};

describe('reading a repository', () => {
    it('matches git blob SHAs', () => {
        // `printf 'hello\n' | git hash-object --stdin`
        expect(gitBlobSha('hello\n')).toBe(
            'ce013625030ba8dba906f756967f9e9ca394464a'
        );
    });

    it('lists the repositories the App is installed on, and their branches', async () => {
        const { api } = setup();
        await expect(listRepositories(api)).resolves.toEqual([
            {
                fullName: REPO,
                defaultBranch: 'main',
                private: true,
                canPush: true,
            },
        ]);
        await expect(listBranches(api, repo)).resolves.toEqual({
            defaultBranch: 'main',
            branches: ['Dev', 'main'],
        });
    });

    it('reads the DBML files of a folder, skipping what the folder reader skips', async () => {
        const { api } = setup();
        const folder = await readFolder(api, repo, 'Dev', FOLDER);
        expect(folder.files.map((file) => file.path)).toEqual([
            'domain/matches.dbml',
            'users.dbml',
        ]);
        expect(folder.files[0]).toMatchObject({
            content: '// matches\nTable matches { id int }\n',
            sha: gitBlobSha('// matches\nTable matches { id int }\n'),
        });
        expect(folder.commit).toMatch(/^[0-9a-f]{40}$/);
    });

    it('says when the branch or folder does not exist', async () => {
        const { api } = setup();
        await expect(readFolder(api, repo, 'nope', FOLDER)).rejects.toThrow(
            'branch nope does not exist'
        );
        await expect(
            readFolder(api, repo, 'Dev', 'docs/missing')
        ).rejects.toThrow('folder docs/missing does not exist');
    });
});

describe('committing to a working branch', () => {
    const usersSha = gitBlobSha('Table users { id int }\n');
    const matchesSha = gitBlobSha('// matches\nTable matches { id int }\n');

    it('creates the branch from the base branch with only the changed files', async () => {
        const { github, api } = setup();
        const result = await commitFiles(api, {
            repo,
            folder: FOLDER,
            baseBranch: 'Dev',
            branch: 'luxdbdiag/gap',
            message: 'Add email to users',
            files: [
                {
                    path: 'users.dbml',
                    content: 'Table users { id int\n email text }\n',
                    expectedSha: usersSha,
                },
                {
                    path: 'domain/matches.dbml',
                    content: '// matches\nTable matches { id int }\n',
                    expectedSha: matchesSha,
                },
                {
                    path: 'teams.dbml',
                    content: 'Table teams { id int }\n',
                    expectedSha: null,
                },
            ],
        });
        expect(result).toMatchObject({
            kind: 'committed',
            branch: 'luxdbdiag/gap',
            createdBranch: true,
        });
        const files = github.branchFiles('luxdbdiag/gap');
        expect(files[`${FOLDER}/users.dbml`]).toBe(
            'Table users { id int\n email text }\n'
        );
        expect(files[`${FOLDER}/teams.dbml`]).toBe('Table teams { id int }\n');
        expect(files[`${FOLDER}/domain/matches.dbml`]).toBe(
            '// matches\nTable matches { id int }\n'
        );
        expect(files['README.md']).toBe('# schema');
        expect(github.branchFiles('Dev')[`${FOLDER}/users.dbml`]).toBe(
            'Table users { id int }\n'
        );
        const posted = github.calls.filter(
            (call) => call === `POST /repos/${REPO}/git/trees`
        );
        expect(posted).toHaveLength(1);
    });

    it('adds later commits to the same branch by fast-forward', async () => {
        const { github, api } = setup();
        const first = await commitFiles(api, {
            repo,
            folder: FOLDER,
            baseBranch: 'Dev',
            branch: 'luxdbdiag/gap',
            message: 'one',
            files: [
                {
                    path: 'users.dbml',
                    content: 'Table users { id bigint }\n',
                    expectedSha: usersSha,
                },
            ],
        });
        if (first.kind === 'conflict') throw new Error('unexpected conflict');
        const second = await commitFiles(api, {
            repo,
            folder: FOLDER,
            baseBranch: 'Dev',
            branch: 'luxdbdiag/gap',
            message: 'two',
            files: [
                {
                    path: 'users.dbml',
                    content: 'Table users { id uuid }\n',
                    expectedSha: first.files[0].sha,
                },
            ],
        });
        expect(second).toMatchObject({
            kind: 'committed',
            createdBranch: false,
        });
        expect(
            github.branchFiles('luxdbdiag/gap')[`${FOLDER}/users.dbml`]
        ).toBe('Table users { id uuid }\n');
    });

    it('commits nothing when nothing changed', async () => {
        const { github, api } = setup();
        const result = await commitFiles(api, {
            repo,
            folder: FOLDER,
            baseBranch: 'Dev',
            branch: 'luxdbdiag/gap',
            message: 'noop',
            files: [
                {
                    path: 'users.dbml',
                    content: 'Table users { id int }\n',
                    expectedSha: usersSha,
                },
            ],
        });
        expect(result).toMatchObject({
            kind: 'unchanged',
            createdBranch: false,
        });
        expect(github.refs.has('luxdbdiag/gap')).toBe(false);
    });

    it('stops when a file changed on GitHub since it was read', async () => {
        const { github, api } = setup();
        github.pushToBranch('Dev', {
            [`${FOLDER}/users.dbml`]: 'Table users { id int\n name text }\n',
        });
        const result = await commitFiles(api, {
            repo,
            folder: FOLDER,
            baseBranch: 'Dev',
            branch: 'luxdbdiag/gap',
            message: 'mine',
            files: [
                {
                    path: 'users.dbml',
                    content: 'Table users { id bigint }\n',
                    expectedSha: usersSha,
                },
            ],
        });
        expect(result).toEqual({
            kind: 'conflict',
            reason: 'files_changed',
            conflicts: [
                {
                    path: 'users.dbml',
                    expectedSha: usersSha,
                    actualSha: gitBlobSha(
                        'Table users { id int\n name text }\n'
                    ),
                },
            ],
        });
        expect(github.refs.has('luxdbdiag/gap')).toBe(false);
    });

    it('does not count a file as a conflict when GitHub already has the same text', async () => {
        const { github, api } = setup();
        github.pushToBranch('Dev', {
            [`${FOLDER}/users.dbml`]: 'Table users { id bigint }\n',
        });
        const result = await commitFiles(api, {
            repo,
            folder: FOLDER,
            baseBranch: 'Dev',
            branch: 'luxdbdiag/gap',
            message: 'same',
            files: [
                {
                    path: 'users.dbml',
                    content: 'Table users { id bigint }\n',
                    expectedSha: usersSha,
                },
            ],
        });
        expect(result.kind).toBe('unchanged');
    });
});

describe('pull requests', () => {
    it('opens one, and finds it again instead of failing', async () => {
        const { api } = setup();
        const request = {
            repo,
            branch: 'luxdbdiag/gap',
            base: 'Dev',
            title: 'Schema changes',
            body: '',
        };
        await expect(createPullRequest(api, request)).resolves.toEqual({
            url: `https://github.com/${REPO}/pull/1`,
            number: 1,
            existing: false,
        });
        await expect(createPullRequest(api, request)).resolves.toMatchObject({
            number: 1,
            existing: true,
        });
    });
});
