import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Terminal, TerminalSquare, Sun, Moon, GitBranch, FolderPlus, LogOut, Bell, BellOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { api } from '../../lib/api';
import { routes } from '../../lib/navigation';
import { requestNotificationPermission } from '../../lib/notifications';
import { useNotificationStore } from '../../stores/notificationStore';
import { useThemeStore } from '../../stores/themeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProjects } from '../../hooks/useProjects';
import { RegisterProjectDialog } from '../projects/RegisterProjectDialog';
import { HeartbeatIndicator } from '../status/HeartbeatIndicator';
import { BudgetStatusline } from '../budget/BudgetPanel';
import { Button } from '../ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../ui/tooltip';
import { useAuthStore } from '../../stores/authStore';

export function Header() {
  const { theme, toggleTheme } = useThemeStore();
  const { selectedProjectId, selectProject } = useProjectStore();
  const { data: projectsData } = useProjects();
  const [registerOpen, setRegisterOpen] = useState(false);
  const { username, isAuthenticated, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const terminalActive = location.pathname === routes.terminal();

  // Toggle between the terminal route and the previous center view. Going
  // "back" from the terminal uses history when we came from inside the app,
  // falling back to the chat view for direct deep links.
  const toggleTerminal = useCallback(() => {
    if (terminalActive) {
      if (window.history.length > 1) navigate(-1);
      else navigate(routes.chat());
    } else {
      navigate(routes.terminal());
    }
  }, [terminalActive, navigate]);

  // Ctrl+` toggles the terminal (WebTerminal lets this combo pass through
  // its own key handling so it works while the terminal is focused too).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Backquote') {
        event.preventDefault();
        toggleTerminal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleTerminal]);

  const projects = projectsData?.projects || [];

  return (
    <header className="h-12 border-b border-border/50 flex items-center justify-between px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-3">
        {/* Dev-toolish logo */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Terminal className="h-5 w-5 text-emerald-500" strokeWidth={2.5} />
            <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 bg-emerald-500 rounded-full animate-pulse" />
          </div>
          <span className="font-mono font-bold text-base tracking-tight">
            soren
          </span>
        </div>
        <div className="h-4 w-px bg-border" />
        <GitBranchIndicator />

        {/* Project Selector */}
        {projects.length > 0 && (
          <>
            <div className="h-4 w-px bg-border" />
            <select
              value={selectedProjectId ?? ''}
              onChange={(e) => selectProject(e.target.value || null)}
              className="h-7 text-xs font-mono rounded-md border bg-background px-2 text-foreground"
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setRegisterOpen(true)}
          title="Register project"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-mono hidden sm:inline">
          multi-agent orchestrator
        </span>

        <div className="h-4 w-px bg-border" />

        {/* Heartbeat + cost badge + dark mode grouped tight */}
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTerminal}
                className={cn(
                  'h-8 w-8',
                  terminalActive && 'bg-accent text-emerald-500 hover:text-emerald-500'
                )}
                aria-pressed={terminalActive}
              >
                <TerminalSquare
                  className={cn('h-4 w-4', !terminalActive && 'text-muted-foreground')}
                />
                <span className="sr-only">Toggle terminal</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs font-mono">
              terminal (ctrl+`)
            </TooltipContent>
          </Tooltip>
          <NotificationToggle />
          <HeartbeatIndicator />
          <BudgetStatusline />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-8 w-8"
          >
          {theme === 'light' ? (
            <Moon className="h-4 w-4 text-slate-600" />
          ) : (
            <Sun className="h-4 w-4 text-yellow-500" />
          )}
          <span className="sr-only">Toggle theme</span>
          </Button>
          {isAuthenticated && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={logout}
                  className="h-8 w-8"
                >
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                  <span className="sr-only">Sign out {username}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs font-mono">
                sign out{username ? ` (${username})` : ''}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <RegisterProjectDialog open={registerOpen} onOpenChange={setRegisterOpen} />
    </header>
  );
}

/** Bell toggle for away-state browser notifications (P3.7). */
function NotificationToggle() {
  const { enabled, setEnabled } = useNotificationStore();

  const handleToggle = async () => {
    if (enabled) {
      setEnabled(false);
      return;
    }
    const granted = await requestNotificationPermission();
    setEnabled(granted);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleToggle}
          className="h-8 w-8"
          aria-pressed={enabled}
        >
          {enabled ? (
            <Bell className="h-4 w-4 text-emerald-500" aria-hidden />
          ) : (
            <BellOff className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="sr-only">
            {enabled ? 'Disable' : 'Enable'} browser notifications
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs font-mono">
        {enabled ? 'notifications on (fires when tab is hidden)' : 'notifications off'}
      </TooltipContent>
    </Tooltip>
  );
}

/** Live git branch/sha from the scorecard endpoint (was hardcoded "main"). */
function GitBranchIndicator() {
  const { data: scorecard } = useQuery({
    queryKey: ['scorecard'],
    queryFn: () => api.getScorecard(),
    refetchInterval: 30_000,
  });
  return (
    <div
      className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono"
      title={scorecard ? `${scorecard.git_branch}@${scorecard.git_sha}` : undefined}
    >
      <GitBranch className="h-3.5 w-3.5" aria-hidden />
      <span>{scorecard?.git_branch ?? '…'}</span>
    </div>
  );
}
