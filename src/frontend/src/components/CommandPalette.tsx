import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bot, Moon, Sun, Monitor, Terminal, LayoutDashboard, MessageSquare, ListTodo, FileCode, BookOpen, CheckSquare, ShieldCheck, Settings as SettingsIcon, Brain } from 'lucide-react';
import { useSettingsPanelStore } from '@/stores/settingsPanelStore';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
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
import { useTasks } from '@/hooks/useTasks';
import { useFilesystem } from '@/hooks/useFilesystem';
import { flattenTasks } from '@/components/tasks/task-utils';
import { api } from '@/lib/api';
import { routes } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import type { FilesystemItem } from '@/types/filesystem';

/** Recursively flatten the .soren/ filesystem tree into files only (search
 *  target is "find a file by name", not directory browsing). Capped — this
 *  feeds a command palette list, not a full tree view. */
const MAX_FILE_RESULTS = 200;
function flattenFiles(items: FilesystemItem[], out: FilesystemItem[] = []): FilesystemItem[] {
  for (const item of items) {
    if (out.length >= MAX_FILE_RESULTS) break;
    if (item.type === 'file') out.push(item);
    if (item.children?.length) flattenFiles(item.children, out);
  }
  return out;
}

/** Debounce the raw typed query for the async journal search — every other
 *  group here filters synchronously over already-loaded client data, but
 *  journal search is a real network request per keystroke otherwise. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function CommandPalette() {
  // P5.5: lifted from local state to a shared store so ChatInput's
  // `/search <query>` slash command can open this same dialog pre-filled.
  const { open, query, setOpen, setQuery } = useCommandPaletteStore();
  const navigate = useNavigate();

  const agents = useAgentStore((s) => s.agents);
  const { theme, setTheme, toggleTheme } = useThemeStore();

  // Tasks and files are loaded once the palette is open and filtered
  // client-side by cmdk's own fuzzy matcher (same pattern as Agents,
  // which already does this against the always-live agentStore).
  const { data: taskData } = useTasks();
  const { data: fsData } = useFilesystem();
  const flatTasks = useMemo(() => flattenTasks(taskData?.tasks ?? []), [taskData]);
  const flatFiles = useMemo(() => flattenFiles(fsData?.items ?? []), [fsData]);

  // Journal search is a real network call (P5.1) — debounced and only
  // fired once the palette is open with a non-trivial query, unlike the
  // synchronous groups above which just filter data already in memory.
  const debouncedQuery = useDebouncedValue(query, 250);
  const { data: journalData } = useQuery({
    queryKey: ['journal-search', debouncedQuery],
    queryFn: () => api.searchJournal(debouncedQuery, 5),
    enabled: open && debouncedQuery.trim().length > 1,
    staleTime: 30_000,
  });

  // P5.4: semantic memory search, same debounce/gating as journal search
  // above — a real (and heavier, embedding-based) network call, not a
  // client-side filter. Folded into this one palette rather than a
  // separate MemorySearch dialog: P5.1 already established "Cmd+K is the
  // single global search surface," and memory results are conceptually
  // the same shape as journal results (query -> ranked snippets -> jump to
  // source file), so a second standalone search UI next to this one would
  // just be two places to look for the same kind of thing.
  const { data: memoryData } = useQuery({
    queryKey: ['memory-search', debouncedQuery],
    queryFn: () => api.searchMemory(debouncedQuery, 5),
    enabled: open && debouncedQuery.trim().length > 1,
    staleTime: 30_000,
  });

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!useCommandPaletteStore.getState().open);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  // Reset the query when the palette closes so it doesn't reopen showing
  // stale search results from last time.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open, setQuery]);

  const runAction = useCallback(
    (action: () => void) => {
      action();
      setOpen(false);
    },
    [setOpen]
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
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search agents, tasks, files, journal, or run a command..."
      />
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

        {flatTasks.length > 0 && (
          <CommandGroup heading="Tasks">
            {flatTasks.map((task) => (
              <CommandItem
                key={task.id}
                value={`task ${task.title} ${task.id}`}
                onSelect={() =>
                  runAction(() => navigate(`${routes.tasks()}?q=${encodeURIComponent(task.title)}`))
                }
              >
                <CheckSquare className="h-4 w-4 mr-2 shrink-0" />
                <span className="truncate">{task.title}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">{task.status}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {flatFiles.length > 0 && (
          <CommandGroup heading="Files">
            {flatFiles.map((file) => (
              <CommandItem
                key={file.path}
                value={`file ${file.name} ${file.path}`}
                onSelect={() => runAction(() => navigate(routes.file(file.path)))}
              >
                <FileCode className="h-4 w-4 mr-2 shrink-0" />
                <span className="truncate">{file.name}</span>
                <span className="ml-2 shrink-0 truncate text-xs text-muted-foreground">{file.path}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {journalData && journalData.results.length > 0 && (
          <CommandGroup heading="Journal">
            {journalData.results.map((result) => (
              <CommandItem
                key={`${result.date}-${result.line_number}`}
                // Server-side search already matched this — value just
                // needs to contain the query so cmdk's own filter (still
                // active on top) doesn't immediately hide it.
                value={`journal ${query} ${result.title}`}
                onSelect={() =>
                  // Journal search defaults to the supervisor scope (see
                  // api.searchJournal) — the file now lives under
                  // supervisor/, not directly under .soren/journal/.
                  runAction(() => navigate(routes.file(`.soren/journal/supervisor/${result.date}/journal.md`)))
                }
              >
                <BookOpen className="h-4 w-4 mr-2 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{result.title || result.date}</div>
                  <div className="truncate text-xs text-muted-foreground">{result.snippet}</div>
                </div>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">{result.date}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {memoryData && memoryData.results.length > 0 && (
          <CommandGroup heading="Memory">
            {memoryData.results.map((result) => {
              // Only memories from the current project's own .soren/ tree
              // are navigable via the file viewer; other projects' source
              // paths ("{project_id}/.soren/...") aren't browsable from
              // here, so those just render as a label, not a link.
              const isLocalFile = result.source_path?.startsWith('.soren/');
              return (
                <CommandItem
                  key={result.id}
                  value={`memory ${query} ${result.content.slice(0, 60)}`}
                  onSelect={() =>
                    isLocalFile && runAction(() => navigate(routes.file(result.source_path!)))
                  }
                  className={cn(!isLocalFile && 'aria-selected:bg-transparent cursor-default')}
                >
                  <Brain className="h-4 w-4 mr-2 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{result.content}</div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="shrink-0 uppercase">{result.source_type}</span>
                      {result.source_path && <span className="truncate">{result.source_path}</span>}
                    </div>
                  </div>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {Math.round(result.score * 100)}%
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

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
          <CommandItem value="reliability dashboard agents failures" onSelect={() => runAction(() => navigate(routes.reliability()))}>
            <ShieldCheck className="h-4 w-4 mr-2" />
            <span>Reliability Dashboard</span>
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

          <CommandItem
            value="settings density notifications terminal shortcuts"
            onSelect={() => runAction(() => useSettingsPanelStore.getState().setOpen(true))}
          >
            <SettingsIcon className="h-4 w-4 mr-2" />
            <span>Settings</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
