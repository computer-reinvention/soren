import { lazy, Suspense, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, TerminalSquare } from 'lucide-react';
import { CenterTabs } from './CenterTabs';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { useTerminalStore } from '@/stores/terminalStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { routes } from '@/lib/navigation';

function RouteLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
    </div>
  );
}

/**
 * A real interactive shell needs way more than ~340px of usable width to
 * be anything but painful — narrow tmux columns, no physical Ctrl/Tab/
 * arrow keys, constant pinch-zooming. Rather than let xterm.js's FitAddon
 * fight that (it doesn't: cols collapse to single digits and the panel
 * header's mode/font/search controls overflow into a multi-line mess —
 * this was the actual "layout breaks" bug reported), mobile gets an
 * honest unavailable state instead, same spirit as DiffPage disabling
 * split-view on mobile. Talking to agents is still one tap away in Chat.
 */
function MobileTerminalUnavailable() {
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <TerminalSquare className="h-8 w-8 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">Terminal isn't available on small screens</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        A real shell needs more room than a phone screen has — try a larger
        screen, or use Chat to talk to an agent directly instead.
      </p>
      <Button size="sm" variant="secondary" onClick={() => navigate(routes.chat())}>
        Go to chat
      </Button>
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
  const isMobile = useIsMobile();
  const hasOpenedTerminal = useTerminalStore((s) => s.hasOpenedTerminal);
  const markTerminalOpened = useTerminalStore((s) => s.markTerminalOpened);

  useEffect(() => {
    // Don't mark it opened (and therefore never mount/connect it) on
    // mobile — there's nothing usable to keep alive in the background.
    if (isTerminal && !isMobile) markTerminalOpened();
  }, [isTerminal, isMobile, markTerminalOpened]);

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
        {isTerminal && isMobile && (
          <div className="h-full">
            <MobileTerminalUnavailable />
          </div>
        )}
        {!isMobile && (hasOpenedTerminal || isTerminal) && (
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
