import { lazy, Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { CenterTabs } from './CenterTabs';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useTerminalStore } from '@/stores/terminalStore';
import { routes } from '@/lib/navigation';

function RouteLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
    </div>
  );
}

// CenterPanel is the permanent center-panel host for every route — a static
// import here meant xterm.js (~84KB gzip) rode in the main bundle on every
// page load even for users who never open the terminal. `hasOpenedTerminal`
// already gates *rendering*; lazy() additionally gates *loading the code*.
const WebTerminal = lazy(() =>
  import('@/components/terminal/WebTerminal').then((m) => ({ default: m.WebTerminal }))
);

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
            <Suspense fallback={<RouteLoading />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
        {(hasOpenedTerminal || isTerminal) && (
          <div className={isTerminal ? 'h-full' : 'hidden'}>
            <ErrorBoundary label="terminal">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
                  </div>
                }
              >
                <WebTerminal active={isTerminal} />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}
