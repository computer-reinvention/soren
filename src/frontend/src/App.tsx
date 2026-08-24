import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Layout } from './components/layout/Layout';
import { ResizableLayout } from './components/layout/ResizableLayout';
import { Sidebar } from './components/sidebar/Sidebar';
import { CenterPanel } from './components/layout/CenterPanel';
import { MobileNav } from './components/layout/MobileNav';
import { ActivityTimeline } from './components/activity/ActivityTimeline';
import { StatusBar } from './components/status/StatusBar';
import { Sheet, SheetContent, SheetTitle } from './components/ui/sheet';
import { TooltipProvider } from './components/ui/tooltip';
import { OnboardingModal } from './components/onboarding/OnboardingModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useWebSocket } from './hooks/useWebSocket';
import { useAgentEvents } from './hooks/useAgentEvents';
import { useThoughts } from './hooks/useThoughts';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useIsMobile } from './hooks/use-mobile';
import { useMobileNavStore } from './stores/mobileNavStore';
import { AuthGuard } from './components/auth/AuthGuard';
import { CommandPalette } from './components/CommandPalette';
import { ShortcutHelp } from './components/ShortcutHelp';
import { OverviewPage } from './routes/OverviewPage';
import { AgentPage, ArchivedPage, ChatFirehosePage, FilePage } from './routes/pages';
import { TasksPanel } from './components/tasks/TasksPanel';

// react-diff-viewer-continued is only needed on /diff/:sha — lazy-loaded so
// it doesn't ride along in the main bundle for every other route (it was
// adding ~150KB+ eagerly; caught via bundle inspection while adding P3.5/3.6).
const DiffPage = lazy(() => import('./routes/DiffPage').then((m) => ({ default: m.DiffPage })));

function RouteLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
    },
  },
});

/**
 * Shell route: persistent three-panel layout. The center panel renders the
 * matched child route via <Outlet/>; sidebar and right rail never unmount on
 * navigation. Theme is applied entirely by themeStore (applyTheme + system
 * listener) — no component-level theme effects.
 */
function Shell() {
  useWebSocket();
  useAgentEvents(); // Load historical events on app start
  useThoughts(); // Load historical thoughts so they persist across refreshes
  const { helpOpen, setHelpOpen } = useKeyboardShortcuts();
  const isMobile = useIsMobile();
  const { sidebarOpen, activityOpen, setSidebarOpen, setActivityOpen } = useMobileNavStore();
  const location = useLocation();

  // Selecting an agent/file/route from the mobile Agents drawer should
  // close it — otherwise the sheet just sits open over the page it
  // navigated to. The Activity sheet has no navigation of its own but is
  // closed too for consistency (e.g. tapping a task link inside it).
  useEffect(() => {
    setSidebarOpen(false);
    setActivityOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Below md (768px): the 3-panel resizable layout has no viable
  // degradation path (its own minimum widths alone consume 55%+ of a
  // desktop-sized screen). Sidebar and ActivityTimeline become Sheets
  // triggered from MobileNav/Header instead of permanent side panels.
  return (
    <Layout bottomBar={isMobile ? <MobileNav /> : <StatusBar />}>
      {isMobile ? (
        <ErrorBoundary label="center panel">
          <CenterPanel />
        </ErrorBoundary>
      ) : (
        <ResizableLayout
          left={
            <ErrorBoundary label="sidebar">
              <Sidebar />
            </ErrorBoundary>
          }
          center={<CenterPanel />}
          right={
            <ErrorBoundary label="activity">
              <ActivityTimeline />
            </ErrorBoundary>
          }
        />
      )}
      {isMobile && (
        <>
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            {/* pt-9 clears the Sheet's own absolute close button (top-4,
                16px square) so it doesn't sit on top of Sidebar's search
                input, which spans the full width at the very top. */}
            <SheetContent side="left" className="w-[85vw] max-w-xs p-0 pt-9">
              <SheetTitle className="sr-only">Agents</SheetTitle>
              <ErrorBoundary label="sidebar">
                <Sidebar />
              </ErrorBoundary>
            </SheetContent>
          </Sheet>
          <Sheet open={activityOpen} onOpenChange={setActivityOpen}>
            <SheetContent side="right" className="w-[90vw] max-w-sm p-0 pt-9">
              <SheetTitle className="sr-only">Activity</SheetTitle>
              <ErrorBoundary label="activity">
                <ActivityTimeline forceExpanded />
              </ErrorBoundary>
            </SheetContent>
          </Sheet>
        </>
      )}
      <CommandPalette />
      <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <OnboardingModal />
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthGuard>
          <BrowserRouter>
            <Routes>
              <Route element={<Shell />}>
                <Route path="/" element={<OverviewPage />} />
                <Route path="/chat" element={<ChatFirehosePage />} />
                <Route path="/agents/:agentId" element={<AgentPage />} />
                <Route path="/archived/:archiveId" element={<ArchivedPage />} />
                <Route path="/files/*" element={<FilePage />} />
                <Route
                  path="/diff/:sha"
                  element={
                    <Suspense fallback={<RouteLoading />}>
                      <DiffPage />
                    </Suspense>
                  }
                />
                <Route path="/tasks" element={<TasksPanel />} />
                {/* Terminal renders inside CenterPanel (persistent mount); the
                    route itself has no content of its own. */}
                <Route path="/terminal" element={null} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthGuard>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
