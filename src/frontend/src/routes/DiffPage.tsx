import { useMemo, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactDiffViewer from 'react-diff-viewer-continued';
import { FileDiff, FilePlus, FileMinus, FileEdit, GitCommitHorizontal, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { languageFromFilename } from '@/lib/syntax';
import { routes } from '@/lib/navigation';
import { useIsMobile } from '@/hooks/use-mobile';

const STATUS_ICON: Record<string, typeof FileEdit> = {
  added: FilePlus,
  deleted: FileMinus,
  modified: FileEdit,
  renamed: FileEdit,
};

const STATUS_COLOR: Record<string, string> = {
  added: 'text-emerald-700 dark:text-emerald-500',
  deleted: 'text-red-400',
  modified: 'text-amber-500',
  renamed: 'text-blue-400',
};

/**
 * Diff viewer (P3.2): per-file before/after diff for a commit, or
 * `sha=working` for uncommitted changes. Reached from GitPanel's commit
 * list / changed-files link.
 */
export function DiffPage() {
  const { sha } = useParams<{ sha: string }>();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // themeStore.applyTheme toggles this class — it's the single source of
  // truth for what's actually rendered (handles 'system' resolution too).
  const isDark = document.documentElement.classList.contains('dark');
  const isMobile = useIsMobile();

  const { data, isLoading, error } = useQuery({
    queryKey: ['commit-diff', sha],
    queryFn: () => api.getCommitDiff(sha!),
    enabled: !!sha,
    staleTime: sha === 'working' ? 5_000 : Infinity, // commits are immutable; working tree isn't
  });

  const activeFile = useMemo(
    () => data?.files.find((f) => f.path === selectedPath) ?? data?.files[0] ?? null,
    [data, selectedPath]
  );

  if (!sha) return <Navigate to={routes.overview()} replace />;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground font-mono">
        loading diff…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <AlertTriangle className="h-5 w-5 text-red-400" aria-hidden />
        <p className="font-mono">{(error as Error)?.message ?? 'failed to load diff'}</p>
      </div>
    );
  }

  if (data.files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground font-mono">
        no changes
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* File list — stacks above the diff on mobile (capped height, its own
          scroll) instead of a fixed 224px sidebar, which left no room for
          the diff itself on a phone-width viewport. */}
      <div className="w-full shrink-0 overflow-y-auto border-b border-border/50 bg-muted/10 max-h-40 md:max-h-none md:w-56 md:border-b-0 md:border-r">
        <div className="border-b border-border/50 px-3 py-2">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <GitCommitHorizontal className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{data.title}</span>
          </div>
          {data.truncated && (
            <p className="mt-1 font-mono text-[10px] text-amber-500">showing first {data.files.length} files</p>
          )}
        </div>
        <ul>
          {data.files.map((f) => {
            const Icon = STATUS_ICON[f.status] ?? FileDiff;
            const active = activeFile?.path === f.path;
            return (
              <li key={f.path}>
                <button
                  onClick={() => setSelectedPath(f.path)}
                  className={cn(
                    'flex w-full items-center gap-1.5 px-3 py-1.5 text-left font-mono text-[11px] transition-colors',
                    active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                  )}
                  title={f.path}
                >
                  <Icon className={cn('h-3 w-3 shrink-0', STATUS_COLOR[f.status])} aria-hidden />
                  <span className="truncate">{f.path.split('/').pop()}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Diff */}
      <div className="min-w-0 flex-1 overflow-auto">
        {activeFile && (
          activeFile.binary ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground font-mono">
              binary file — {activeFile.path}
            </div>
          ) : (
            <ReactDiffViewer
              oldValue={activeFile.old_content}
              newValue={activeFile.new_content}
              splitView={!isMobile}
              useDarkTheme={isDark}
              highlightLanguage={languageFromFilename(activeFile.path) ?? undefined}
              leftTitle={activeFile.status === 'added' ? '(new file)' : activeFile.path}
              rightTitle={activeFile.status === 'deleted' ? '(deleted)' : activeFile.path}
            />
          )
        )}
      </div>
    </div>
  );
}

