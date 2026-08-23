import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, LayoutDashboard, X } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { routes } from '@/lib/navigation';
import { useAgents } from '@/hooks/useAgents';
import { useProjects } from '@/hooks/useProjects';
import { useProjectStore } from '@/stores/projectStore';
import { groupAgentsByProject, filterGroups } from './sidebar-utils';
import { ProjectGroup } from './ProjectGroup';
import { FilesSection, ArchivedSection, SecretsSection } from './SidebarSections';

/**
 * Sidebar: search → project groups (supervisor + agents each) → utility
 * sections. Navigation only — every row is a link, selection lives in the URL.
 */
export function Sidebar() {
  const [query, setQuery] = useState('');
  const { data: agentsData, isLoading } = useAgents();
  const { data: projectsData } = useProjects();
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);

  const { data: budgetData } = useQuery({
    queryKey: ['budget'],
    queryFn: () => api.getBudget(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const tokensByAgent = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of budgetData?.agents ?? []) {
      map.set(a.agent_id, a.input_tokens + a.output_tokens);
    }
    return map;
  }, [budgetData]);

  const groups = useMemo(() => {
    const all = groupAgentsByProject(
      agentsData?.agents ?? [],
      projectsData?.projects ?? []
    );
    const scoped = selectedProjectId ? all.filter((g) => g.id === selectedProjectId) : all;
    return filterGroups(scoped, query);
  }, [agentsData, projectsData, selectedProjectId, query]);

  const searching = query.trim().length > 0;

  return (
    <nav className="flex h-full flex-col" aria-label="projects and agents">
      {/* Search */}
      <div className="relative p-2 pb-1">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 mt-0.5 h-3 w-3 -translate-y-1/2 text-muted-foreground/60"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter agents, projects…"
          aria-label="filter agents and projects"
          className={cn(
            'h-6 w-full rounded border border-border/60 bg-background pl-7 pr-6',
            'font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-1 focus:ring-ring'
          )}
        />
        {searching && (
          <button
            onClick={() => setQuery('')}
            aria-label="clear filter"
            className="absolute right-4 top-1/2 mt-0.5 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-2 pt-1">
          {/* Overview link */}
          <NavLink
            to={routes.overview()}
            end
            className={({ isActive }) =>
              cn(
                'flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-accent/60 transition-colors',
                isActive && 'bg-accent'
              )
            }
          >
            <LayoutDashboard className="h-3 w-3 shrink-0 text-primary" aria-hidden />
            <span className="font-mono text-xs font-medium">overview</span>
          </NavLink>

          {/* Project groups */}
          {isLoading ? (
            <div className="space-y-1 px-2 py-1" aria-label="loading agents">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-5 animate-pulse rounded bg-muted/40 motion-reduce:animate-none" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="px-2 py-2 font-mono text-[10px] text-muted-foreground/60">
              {searching ? 'no matches' : 'no agents running'}
            </p>
          ) : (
            <div className="space-y-1">
              {groups.map((group) => (
                <ProjectGroup
                  key={group.id}
                  group={group}
                  tokensByAgent={tokensByAgent}
                  forceOpen={searching}
                />
              ))}
            </div>
          )}

          <div className="border-t border-border/40 pt-1 space-y-0.5">
            <FilesSection />
            <ArchivedSection />
            <SecretsSection />
          </div>
        </div>
      </ScrollArea>
    </nav>
  );
}
