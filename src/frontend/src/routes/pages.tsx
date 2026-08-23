import { useParams, Navigate } from 'react-router-dom';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ArchivedAgentView } from '@/components/chat/ArchivedAgentView';
import { MemoryViewer } from '@/components/explorer/MemoryViewer';
import { routes, decodeFileSplat } from '@/lib/navigation';

/**
 * Route pages: thin adapters from URL params to existing components.
 * The `key` remounts on identity change so per-view local state can never
 * leak between agents/files — this replaces the setState-during-render
 * reset patterns.
 */

export function AgentPage() {
  const { agentId } = useParams<{ agentId: string }>();
  if (!agentId) return <Navigate to={routes.chat()} replace />;
  const decoded = decodeURIComponent(agentId);
  return <ChatPanel key={decoded} agentId={decoded} />;
}

export function ChatFirehosePage() {
  return <ChatPanel key="__firehose__" agentId={null} />;
}

export function ArchivedPage() {
  const { archiveId } = useParams<{ archiveId: string }>();
  if (!archiveId) return <Navigate to={routes.overview()} replace />;
  const decoded = decodeURIComponent(archiveId);
  return <ArchivedAgentView key={decoded} archiveId={decoded} />;
}

export function FilePage() {
  const params = useParams();
  const path = decodeFileSplat(params['*'] ?? '');
  if (!path) return <Navigate to={routes.overview()} replace />;
  const name = path.split('/').pop() ?? path;
  return (
    <div className="h-full flex flex-col">
      <MemoryViewer key={path} file={{ name, path, type: 'file' }} />
    </div>
  );
}
