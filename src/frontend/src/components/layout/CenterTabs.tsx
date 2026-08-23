import { useEffect } from 'react';
import { NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, TerminalSquare, ListTodo, FileCode, Bot, Archive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { decodeFileSplat } from '@/lib/navigation';

const TABS = [
  { to: '/', label: 'overview', icon: LayoutDashboard, shortcut: '1', end: true },
  { to: '/chat', label: 'chat', icon: MessageSquare, shortcut: '2', end: false },
  { to: '/terminal', label: 'terminal', icon: TerminalSquare, shortcut: '3', end: false },
  { to: '/tasks', label: 'tasks', icon: ListTodo, shortcut: '4', end: false },
] as const;

/**
 * Center tab bar. Static tabs are NavLinks (Cmd/Ctrl+1-4); agent, archive,
 * and file routes surface as a contextual crumb tab while active.
 */
export function CenterTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();

  // Cmd/Ctrl+1..4 switch tabs
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const tab = TABS.find((t) => t.shortcut === e.key);
      if (tab) {
        e.preventDefault();
        navigate(tab.to);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  const context = (() => {
    if (location.pathname.startsWith('/agents/') && params.agentId) {
      return { icon: Bot, label: decodeURIComponent(params.agentId) };
    }
    if (location.pathname.startsWith('/archived/') && params.archiveId) {
      return { icon: Archive, label: decodeURIComponent(params.archiveId) };
    }
    if (location.pathname.startsWith('/files/')) {
      const path = decodeFileSplat(params['*'] ?? '');
      return { icon: FileCode, label: path.split('/').pop() || 'file' };
    }
    return null;
  })();

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border/50 px-1.5"
      role="tablist"
      aria-label="center panel views"
    >
      {TABS.map(({ to, label, icon: Icon, shortcut, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          role="tab"
          className={({ isActive }) =>
            cn(
              'flex h-6 items-center gap-1.5 rounded px-2 font-mono text-[11px] transition-colors',
              isActive
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )
          }
          title={`${label} (⌘${shortcut})`}
        >
          <Icon className="h-3 w-3" aria-hidden />
          <span>{label}</span>
        </NavLink>
      ))}
      {context && (
        <div
          className="flex h-6 items-center gap-1.5 rounded bg-accent px-2 font-mono text-[11px] text-foreground"
          role="tab"
          aria-selected="true"
        >
          <context.icon className="h-3 w-3 text-primary" aria-hidden />
          <span className="max-w-[200px] truncate">{context.label}</span>
        </div>
      )}
    </div>
  );
}
