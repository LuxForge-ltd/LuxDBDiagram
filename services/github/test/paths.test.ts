// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
    isBranchName,
    isFolderFilePath,
    isWorkingBranch,
    normalizeFolder,
    parseRepo,
} from '../src/paths.ts';

describe('repository names', () => {
    it('accepts owner/name and rejects anything else', () => {
        expect(parseRepo('LuxForge-ltd/Grassroots-Admin-Portal')).toEqual({
            owner: 'LuxForge-ltd',
            name: 'Grassroots-Admin-Portal',
            fullName: 'LuxForge-ltd/Grassroots-Admin-Portal',
        });
        for (const bad of [
            'LuxForge-ltd',
            'a/b/c',
            '../x',
            'a/..',
            'a b/c',
            'owner/na me',
            '',
            7,
        ]) {
            expect(parseRepo(bad)).toBeNull();
        }
    });
});

describe('branch names', () => {
    it('follows git ref rules', () => {
        for (const good of [
            'Dev',
            'main',
            'luxdbdiag/gap-schema',
            'feature/a.b',
        ]) {
            expect(isBranchName(good)).toBe(true);
        }
        for (const bad of [
            '',
            'a..b',
            'a b',
            'a~1',
            'a^',
            'a:b',
            '/a',
            'a/',
            'a//b',
            'a.lock',
            '.a',
            'a/.b',
            '@',
            'a@{1}',
            '-x',
            'a\\b',
        ]) {
            expect(isBranchName(bad)).toBe(false);
        }
    });

    it('allows writes only under the working-branch prefix', () => {
        expect(isWorkingBranch('luxdbdiag/gap', 'luxdbdiag/')).toBe(true);
        expect(isWorkingBranch('luxdbdiag/', 'luxdbdiag/')).toBe(false);
        expect(isWorkingBranch('Dev', 'luxdbdiag/')).toBe(false);
        expect(isWorkingBranch('main', 'luxdbdiag/')).toBe(false);
        expect(isWorkingBranch('luxdbdiag/../main', 'luxdbdiag/')).toBe(false);
    });
});

describe('folders and file paths', () => {
    it('normalises folders and refuses ones that leave the repository', () => {
        expect(normalizeFolder(undefined)).toBe('');
        expect(normalizeFolder('/docs/architecture/schema/')).toBe(
            'docs/architecture/schema'
        );
        expect(normalizeFolder('docs/../secrets')).toBeNull();
        expect(normalizeFolder('docs\\schema')).toBeNull();
    });

    it('accepts the same DBML files as the folder reader', () => {
        expect(isFolderFilePath('users.dbml')).toBe(true);
        expect(isFolderFilePath('domain/a/b/c/matches.DBML')).toBe(true);
        expect(isFolderFilePath('a/b/c/d/e/too-deep.dbml')).toBe(false);
        expect(isFolderFilePath('users.sql')).toBe(false);
        expect(isFolderFilePath('.github/x.dbml')).toBe(false);
        expect(isFolderFilePath('node_modules/x.dbml')).toBe(false);
        expect(isFolderFilePath('../x.dbml')).toBe(false);
        expect(isFolderFilePath('/x.dbml')).toBe(false);
        expect(isFolderFilePath('a//x.dbml')).toBe(false);
    });
});
