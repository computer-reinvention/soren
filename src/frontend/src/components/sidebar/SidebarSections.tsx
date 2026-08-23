import { useMemo, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Archive, FolderOpen, KeyRound, RefreshCw } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { routes, decodeFileSplat } from '@/lib/navigation';
import { useAgentStore } from '@/stores/agentStore';
import { useFilesystem, buildFileTree } from '@/hooks/useFilesystem';
import { FileTree, type FileTreeItem } from '@/components/explorer/FileTree';
import { JournalTree } from '@/components/explorer/JournalTree';
import { SecretsPanel } from '@/components/secrets/SecretsPanel';

/**
 * Secondary sidebar sections: Files (journal + .soren tree), Archived agents,
 * Secrets. File/archive selection navigates — the URL is the selection.
 */

function SectionHeader({
  icon: Icon,
  label,
  count,
  open,
}: {
  icon: typeof FolderOpen;
  label: string;
  count?: number;
  open: boolean;
}) {
  return (
    <span className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 hover:bg-accent/40 transition-colors">
      <ChevronRight
        className={cn(
          'h-3 w-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
          open && 'rotate-90'
        )}
        aria-hidden
      />
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {count !== undefined && count > 0 && (
        <span className="ml-auto font-mono text-[9px] tabular-nums text-muted-foreground/70">
          {count}
        </span>
      )}
    </span>
  );
}

export function FilesSection() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const { data: fsData, refetch, isRefetching } = useFilesystem();

  const selectedPath = location.pathname.startsWith('/files/')
    ? decodeFileSplat(params['*'] ?? '')
    : undefined;

  const { journalFolder, otherFiles } = useMemo(() => {
    const tree = fsData ? buildFileTree(fsData.items) : [];
    return {
      journalFolder: tree.find((item) => item.name === 'journal'),
      otherFiles: tree.filter((item) => item.name !== 'journal' && item.name !== 'mailbox'),
    };
  }, [fsData]);

  const handleFileSelect = (file: FileTreeItem) => {
    if (file.type === 'file') navigate(routes.file(file.path));
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center">
        <CollapsibleTrigger
          className="min-w-0 flex-1"
          aria-label={`files, ${open ? 'expanded' : 'collapsed'}`}
        >
          <SectionHeader icon={FolderOpen} label="files" open={open} />
        </CollapsibleTrigger>
        {open && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 mr-1"
            onClick={() => refetch()}
            aria-label="refresh files"
          >
            <RefreshCw
              className={cn('h-2.5 w-2.5', isRefetching && 'animate-spin motion-reduce:animate-none')}
            />
          </Button>
        )}
      </div>
      <CollapsibleContent>
        <div className="ml-2 border-l border-border/40 pl-1.5 py-0.5">
          {journalFolder && (
            <JournalTree
              journalFolder={journalFolder}
              onFileSelect={handleFileSelect}
              selectedPath={selectedPath}
            />
          )}
          <FileTree items={otherFiles} onFileSelect={handleFileSelect} selectedPath={selectedPath} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ArchivedSection() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const archivedAgents = useAgentStore((s) => s.archivedAgents);
  const setArchivedAgents = useAgentStore((s) => s.setArchivedAgents);

  useQuery({
    queryKey: ['archivedAgents'],
    queryFn: async () => {
      const data = await api.getArchivedAgents();
      setArchivedAgents(data);
      return data;
    },
    staleTime: 60_000,
  });

  if (archivedAgents.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full" aria-label={`archived agents, ${archivedAgents.length}`}>
        <SectionHeader icon={Archive} label="archived" count={archivedAgents.length} open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-2 border-l border-border/40 pl-1.5 py-0.5 space-y-px">
          {archivedAgents.map((agent) => {
            const active = location.pathname === routes.archived(agent.id);
            return (
              <button
                key={agent.id}
                onClick={() => navigate(routes.archived(agent.id))}
                className={cn(
                  'flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent/60 transition-colors',
                  active && 'bg-accent'
                )}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden />
                <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                  {agent.agent_name}
                </span>
                <span className="shrink-0 rounded-sm border border-border px-1 font-mono text-[9px] uppercase leading-4 text-muted-foreground/70">
                  arc
                </span>
              </button>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SecretsSection() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full" aria-label={`secrets, ${open ? 'expanded' : 'collapsed'}`}>
        <SectionHeader icon={KeyRound} label="secrets" open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-2 border-l border-border/40 pl-1.5 py-0.5">
          <SecretsPanel />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
