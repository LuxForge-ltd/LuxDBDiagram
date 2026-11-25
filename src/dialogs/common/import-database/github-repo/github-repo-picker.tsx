/**
 * Open a folder of a GitHub repository (LuxDBDiagram).
 *
 * Purpose: the "Open repository…" button of the DBML import editor, shown when the server has
 * the GitHub service. It signs in to GitHub (in its own window), then lists the repositories the
 * LuxDBDiag GitHub App is installed on, their branches, and opens a folder's `.dbml` files in the
 * same panel as "Open folder…". The opened folder carries its repository link, so the new diagram
 * can later save its changes back (see `src/lib/github/repo-source.ts`).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, FolderGit2, Loader2, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/button/button';
import { Input } from '@/components/input/input';
import { Label } from '@/components/label/label';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/popover/popover';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/select/select';
import type { OpenedFolder } from '@/lib/areas/folder-access';
import {
    githubClient,
    signInWithGitHub,
    type GitHubBranches,
    type GitHubClient,
    type GitHubRepository,
    type GitHubStatus,
} from '@/lib/github/github-client';
import {
    chooseBranches,
    repoFolderLabel,
    suggestedBranch,
} from '@/lib/github/repo-source';

const LAST_REPO_KEY = 'luxdb-github-last-repo';
const folderKey = (repo: string) => `luxdb-github-folder:${repo}`;

const remembered = (key: string): string | null => {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
};

const remember = (key: string, value: string) => {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // not kept; the user types it again next time
    }
};

const messageOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

export interface GitHubRepoPickerProps {
    onOpen: (folder: OpenedFolder) => void;
    client?: GitHubClient;
}

export const GitHubRepoPicker: React.FC<GitHubRepoPickerProps> = ({
    onOpen,
    client = githubClient,
}) => {
    const { t } = useTranslation();
    const [status, setStatus] = useState<GitHubStatus | null>(null);
    const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
    const [repo, setRepo] = useState('');
    const [branches, setBranches] = useState<GitHubBranches | null>(null);
    const [branch, setBranch] = useState('');
    const [folder, setFolder] = useState('');
    const [busy, setBusy] = useState<
        'status' | 'signing-in' | 'branches' | 'opening' | null
    >('status');
    const [error, setError] = useState<string | null>(null);
    const signInAbort = useRef<AbortController | null>(null);

    const loadStatus = useCallback(async () => {
        setBusy('status');
        setError(null);
        try {
            const next = await client.status();
            setStatus(next);
            if (next.configured && next.signedIn) {
                const list = await client.repositories();
                setRepositories(list);
                const last = remembered(LAST_REPO_KEY);
                const preferred =
                    list.find((item) => item.fullName === last) ??
                    (list.length === 1 ? list[0] : undefined);
                setRepo(preferred?.fullName ?? '');
            }
        } catch (caught) {
            setError(messageOf(caught));
        } finally {
            setBusy(null);
        }
    }, [client]);

    useEffect(() => {
        void loadStatus();
        return () => signInAbort.current?.abort();
    }, [loadStatus]);

    useEffect(() => {
        if (!repo) {
            setBranches(null);
            return;
        }
        let current = true;
        setBusy('branches');
        setError(null);
        setFolder(remembered(folderKey(repo)) ?? '');
        client
            .branches(repo)
            .then((result) => {
                if (!current) return;
                setBranches(result);
                setBranch(suggestedBranch(result));
            })
            .catch((caught) => current && setError(messageOf(caught)))
            .finally(() => current && setBusy(null));
        return () => {
            current = false;
        };
    }, [client, repo]);

    const signIn = useCallback(async () => {
        signInAbort.current = new AbortController();
        setBusy('signing-in');
        await signInWithGitHub(client, signInAbort.current.signal);
        await loadStatus();
    }, [client, loadStatus]);

    const signOut = useCallback(async () => {
        try {
            await client.signOut();
        } finally {
            setRepositories([]);
            setRepo('');
            await loadStatus();
        }
    }, [client, loadStatus]);

    const openFolder = useCallback(async () => {
        if (!status || !repo || !branch || !branches) return;
        setBusy('opening');
        setError(null);
        try {
            const result = await client.folder(repo, branch, folder);
            if (result.files.length === 0) {
                setError(t('luxdb.github.folder_empty'));
                return;
            }
            remember(LAST_REPO_KEY, repo);
            remember(folderKey(repo), result.folder);
            const chosen = chooseBranches({
                repo,
                branch,
                folder: result.folder,
                branches: branches.branches,
                defaultBranch: branches.defaultBranch,
                prefix: status.branchPrefix,
                seed: Math.random().toString(36).slice(2, 8),
            });
            onOpen({
                name: repoFolderLabel({ repo, branch }),
                files: result.files.map(({ path, content }) => ({
                    path,
                    content,
                })),
                repo: {
                    repo,
                    branch,
                    folder: result.folder,
                    commit: result.commit,
                    ...chosen,
                    files: result.files,
                },
            });
        } catch (caught) {
            setError(messageOf(caught));
        } finally {
            setBusy(null);
        }
    }, [branch, branches, client, folder, onOpen, repo, status, t]);

    if (busy === 'status' && !status) {
        return (
            <div className="flex items-center gap-2 p-1">
                <Loader2 className="size-3.5 animate-spin" />
                {t('luxdb.github.checking')}
            </div>
        );
    }

    if (!status) {
        return (
            <p className="p-1 text-red-700 dark:text-red-400">
                {error ?? t('luxdb.github.unavailable')}
            </p>
        );
    }

    if (!status.configured) {
        return (
            <div className="flex flex-col gap-1 p-1">
                <p>{t('luxdb.github.not_configured')}</p>
                {status.missing.length > 0 ? (
                    <p className="text-muted-foreground">
                        {t('luxdb.github.missing', {
                            settings: status.missing.join(', '),
                        })}
                    </p>
                ) : null}
            </div>
        );
    }

    if (!status.signedIn) {
        return (
            <div className="flex flex-col gap-2 p-1">
                <p>{t('luxdb.github.sign_in_hint')}</p>
                {busy === 'signing-in' ? (
                    <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                            <Loader2 className="size-3.5 animate-spin" />
                            {t('luxdb.github.signing_in')}
                        </span>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => signInAbort.current?.abort()}
                        >
                            {t('luxdb.common.cancel')}
                        </Button>
                    </div>
                ) : (
                    <Button
                        type="button"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={() => void signIn()}
                    >
                        <LogIn className="size-3.5" />
                        {t('luxdb.github.sign_in')}
                    </Button>
                )}
                {error ? (
                    <p className="text-red-700 dark:text-red-400">{error}</p>
                ) : null}
            </div>
        );
    }

    const selected = repositories.find((item) => item.fullName === repo);

    return (
        <div
            className="flex flex-col gap-2 p-1"
            data-testid="github-repo-picker"
        >
            <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="truncate">
                    {t('luxdb.github.signed_in_as', { login: status.login })}
                </span>
                <button
                    type="button"
                    className="shrink-0 underline-offset-2 hover:underline"
                    onClick={() => void signOut()}
                >
                    {t('luxdb.github.sign_out')}
                </button>
            </div>

            {repositories.length === 0 ? (
                <p>{t('luxdb.github.no_repositories')}</p>
            ) : (
                <div className="flex flex-col gap-1">
                    <Label className="text-xs">
                        {t('luxdb.github.repository')}
                    </Label>
                    <Select value={repo} onValueChange={setRepo}>
                        <SelectTrigger className="h-7 text-xs">
                            <SelectValue
                                placeholder={t(
                                    'luxdb.github.choose_repository'
                                )}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {repositories.map((item) => (
                                <SelectItem
                                    key={item.fullName}
                                    value={item.fullName}
                                    className="text-xs"
                                >
                                    {item.fullName}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {selected && !selected.canPush ? (
                        <p className="text-amber-700 dark:text-amber-400">
                            {t('luxdb.github.read_only')}
                        </p>
                    ) : null}
                </div>
            )}

            {status.installUrl ? (
                <a
                    href={status.installUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-muted-foreground underline-offset-2 hover:underline"
                >
                    <ExternalLink className="size-3" />
                    {t('luxdb.github.install_more')}
                </a>
            ) : null}

            {repo && branches ? (
                <>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">
                            {t('luxdb.github.branch')}
                        </Label>
                        <Select value={branch} onValueChange={setBranch}>
                            <SelectTrigger className="h-7 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.branches.map((name) => (
                                    <SelectItem
                                        key={name}
                                        value={name}
                                        className="text-xs"
                                    >
                                        {name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label
                            className="text-xs"
                            htmlFor="luxdb-github-folder"
                        >
                            {t('luxdb.github.folder')}
                        </Label>
                        <Input
                            id="luxdb-github-folder"
                            className="h-7 text-xs"
                            value={folder}
                            placeholder="docs/architecture/schema"
                            onChange={(event) => setFolder(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') void openFolder();
                            }}
                        />
                    </div>
                </>
            ) : null}

            {error ? (
                <p className="text-red-700 dark:text-red-400">{error}</p>
            ) : null}

            <Button
                type="button"
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={!repo || !branch || busy !== null}
                onClick={() => void openFolder()}
            >
                {busy === 'opening' || busy === 'branches' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                ) : (
                    <FolderGit2 className="size-3.5" />
                )}
                {t('luxdb.github.open')}
            </Button>
        </div>
    );
};

export interface GitHubRepoButtonProps {
    onOpen: (folder: OpenedFolder) => void;
}

export const GitHubRepoButton: React.FC<GitHubRepoButtonProps> = ({
    onOpen,
}) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const handleOpen = useCallback(
        (folder: OpenedFolder) => {
            setOpen(false);
            onOpen(folder);
        },
        [onOpen]
    );

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs"
                    title={t('luxdb.github.open_repository_title')}
                >
                    <FolderGit2 className="size-3.5" />
                    {t('luxdb.github.open_repository')}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-2 text-xs">
                {open ? <GitHubRepoPicker onOpen={handleOpen} /> : null}
            </PopoverContent>
        </Popover>
    );
};
