import { useEffect, useRef } from 'react';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { WebTerminal } from '@/components/terminal/WebTerminal';
import { useTerminalStore } from '@/stores/terminalStore';
import { useAgentStore } from '@/stores/agentStore';
import { useViewerStore } from '@/stores/viewerStore';

/**
 * Center panel host: switches between the chat stack (ChatPanel, which
 * itself gates on agentStore/viewerStore selection) and the web terminal.
 *
 * Once opened, the terminal stays mounted with display:none when the user
 * flips back to chat, so the WS session and scrollback survive tab flips;
 * WebTerminal re-fits itself on re-show. The terminal never touches
 * agent/file selection, so closing it restores exactly what was shown
 * before.
 */
export function CenterPanel() {
  const centerMode = useTerminalStore((s) => s.centerMode);
  const hasOpenedTerminal = useTerminalStore((s) => s.hasOpenedTerminal);
  const setCenterMode = useTerminalStore((s) => s.setCenterMode);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const viewingArchivedId = useAgentStore((s) => s.viewingArchivedId);
  const selectedFile = useViewerStore((s) => s.selectedFile);

  const isTerminal = centerMode === 'terminal';

  // If the user picks a new agent/file/archive in the Explorer while the
  // terminal is showing, flip back to chat so the selection is visible.
  // Change-detection via ref so opening the terminal itself never triggers it.
  const prevSelectionRef = useRef({ selectedAgentId, viewingArchivedId, selectedFile });
  useEffect(() => {
    const prev = prevSelectionRef.current;
    const changed =
      prev.selectedAgentId !== selectedAgentId ||
      prev.viewingArchivedId !== viewingArchivedId ||
      prev.selectedFile !== selectedFile;
    prevSelectionRef.current = { selectedAgentId, viewingArchivedId, selectedFile };
    if (changed) setCenterMode('chat');
  }, [selectedAgentId, viewingArchivedId, selectedFile, setCenterMode]);

  return (
    <div className="relative h-full">
      <div className={isTerminal ? 'hidden' : 'h-full'}>
        <ChatPanel />
      </div>
      {hasOpenedTerminal && (
        <div className={isTerminal ? 'h-full' : 'hidden'}>
          <WebTerminal active={isTerminal} />
        </div>
      )}
    </div>
  );
}
