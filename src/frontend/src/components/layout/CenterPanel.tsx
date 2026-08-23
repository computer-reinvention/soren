import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { WebTerminal } from '@/components/terminal/WebTerminal';
import { CenterTabs } from './CenterTabs';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useTerminalStore } from '@/stores/terminalStore';
import { routes } from '@/lib/navigation';

/**
 * Center panel host: tab bar + routed content. The terminal is special-cased:
 * once opened it stays mounted (hidden) across route changes so the PTY
 * session and scrollback survive tab flips.
 */
export function CenterPanel() {
  const location = useLocation();
  const isTerminal = location.pathname === routes.terminal();
  const hasOpenedTerminal = useTerminalStore((s) => s.hasOpenedTerminal);
  const markTerminalOpened = useTerminalStore((s) => s.markTerminalOpened);

  useEffect(() => {
    if (isTerminal) markTerminalOpened();
  }, [isTerminal, markTerminalOpened]);

  return (
    <div className="flex h-full flex-col">
      <CenterTabs />
      <div className="relative min-h-0 flex-1">
        <div className={isTerminal ? 'hidden' : 'h-full'}>
          <ErrorBoundary label="center panel">
            <Outlet />
          </ErrorBoundary>
        </div>
        {(hasOpenedTerminal || isTerminal) && (
          <div className={isTerminal ? 'h-full' : 'hidden'}>
            <ErrorBoundary label="terminal">
              <WebTerminal active={isTerminal} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}
