/**
 * Save to repository (LuxDBDiagram).
 *
 * Purpose: for a diagram opened from a GitHub repository folder, shows which of its files changed
 * (see `src/lib/github/repo-changes.ts`), each as a side-by-side diff with GitHub's copy, and
 * commits the ticked files to the diagram's working branch in one commit. Then opens, or shows,
 * the pull request into the branch the files came from.
 * Scope: unchanged files are never written. Files of Areas that were deleted are listed, never
 * deleted. A file changed on GitHub since it was read stops the commit and is named.
 */
import React, {
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlertTriangle,
    CheckCircle2,
    ExternalLink,
    GitPullRequest,
    Loader2,
    LogIn,
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/dialog/dialog';
import { Button } from '@/components/button/button';
import { Checkbox } from '@/components/checkbox/checkbox';
import { Input } from '@/components/input/input';
import { Label } from '@/components/label/label';
import { Spinner } from '@/components/spinner/spinner';
import { DiffEditor } from '@/components/code-snippet/code-snippet';
import { setupDBMLLanguage } from '@/components/code-snippet/languages/dbml-language';
import { useChartDB } from '@/hooks/use-chartdb';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';
import {
    GitHubServiceError,
    githubClient,
    signInWithGitHub,
    type GitHubClient,
    type GitHubConflict,
} from '@/lib/github/github-client';
import {
    afterCommit,
    defaultCommitMessage,
    pullRequestBody,
    repoChanges,
} from '@/lib/github/repo-changes';
import {
    WORKING_BRANCH_PREFIX,
    isWorkingBranchName,
    type RepoSource,
} from '@/lib/github/repo-source';

export interface SaveToRepositoryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    source: RepoSource;
    onSourceChange: (source: RepoSource) => Promise<void>;
    client?: GitHubClient;
}

type Outcome =
    | { kind: 'committed'; branch: string; count: number }
    | { kind: 'unchanged'; branch: string }
    | { kind: 'conflict'; conflicts: GitHubConflict[] }
    | { kind: 'branch_moved' };

const BRANCH_PREFIX = WORKING_BRANCH_PREFIX;

