import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { GitBranch, GitCommitHorizontal, ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

const FILE_STATUS_COLOR: Record<string, string> = {
  modified: 'text-amber-500',
  added: 'text-emerald-500',
  deleted: 'text-red-400',
  renamed: 'text-blue-400',
  untracked: 'text-muted-foreground',
};

const FILE_STATUS_LETTER: Record<string, string> = {
  modified: 'M', added: 'A', deleted: 'D', renamed: 'R',
  copied: 'C', unmerged: 'U', untracked: '?', ignored: '!',
};

/**
 * Git status panel (P3.3): branch/ahead-behind, working-tree changes, and
 * recent commits. Rendered as a DropdownMenu popover off the Header's
 * branch indicator — same rich-content-popover pattern as HeartbeatIndicator.
 */
export function GitPanel() {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['git-status'],
    queryFn: () => api.getGitStatus(),
    enabled: open,
    staleTime: 10_000,
  });

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono hover:text-foreground transition-colors"
          aria-label="git status"
        >
          <GitBranch className="h-3.5 w-3.5" aria-hidden />
          <span>{data?.branch ?? '…'}</span>
          {data && (data.ahead > 0 || data.behind > 0) && (
            <span className="flex items-center gap-0.5 text-[10px] tabular-nums">
              {data.ahead > 0 && (
                <span className="flex items-center text-emerald-500">
                  <ArrowUp className="h-2.5 w-2.5" />{data.ahead}
                </span>
              )}
              {data.behind > 0 && (
                <span className="flex items-center text-amber-500">
                  <ArrowDown className="h-2.5 w-2.5" />{data.behind}
                </span>
              )}
            </span>
          )}
          {data && data.uncommitted_count > 0 && (
            <span className="rounded-sm bg-amber-500/15 px-1 text-[10px] text-amber-500">
              {data.uncommitted_count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-h-[70vh] overflow-y-auto">
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {data ? `${data.branch}@${data.sha}` : 'git status'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
          </div>
        )}

        {data && (
          <>
            <div className="px-2 py-1.5">
              <h4 className="mb-1 font-mono text-[10px] font-semibold uppercase text-muted-foreground/80">
                changes ({data.uncommitted_count})
              </h4>
              {data.changed_files.length === 0 ? (
                <p className="font-mono text-[11px] text-muted-foreground/60">clean</p>
              ) : (
                <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                  {data.changed_files.map((f) => (
                    <li key={f.path} className="flex items-center gap-1.5 font-mono text-[11px]">
                      <span className={cn('w-3 shrink-0 font-semibold', FILE_STATUS_COLOR[f.status])}>
                        {FILE_STATUS_LETTER[f.status] ?? '?'}
                      </span>
                      <span className="truncate text-foreground/80">{f.path}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <DropdownMenuSeparator />

            <div className="px-2 py-1.5">
              <h4 className="mb-1 font-mono text-[10px] font-semibold uppercase text-muted-foreground/80">
                recent commits
              </h4>
              <ul className="space-y-1.5">
                {data.recent_commits.map((c) => (
                  <li key={c.sha} className="font-mono text-[11px]">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <GitCommitHorizontal className="h-2.5 w-2.5 shrink-0" aria-hidden />
                      <span className="text-primary">{c.sha}</span>
                      <span className="truncate">{c.author}</span>
                    </div>
                    <p className="truncate text-foreground/80 pl-4">{c.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
