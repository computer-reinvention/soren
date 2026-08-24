import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Layout } from './components/layout/Layout';
import { ResizableLayout } from './components/layout/ResizableLayout';
import { Sidebar } from './components/sidebar/Sidebar';
import { CenterPanel } from './components/layout/CenterPanel';
import { ActivityTimeline } from './components/activity/ActivityTimeline';
import { StatusBar } from './components/status/StatusBar';
import { TooltipProvider } from './components/ui/tooltip';
import { OnboardingModal } from './components/onboarding/OnboardingModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useWebSocket } from './hooks/useWebSocket';
import { useAgentEvents } from './hooks/useAgentEvents';
import { useThoughts } from './hooks/useThoughts';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
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

  return (
    <Layout>
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
      <StatusBar />
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