export const SaveToRepositoryDialog: React.FC<SaveToRepositoryDialogProps> = ({
    open,
    onOpenChange,
    source,
    onSourceChange,
    client = githubClient,
}) => {
    const { t } = useTranslation();
    const { currentDiagram } = useChartDB();
    const { effectiveTheme } = useTheme();

    const [analysis, setAnalysis] = useState<ReturnType<
        typeof repoChanges
    > | null>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [activePath, setActivePath] = useState<string | null>(null);
    const [branch, setBranch] = useState(source.workingBranch);
    const [message, setMessage] = useState('');
    const [messageEdited, setMessageEdited] = useState(false);
    const [busy, setBusy] = useState<'commit' | 'pull' | 'sign-in' | null>(
        null
    );
    const [error, setError] = useState<string | null>(null);
    const [signedOut, setSignedOut] = useState(false);
    const [outcome, setOutcome] = useState<Outcome | null>(null);

    // Work out the changes each time the dialog opens.
    useEffect(() => {
        if (!open) return;
        setOutcome(null);
        setError(null);
        setSignedOut(false);
        setMessageEdited(false);
        setBranch(source.workingBranch);
        try {
            const result = repoChanges(currentDiagram, source);
            setAnalysis(result);
            setAnalysisError(null);
            setSelected(
                Object.fromEntries(
                    result.changes.map((change) => [
                        change.path,
                        change.selected,
                    ])
                )
            );
            setActivePath(result.changes[0]?.path ?? null);
            setMessage(
                defaultCommitMessage(
                    result.changes.filter((change) => change.selected)
                )
            );
        } catch (caught) {
            setAnalysis(null);
            setAnalysisError(
                caught instanceof Error ? caught.message : String(caught)
            );
        }
        // Only when the dialog opens: the diagram does not change while it is open.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const ticked = useMemo(
        () => analysis?.changes.filter((change) => selected[change.path]) ?? [],
        [analysis, selected]
    );
    // The suggested message follows the ticked files until the user writes their own.
    useEffect(() => {
        if (!messageEdited && ticked.length > 0) {
            setMessage(defaultCommitMessage(ticked));
        }
    }, [messageEdited, ticked]);
    const active = analysis?.changes.find(
        (change) => change.path === activePath
    );
    const branchValid = isWorkingBranchName(branch, BRANCH_PREFIX);

    const handleError = useCallback((caught: unknown) => {
        if (caught instanceof GitHubServiceError && caught.status === 401) {
            setSignedOut(true);
            setError(null);
            return;
        }
        setError(caught instanceof Error ? caught.message : String(caught));
    }, []);

    const signIn = useCallback(async () => {
        setBusy('sign-in');
        const signedIn = await signInWithGitHub(client);
        setBusy(null);
        if (signedIn) setSignedOut(false);
    }, [client]);

    const commit = useCallback(async () => {
        if (!analysis || ticked.length === 0 || !branchValid) return;
        setBusy('commit');
        setError(null);
        setOutcome(null);
        try {
            const result = await client.commit({
                repo: source.repo,
                folder: source.folder,
                baseBranch: source.baseBranch,
                branch,
                message: message.trim() || defaultCommitMessage(ticked),
                files: ticked.map((change) => ({
                    path: change.path,
                    content: change.after,
                    expectedSha: change.expectedSha,
                })),
            });
            if (result.kind === 'conflict') {
                setOutcome(
                    result.reason === 'branch_moved'
                        ? { kind: 'branch_moved' }
                        : { kind: 'conflict', conflicts: result.conflicts }
                );
                return;
            }
            const shas = new Map(
                result.files.map((file) => [file.path, file.sha])
            );
            const next = afterCommit(
                source,
                currentDiagram,
                ticked.map((change) => ({
                    path: change.path,
                    content: change.after,
                    sha: shas.get(change.path) ?? change.expectedSha ?? '',
                    kind: change.kind,
                })),
                result
            );
            await onSourceChange(next);
            setOutcome(
                result.kind === 'unchanged'
                    ? { kind: 'unchanged', branch: result.branch }
                    : {
                          kind: 'committed',
                          branch: result.branch,
                          count: ticked.length,
                      }
            );
            const remaining = repoChanges(currentDiagram, next);
            setAnalysis(remaining);
            setActivePath(remaining.changes[0]?.path ?? null);
            setSelected(
                Object.fromEntries(
                    remaining.changes.map((change) => [
                        change.path,
                        change.selected,
                    ])
                )
            );
            setMessage(
                defaultCommitMessage(
                    remaining.changes.filter((change) => change.selected)
                )
            );
        } catch (caught) {
            handleError(caught);
        } finally {
            setBusy(null);
        }
    }, [
        analysis,
        branch,
        branchValid,
        client,
        currentDiagram,
        handleError,
        message,
        onSourceChange,
        source,
        ticked,
    ]);

    const openPullRequest = useCallback(async () => {
        setBusy('pull');
        setError(null);
        try {
            const pull = await client.pullRequest({
                repo: source.repo,
                branch: source.workingBranch,
                base: source.baseBranch,
                title: t('luxdb.github.save.pull_request_title', {
                    folder: source.folder || source.repo,
                }),
                body: pullRequestBody(source.committedFiles ?? []),
            });
            await onSourceChange({ ...source, pullRequestUrl: pull.url });
            window.open(pull.url, '_blank', 'noopener');
        } catch (caught) {
            handleError(caught);
        } finally {
            setBusy(null);
        }
    }, [client, handleError, onSourceChange, source, t]);

    // A pull request can be opened once LuxDBDiag has committed to the working branch.
    const hasCommitted = Boolean(source.lastCommit);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex max-h-dvh w-full flex-col gap-3 md:max-w-[1100px]"
                showClose
            >
                <DialogHeader>
                    <DialogTitle>{t('luxdb.github.save.title')}</DialogTitle>
                    <DialogDescription>
                        {t('luxdb.github.save.description', {
                            repo: source.repo,
                            folder: source.folder || '/',
                            base: source.baseBranch,
                        })}
                    </DialogDescription>
                </DialogHeader>

                {analysisError ? (
                    <p className="text-sm text-red-700 dark:text-red-400">
                        {t('luxdb.github.save.analysis_failed', {
                            error: analysisError,
                        })}
                    </p>
                ) : !analysis ? (
                    <Spinner />
                ) : analysis.changes.length === 0 ? (
                    <p className="text-sm">
                        {t('luxdb.github.save.nothing_to_save')}
                    </p>
                ) : (
                    <div className="flex min-h-0 flex-1 gap-2 overflow-hidden text-xs">
                        <div
                            className="flex w-64 shrink-0 flex-col gap-0.5 overflow-y-auto border-r pr-1"
                            data-testid="save-to-repository-files"
                        >
                            {analysis.changes.map((change) => (
                                <div
                                    key={change.path}
                                    className={cn(
                                        'flex items-center gap-1 rounded px-1 py-1 hover:bg-accent',
                                        activePath === change.path &&
                                            'bg-pink-100 text-pink-900 dark:bg-pink-950 dark:text-pink-100'
                                    )}
                                >
                                    <Checkbox
                                        checked={Boolean(selected[change.path])}
                                        onCheckedChange={(checked) =>
                                            setSelected((current) => ({
                                                ...current,
                                                [change.path]: checked === true,
                                            }))
                                        }
                                        aria-label={t(
                                            'luxdb.github.save.include',
                                            { file: change.path }
                                        )}
                                    />
                                    <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-1 text-left"
                                        onClick={() =>
                                            setActivePath(change.path)
                                        }
                                    >
                                        <span className="flex-1 truncate">
                                            {change.path}
                                        </span>
                                        <span className="shrink-0 text-muted-foreground">
                                            {change.kind === 'new'
                                                ? t('luxdb.github.save.new')
                                                : t(
                                                      'luxdb.github.save.changed'
                                                  )}
                                        </span>
                                    </button>
                                </div>
                            ))}
                            <div className="mt-2 flex flex-col gap-1 px-1 text-muted-foreground">
                                {analysis.unchanged.length > 0 ? (
                                    <p>
                                        {t('luxdb.github.save.unchanged', {
                                            count: analysis.unchanged.length,
                                        })}
                                    </p>
                                ) : null}
                                {analysis.removed.length > 0 ? (
                                    <p>
                                        {t('luxdb.github.save.removed', {
                                            files: analysis.removed.join(', '),
                                        })}
                                    </p>
                                ) : null}
                                {analysis.untouched.length > 0 ? (
                                    <p className="text-amber-700 dark:text-amber-400">
                                        {t('luxdb.github.save.untouched', {
                                            files: analysis.untouched.join(
                                                ', '
                                            ),
                                        })}
                                    </p>
                                ) : null}
                            </div>
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            {active ? (
                                <>
                                    <div className="flex justify-between text-muted-foreground">
                                        <span>
                                            {active.kind === 'new'
                                                ? t(
                                                      'luxdb.github.save.diff_new'
                                                  )
                                                : t(
                                                      'luxdb.github.save.diff_github',
                                                      {
                                                          branch: source.branch,
                                                      }
                                                  )}
                                        </span>
                                        <span>
                                            {t('luxdb.github.save.diff_mine')}
                                        </span>
                                    </div>
                                    <div className="h-[50vh] min-h-48 rounded border">
                                        <Suspense fallback={<Spinner />}>
                                            <DiffEditor
                                                key={active.path}
                                                original={active.before ?? ''}
                                                modified={active.after}
                                                language="dbml"
                                                beforeMount={setupDBMLLanguage}
                                                theme={
                                                    effectiveTheme === 'dark'
                                                        ? 'dbml-dark'
                                                        : 'dbml-light'
                                                }
                                                options={{
                                                    readOnly: true,
                                                    originalEditable: false,
                                                    renderSideBySide: true,
                                                    minimap: {
                                                        enabled: false,
                                                    },
                                                    scrollBeyondLastLine: false,
                                                    automaticLayout: true,
                                                    fontSize: 12,
                                                }}
                                            />
                                        </Suspense>
                                    </div>
                                </>
                            ) : null}
                        </div>
                    </div>
                )}

                {analysis && analysis.changes.length > 0 ? (
                    <div className="grid gap-2 text-xs md:grid-cols-2">
                        <div className="flex flex-col gap-1">
                            <Label
                                className="text-xs"
                                htmlFor="luxdb-save-branch"
                            >
                                {t('luxdb.github.save.branch')}
                            </Label>
                            <Input
                                id="luxdb-save-branch"
                                className="h-7 text-xs"
                                value={branch}
                                onChange={(event) =>
                                    setBranch(event.target.value.trim())
                                }
                            />
                            {!branchValid ? (
                                <p className="text-red-700 dark:text-red-400">
                                    {t('luxdb.github.save.branch_invalid', {
                                        prefix: BRANCH_PREFIX,
                                    })}
                                </p>
                            ) : null}
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label
                                className="text-xs"
                                htmlFor="luxdb-save-message"
                            >
                                {t('luxdb.github.save.message')}
                            </Label>
                            <Input
                                id="luxdb-save-message"
                                className="h-7 text-xs"
                                value={message}
                                onChange={(event) => {
                                    setMessageEdited(true);
                                    setMessage(event.target.value);
                                }}
                            />
                        </div>
                        <p className="text-muted-foreground md:col-span-2">
                            {t('luxdb.github.save.exporter_note')}
                            {analysis.warnings.length > 0
                                ? ` ${analysis.warnings.join(' ')}`
                                : ''}
                        </p>
                    </div>
                ) : null}

                {outcome?.kind === 'committed' ||
                outcome?.kind === 'unchanged' ? (
                    <p className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400">
                        <CheckCircle2 className="size-4" />
                        {outcome.kind === 'committed'
                            ? t('luxdb.github.save.committed', {
                                  count: outcome.count,
                                  branch: outcome.branch,
                              })
                            : t('luxdb.github.save.already_there', {
                                  branch: outcome.branch,
                              })}
                    </p>
                ) : null}
                {outcome?.kind === 'conflict' ? (
                    <div className="flex items-start gap-1 text-sm text-red-700 dark:text-red-400">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        <span>
                            {t('luxdb.github.save.conflict', {
                                count: outcome.conflicts.length,
                                files: outcome.conflicts
                                    .map((conflict) => conflict.path)
                                    .join(', '),
                                branch: branch,
                            })}
                        </span>
                    </div>
                ) : null}
                {outcome?.kind === 'branch_moved' ? (
                    <p className="flex items-center gap-1 text-sm text-red-700 dark:text-red-400">
                        <AlertTriangle className="size-4" />
                        {t('luxdb.github.save.branch_moved', { branch })}
                    </p>
                ) : null}
                {error ? (
                    <p className="text-sm text-red-700 dark:text-red-400">
                        {error}
                    </p>
                ) : null}
                {signedOut ? (
                    <div className="flex items-center gap-2 text-sm">
                        <span>{t('luxdb.github.save.signed_out')}</span>
                        <Button
                            type="button"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            disabled={busy !== null}
                            onClick={() => void signIn()}
                        >
                            {busy === 'sign-in' ? (
                                <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                                <LogIn className="size-3.5" />
                            )}
                            {t('luxdb.github.sign_in')}
                        </Button>
                    </div>
                ) : null}

                <DialogFooter className="flex flex-wrap items-center gap-2 sm:justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {source.pullRequestUrl ? (
                            <a
                                href={source.pullRequestUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 underline-offset-2 hover:underline"
                            >
                                <ExternalLink className="size-3.5" />
                                {t('luxdb.github.save.view_pull_request')}
                            </a>
                        ) : hasCommitted ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 text-xs"
                                disabled={busy !== null}
                                onClick={() => void openPullRequest()}
                            >
                                {busy === 'pull' ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                    <GitPullRequest className="size-3.5" />
                                )}
                                {t('luxdb.github.save.open_pull_request', {
                                    base: source.baseBranch,
                                })}
                            </Button>
                        ) : null}
                    </div>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            {t('luxdb.github.save.close')}
                        </Button>
                        {analysis && analysis.changes.length > 0 ? (
                            <Button
                                type="button"
                                disabled={
                                    busy !== null ||
                                    ticked.length === 0 ||
                                    !branchValid
                                }
                                onClick={() => void commit()}
                            >
                                {busy === 'commit' ? (
                                    <Loader2 className="mr-1 size-4 animate-spin" />
                                ) : null}
                                {t('luxdb.github.save.commit', {
                                    count: ticked.length,
                                    branch,
                                })}
                            </Button>
                        ) : null}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
