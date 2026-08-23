import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Moon, Sun, Monitor, Terminal, LayoutDashboard, MessageSquare, ListTodo } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { useAgentStore } from '@/stores/agentStore';
import { useThemeStore } from '@/stores/themeStore';
import { routes } from '@/lib/navigation';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const agents = useAgentStore((s) => s.agents);
  const { theme, setTheme, toggleTheme } = useThemeStore();

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const runAction = useCallback(
    (action: () => void) => {
      action();
      setOpen(false);
    },
    []
  );

  // Sort agents: active first, then by name
  const sortedAgents = [...agents].sort((a, b) => {
    const activeStatuses = ['IN_PROGRESS', 'TESTING', 'BLOCKED'];
    const aActive = activeStatuses.includes(a.status);
    const bActive = activeStatuses.includes(b.status);
    if (aActive && !bActive) return -1;
    if (bActive && !aActive) return 1;
    return (a.display_name || a.name).localeCompare(b.display_name || b.name);
  });

  const themeLabel =
    theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light';

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search agents..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Agents">
          {sortedAgents.map((agent) => (
            <CommandItem
              key={agent.id}
              value={`agent ${agent.display_name || agent.name} ${agent.name}`}
              onSelect={() => runAction(() => navigate(routes.agent(agent.id)))}
            >
              <Bot className="h-4 w-4 mr-2 shrink-0" />
              <span className="font-mono text-sm">
                {agent.display_name || agent.name}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">
                {agent.status}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Navigate">
          <CommandItem value="overview home" onSelect={() => runAction(() => navigate(routes.overview()))}>
            <LayoutDashboard className="h-4 w-4 mr-2" />
            <span>Overview</span>
            <CommandShortcut>⌘1</CommandShortcut>
          </CommandItem>
          <CommandItem value="chat firehose" onSelect={() => runAction(() => navigate(routes.chat()))}>
            <MessageSquare className="h-4 w-4 mr-2" />
            <span>Chat</span>
            <CommandShortcut>⌘2</CommandShortcut>
          </CommandItem>
          <CommandItem value="open terminal" onSelect={() => runAction(() => navigate(routes.terminal()))}>
            <Terminal className="h-4 w-4 mr-2" />
            <span>Terminal</span>
            <CommandShortcut>⌘3</CommandShortcut>
          </CommandItem>
          <CommandItem value="tasks board" onSelect={() => runAction(() => navigate(routes.tasks()))}>
            <ListTodo className="h-4 w-4 mr-2" />
            <span>Tasks</span>
            <CommandShortcut>⌘4</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Actions">
          <CommandItem
            value="toggle theme"
            onSelect={() => runAction(toggleTheme)}
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4 mr-2" />
            ) : (
              <Moon className="h-4 w-4 mr-2" />
            )}
            <span>Toggle theme</span>
            <CommandShortcut>{themeLabel}</CommandShortcut>
          </CommandItem>

          <CommandItem
            value="theme light"
            onSelect={() => runAction(() => setTheme('light'))}
          >
            <Sun className="h-4 w-4 mr-2" />
            <span>Theme: Light</span>
          </CommandItem>

          <CommandItem
            value="theme dark"
            onSelect={() => runAction(() => setTheme('dark'))}
          >
            <Moon className="h-4 w-4 mr-2" />
            <span>Theme: Dark</span>
          </CommandItem>

          <CommandItem
            value="theme system"
            onSelect={() => runAction(() => setTheme('system'))}
          >
            <Monitor className="h-4 w-4 mr-2" />
            <span>Theme: System</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
