import { useState, useCallback, useRef, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useAgentEventStore } from '@/stores/agentEventStore';
import { api } from '@/lib/api';
import { useMessages } from '@/hooks/useMessages';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAgents } from '@/hooks/useAgents';
import { useProjectAgents } from '@/hooks/useProjects';
import { useChatKeyboard } from '@/hooks/useChatKeyboard';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn, formatTokenCount } from '@/lib/utils';
import { PRICING } from '@/lib/pricing';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { ChatHeader } from './ChatHeader';
import { InboxView } from './InboxView';
import { AgentActivityIndicator } from './AgentActivityIndicator';
import { WorkerConfirmModal } from './WorkerConfirmModal';
import { AgentLog } from '@/components/agents/AgentLog';

interface ChatPanelProps {
  /**
   * Agent scope from the route: /agents/:agentId. null = firehose view
   * (all messages, sends resolve to supervisor with @mention routing).
   * The route remounts this component per agent (key), so per-agent local
   * state resets naturally — no manual sync needed.
   */
  agentId: string | null;
}

export function ChatPanel({ agentId: selectedAgentId }: ChatPanelProps) {
  const isMobile = useIsMobile();
  const { username } = useAuthStore();
  const { selectedProjectId } = useProjectStore();
  const {
    messages: allLoadedMessages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useMessages();
  const { data: agentsData } = useAgents();
  const { data: projectAgentsData } = useProjectAgents(selectedProjectId);
  const queryClient = useQueryClient();

  // Worker confirmation modal state
  const [showWorkerConfirm, setShowWorkerConfirm] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  // Input ref for keyboard shortcuts
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Build set of agent IDs for the selected project
  const projectAgentIds = useMemo(() => {
    if (!selectedProjectId || !projectAgentsData?.agents) return null;
    return new Set(projectAgentsData.agents.map(a => a.key));
  }, [selectedProjectId, projectAgentsData]);

  // Message filter toggle: show all messages (inter-agent) or just user<->agent
  // Default: true for non-supervisor agents, false for main supervisor
  const [showAllMessages, setShowAllMessages] = useState(
    selectedAgentId !== null && selectedAgentId !== 'supervisor'
  );

  // Conversation vs. live tool-call log (P3.4). Component remounts per
  // agent (route key), so this naturally resets to 'chat' on agent switch.
  const [view, setView] = useState<'chat' | 'log'>('chat');

  // Filter messages for selected agent
  // Also filter by project when a project is selected
  const messages = useMemo(() => {
    let filtered = allLoadedMessages;

    // Filter by project (if selected)
    if (projectAgentIds) {
      filtered = filtered.filter(
        (m) => projectAgentIds.has(m.from_agent) || projectAgentIds.has(m.to_agent)
      );
    }

    // Filter by specific agent (if selected)
    if (selectedAgentId) {
      if (showAllMessages) {
        // Show all messages involving this agent (inter-agent included)
        filtered = filtered.filter(
          (m) => m.from_agent === selectedAgentId || m.to_agent === selectedAgentId
        );
      } else {
        // Show only user<->agent messages.
        // A sender/recipient is treated as a user if: it's in the explicit set
        // or matches the logged-in username.
        const isUserAgentId = (agent: string) =>
          agent === 'user' ||
          (username !== null && agent === username);
        filtered = filtered.filter(
          (m) =>
            (m.from_agent === selectedAgentId && isUserAgentId(m.to_agent)) ||
            (isUserAgentId(m.from_agent) && m.to_agent === selectedAgentId)
        );
      }
    }

    return filtered;
  }, [allLoadedMessages, selectedAgentId, projectAgentIds, showAllMessages, username]);

  const targetAgent = selectedAgentId || 'supervisor';

  // Check if the selected agent is a worker (drives inbox view + header)
  const selectedAgent = agentsData?.agents?.find((a) => a.id === selectedAgentId);
  const isWorker = selectedAgent?.type === 'worker';

  // Command Center routing: when no agent is selected, the first @mention
  // naming a live agent becomes the primary send target; default supervisor.
  // (The server additionally mention-routes any other @tags.)
  const resolveSendTarget = useCallback(
    (text: string): string => {
      if (selectedAgentId) return selectedAgentId;
      for (const match of text.matchAll(/@([\w-]+)/g)) {
        if (agentsData?.agents?.some((a) => a.id === match[1])) return match[1];
      }
      return 'supervisor';
    },
    [selectedAgentId, agentsData]
  );

  // P4.3: failed sends (e.g. offline) previously vanished silently — the
  // input clears optimistically for snappy UX, so on error we hand the
  // content back to ChatInput to restore rather than losing it. `nonce`
  // (not just content) so two consecutive failed sends of the same text
  // both trigger the restore effect.
  const [failedSend, setFailedSend] = useState<{ content: string; nonce: number; reason?: string } | null>(null);
  const sendMutation = useMutation({
    mutationFn: ({ to, content }: { to: string; content: string }) =>
      api.sendMessageToAgent(to, content),
    onError: (err, variables) => {
      // api.sendMessageToAgent throws the backend's specific detail on a
      // 503 (tmux delivery genuinely failed — agent asleep/crashed) rather
      // than a generic message, so surface that instead of a canned string.
      setFailedSend({
        content: variables.content,
        nonce: Date.now(),
        reason: err instanceof Error ? err.message : undefined,
      });
    },
  });

  const [interruptedAt, setInterruptedAt] = useState<number | null>(null);
  const [interruptError, setInterruptError] = useState<string | null>(null);
  const interruptMutation = useMutation({
    mutationFn: () => api.interruptAgent(selectedAgentId!),
    onSuccess: () => {
      setInterruptedAt(Date.now());
      setInterruptError(null);
    },
    // Previously had no onError at all — a failed interrupt (target
    // window gone, tmux command failed) was completely silent; the user
    // would click "interrupt" and have no idea it didn't actually do
    // anything.
    onError: (err) => {
      setInterruptError(err instanceof Error ? err.message : 'Failed to interrupt agent');
    },
  });

  // Detect if the selected agent is actively working (recent PostToolUse event)
  const { latestEventBySession, isAgentActive } = useAgentEventStore();
  const isAgentWorking = useMemo(() => {
    if (!selectedAgentId) return false;
    return Object.entries(latestEventBySession).some(
      ([sessionId, event]) => event.agent_id === selectedAgentId && isAgentActive(sessionId)
    );
  }, [selectedAgentId, latestEventBySession, isAgentActive]);

  const handleSendDirect = useCallback((message: string) => {
    sendMutation.mutate({ to: resolveSendTarget(message), content: message });
    setPendingMessage(null);
  }, [sendMutation, resolveSendTarget]);

  const handleSend = useCallback((message: string) => {
    // If the resolved target is a worker (selected or @tagged from the
    // Command Center), show the confirmation modal first
    const target = resolveSendTarget(message);
    const targetObj = agentsData?.agents?.find((a) => a.id === target);
    if (targetObj?.type === 'worker') {
      setPendingMessage(message);
      setShowWorkerConfirm(true);
    } else {
      handleSendDirect(message);
    }
  }, [resolveSendTarget, agentsData, handleSendDirect]);

  const handleWorkerConfirm = useCallback(() => {
    if (pendingMessage) {
      handleSendDirect(pendingMessage);
    }
    setShowWorkerConfirm(false);
  }, [pendingMessage, handleSendDirect]);

  const handleSuggestionClick = (text: string) => {
    handleSend(text);
  };

  const handleClearChat = useCallback(() => {
    // For now, just invalidate the messages query to refresh
    // In a full implementation, this could call an API to clear messages
    queryClient.invalidateQueries({ queryKey: ['messages'] });
  }, [queryClient]);

  // Keyboard shortcuts
  useChatKeyboard({
    inputRef,
    onSend: () => {
      // The ChatInput component handles its own Enter key,
      // but Cmd+Enter from anywhere should trigger send
      const textarea = inputRef.current;
      if (textarea && textarea.value.trim()) {
        handleSend(textarea.value.trim());
        textarea.value = '';
      }
    },
    enabled: true,
  });

  return (
    <div className="h-full flex flex-col">
      {/* Enhanced Header */}
      <ChatHeader
        agentId={selectedAgentId}
        agent={selectedAgent}
        isWorker={isWorker}
        onClearChat={handleClearChat}
        showAllMessages={showAllMessages}
        onToggleFilter={isWorker ? undefined : () => setShowAllMessages(prev => !prev)}
        view={view}
        onToggleView={selectedAgentId ? () => setView((v) => (v === 'chat' ? 'log' : 'chat')) : undefined}
      />

      {/* Chat Content — live tool-call log, inbox (workers), or DM view */}
      {view === 'log' && selectedAgentId ? (
        <AgentLog agentId={selectedAgentId} />
      ) : isWorker && selectedAgentId ? (
        <InboxView
          messages={messages}
          agentId={selectedAgentId}
          onLoadMore={fetchNextPage}
          hasMore={hasNextPage ?? false}
          isLoadingMore={isFetchingNextPage}
        />
      ) : (
        <ChatMessages
          messages={messages}
          onSuggestionClick={handleSuggestionClick}
          onLoadMore={fetchNextPage}
          hasMore={hasNextPage ?? false}
          isLoadingMore={isFetchingNextPage}
        />
      )}

      {/* Activity Indicator - shows when agent is working */}
      <AgentActivityIndicator agentId={targetAgent} />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        isPending={sendMutation.isPending}
        failedSend={failedSend}
        placeholder={
          // Mobile: no placeholder at all, not just a shorter one. The
          // recipient is already shown on screen either way — the bot-icon
          // routing chip right above the input in Command Center mode, or
          // the ChatHeader title on an individual agent page — so restating
          // "Message <name>" here was pure redundancy. (Empty string is
          // intentional and must reach ChatInput as "" — its fallback uses
          // ?? not ||, specifically so this isn't overridden.) Desktop
          // keeps the fuller hint; there's room for it there and it wasn't
          // flagged as an issue.
          isMobile
            ? ''
            : selectedAgentId
              ? `Message ${targetAgent} — Enter to send`
              : 'Message supervisor — @tag any agent to route directly'
        }
        inputRef={inputRef}
        agents={agentsData?.agents || []}
        resolveTarget={selectedAgentId ? undefined : resolveSendTarget}
        onInterrupt={selectedAgentId ? () => interruptMutation.mutate() : undefined}
        isAgentWorking={isAgentWorking}
        isInterrupting={interruptMutation.isPending}
        interruptedAt={interruptedAt}
      />
      <AgentCostLine agentId={targetAgent} />
      {/* sendMutation's own failure banner was removed here — ChatInput's
          `failedSend` prop already shows a more specific reason (the
          backend's actual error detail on a 503, e.g. "agent asleep") in
          the same spot; showing both was a redundant duplicate banner. */}
      {interruptError && (
        <p className="px-4 pb-2 text-sm text-destructive" role="alert">
          {interruptError}
        </p>
      )}

      {/* Worker Confirmation Modal */}
      <WorkerConfirmModal
        open={showWorkerConfirm}
        onOpenChange={setShowWorkerConfirm}
        agentName={pendingMessage ? resolveSendTarget(pendingMessage) : (selectedAgent?.name || targetAgent)}
        onConfirm={handleWorkerConfirm}
      />
    </div>
  );
}

function AgentCostLine({ agentId }: { agentId: string }) {
  const isMobile = useIsMobile();
  const { data: budgetData } = useQuery({
    queryKey: ['budget'],
    queryFn: () => api.getBudget(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const agentUsage = useMemo(() => {
    if (!budgetData?.agents) return null;
    return budgetData.agents.find((a) => a.agent_id === agentId) ?? null;
  }, [budgetData, agentId]);

  if (!agentUsage) return null;

  const totalTokens = agentUsage.input_tokens + agentUsage.output_tokens;
  const cost =
    (agentUsage.input_tokens / 1_000_000) * PRICING.input +
    (agentUsage.output_tokens / 1_000_000) * PRICING.output +
    (agentUsage.cache_read_tokens / 1_000_000) * PRICING.cache_read +
    (agentUsage.cache_creation_tokens / 1_000_000) * PRICING.cache_creation;

  const costStr = cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`;

  return (
    <div
      className={cn(
        'text-center text-muted-foreground font-mono',
        // Mobile stacks this directly above the bottom nav bar — kept
        // present (budget visibility isn't cut), just visually quieter so
        // it doesn't compete with the fixed nav for the same sliver of
        // screen the conversation needs.
        isMobile ? 'text-[10px] py-0.5' : 'text-xs py-1'
      )}
    >
      {agentId} · {costStr} · {formatTokenCount(totalTokens)} tok
    </div>
  );
}
