import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/layout/Layout';
import { ResizableLayout } from './components/layout/ResizableLayout';
import { Explorer } from './components/explorer/Explorer';
import { CenterPanel } from './components/layout/CenterPanel';
import { ActivityTimeline } from './components/activity/ActivityTimeline';
import { StatusBar } from './components/status/StatusBar';
import { TooltipProvider } from './components/ui/tooltip';
import { OnboardingModal } from './components/onboarding/OnboardingModal';
import { useWebSocket } from './hooks/useWebSocket';
import { useAgentEvents } from './hooks/useAgentEvents';
import { useThoughts } from './hooks/useThoughts';
import { useThemeStore } from './stores/themeStore';
import { AuthGuard } from './components/auth/AuthGuard';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
    },
  },
});

function Dashboard() {
  useWebSocket();
  useAgentEvents(); // Load historical events on app start
  useThoughts(); // Load historical thoughts so they persist across refreshes
  const theme = useThemeStore((state) => state.theme);

  // Theme is applied by themeStore (applyTheme + onRehydrate + system listener)
  // This effect ensures the DOM stays in sync when the store value changes
  useEffect(() => {
    const root = document.documentElement;
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'dark')
      : theme;
    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  return (
    <Layout>
      <ResizableLayout
        left={<Explorer />}
        center={<CenterPanel />}
        right={<ActivityTimeline />}
      />
      <StatusBar />
      <OnboardingModal />
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthGuard>
          <Dashboard />
        </AuthGuard>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
