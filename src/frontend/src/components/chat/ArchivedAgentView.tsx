import { useQuery } from '@tanstack/react-query';
import { Archive, Terminal } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';

interface ArchivedAgentViewProps {
  archiveId: string;
}

export function ArchivedAgentView({ archiveId }: ArchivedAgentViewProps) {
  const { data: archive, isLoading, error } = useQuery({
    queryKey: ['archivedAgent', archiveId],
    queryFn: () => api.getArchivedAgent(archiveId),
  });

  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        <div className="border-b px-4 py-3 flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="flex-1 p-4 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (error || !archive) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>Failed to load archived conversation</p>
      </div>
    );
  }

  const archivedDate = new Date(archive.archived_at).toLocaleString();

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center gap-3">
        <Archive className="h-5 w-5 text-gray-400" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{archive.agent_name}</span>
            <Badge variant="outline" className="text-xs border-gray-400/50 text-gray-500">
              ARCHIVED
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Archived on {archivedDate}
          </p>
        </div>
      </div>

      {/* Terminal Output */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
            <Terminal className="h-4 w-4" />
            <span>Terminal Output</span>
          </div>
          {archive.terminal_output ? (
            <pre className="text-xs font-mono bg-muted/50 rounded-lg p-4 overflow-x-auto whitespace-pre-wrap">
              {archive.terminal_output}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No terminal output captured
            </p>
          )}
        </div>
      </ScrollArea>

      {/* Footer - indicates read-only */}
      <div className="border-t px-4 py-3 bg-muted/30">
        <p className="text-xs text-muted-foreground text-center">
          This is an archived conversation. Messages cannot be sent to archived agents.
        </p>
      </div>
    </div>
  );
}
