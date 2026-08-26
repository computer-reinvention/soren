import { NavLink } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, ListTodo, PanelLeft, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMobileNavStore } from '@/stores/mobileNavStore';

const ROUTE_TABS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/chat', label: 'Chat', icon: MessageSquare, end: false },
  { to: '/tasks', label: 'Tasks', icon: ListTodo, end: false },
] as const;

const itemClass = (active: boolean) =>
  cn(
    'flex flex-1 flex-col items-center justify-center gap-0.5 font-mono text-[10px] tracking-tight',
    active ? 'text-primary' : 'text-muted-foreground'
  );

/**
 * Bottom tab bar for the mobile layout (P4.1), replacing StatusBar +
 * CenterTabs + the always-visible Sidebar/ActivityTimeline panels. "Agents"
 * and "Activity" open the corresponding panel in a Sheet (mobileNavStore);
 * the terminal stays reachable via the existing Header toggle rather than
 * taking a 4th slot here, keeping this to 5 touch targets.
 */
export function MobileNav() {
  const { sidebarOpen, activityOpen, setSidebarOpen, setActivityOpen } = useMobileNavStore();

  return (
    <nav
      aria-label="primary"
      // min-h + pb (rather than a fixed h-14) so the safe-area inset grows
      // the tap-target strip's bottom padding instead of squeezing content
      // that's already centered inside it — clears the home indicator on
      // notched phones instead of rendering underneath it.
      className="fixed bottom-0 left-0 right-0 z-40 flex min-h-14 items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-pressed={sidebarOpen}
        className={itemClass(sidebarOpen)}
      >
        <PanelLeft className="h-4 w-4" aria-hidden />
        Agents
      </button>

      {ROUTE_TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => itemClass(isActive)}>
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </NavLink>
      ))}

      <button
        type="button"
        onClick={() => setActivityOpen(!activityOpen)}
        aria-pressed={activityOpen}
        className={itemClass(activityOpen)}
      >
        <Activity className="h-4 w-4" aria-hidden />
        Activity
      </button>
    </nav>
  );
}
