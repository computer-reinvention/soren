import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Bot, CircleDollarSign, MessageSquare, Moon } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatTokenCount } from '@/lib/utils';
import { routes } from '@/lib/navigation';
import { useAgents } from '@/hooks/useAgents';
import { useProjects } from '@/hooks/useProjects';
import { groupAgentsByProject } from '@/components/sidebar/sidebar-utils';
import { PRICING } from '@/lib/pricing';

/**
 * System overview — the default view. At-a-glance health, fleet status by
 * project, spend. Pure read-only summary; every tile links somewhere useful.
 */
export function OverviewPage() {
  const { data: agentsData } = useAgents();
  const { data: projectsData } = useProjects();

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.getHealth(),
    refetchInterval: 15_000,
  });

  const { data: budget } = useQuery({
    queryKey: ['budget'],
    queryFn: () => api.getBudget(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const groups = useMemo(
    () => groupAgentsByProject(agentsData?.agents ?? [], projectsData?.projects ?? []),
    [agentsData, projectsData]
  );

  const fleet = useMemo(() => {
    const agents = agentsData?.agents ?? [];
    return {
      total: agents.length,
      working: agents.filter((a) => a.status === 'IN_PROGRESS' || a.status === 'TESTING').length,
      attention: agents.filter((a) => a.status === 'BLOCKED' || a.status === 'FAILED').length,
      sleeping: agents.filter((a) => a.status === 'SLEEPING').length,
    };
  }, [agentsData]);

  const spend = useMemo(() => {
    const agents = budget?.agents ?? [];
    let tokens = 0;
    let cost = 0;
    for (const a of agents) {
      tokens += a.input_tokens + a.output_tokens;
      cost +=
        (a.input_tokens / 1_000_000) * PRICING.input +
        (a.output_tokens / 1_000_000) * PRICING.output +
        (a.cache_read_tokens / 1_000_000) * PRICING.cache_read +
        (a.cache_creation_tokens / 1_000_000) * PRICING.cache_creation;
    }
    return { tokens, cost };
  }, [budget]);

  const healthy = health?.status === 'healthy';

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            system overview
          </h1>
          <span
            className={cn(
              'flex items-center gap-1.5 font-mono text-xs',
              healthy ? 'text-emerald-500' : 'text-red-400'
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                healthy ? 'bg-emerald-500' : 'bg-red-400 animate-pulse motion-reduce:animate-none'
              )}
              aria-hidden
            />
            {healthy ? 'healthy' : (health?.status ?? 'unknown')}
          </span>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile
            icon={Bot}
            label="agents"
            value={String(fleet.total)}
            sub={`${fleet.working} working`}
            to={routes.chat()}
          />
          <StatTile
            icon={AlertTriangle}
            label="attention"
            value={String(fleet.attention)}
            sub={fleet.attention > 0 ? 'blocked / failed' : 'all clear'}
            tone={fleet.attention > 0 ? 'alert' : 'ok'}
            to={routes.chat()}
          />
          <StatTile
            icon={Moon}
            label="sleeping"
            value={String(fleet.sleeping)}
            sub="wake on message"
            to={routes.chat()}
          />
          <StatTile
            icon={CircleDollarSign}
            label="spend"
            value={spend.cost < 0.01 && spend.tokens > 0 ? '<$0.01' : `$${spend.cost.toFixed(2)}`}
            sub={`${formatTokenCount(spend.tokens)} tok`}
            to={routes.tasks()}
          />
        </div>

        {/* Fleet by project */}
        <section aria-label="fleet by project" className="space-y-2">
          <h2 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            fleet
          </h2>
          <div className="space-y-1.5">
            {groups.map((g) => (
              <div
                key={g.id}
                className="rounded border border-border/60 bg-card px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{g.name}</span>
                  {g.isSystem && (
                    <span className="rounded-sm border border-primary/40 px-1 font-mono text-[9px] uppercase text-primary">
                      sys
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                    {g.activeCount > 0 && <span className="text-emerald-500">{g.activeCount} active · </span>}
                    {g.attentionCount > 0 && <span className="text-red-400">{g.attentionCount} blocked · </span>}
                    {g.agents.length + (g.supervisor ? 1 : 0)} total
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {g.supervisor && (
                    <AgentChip id={g.supervisor.id} name={g.supervisor.display_name || g.supervisor.name} working={g.supervisor.status === 'IN_PROGRESS'} supervisor />
                  )}
                  {g.agents.map((a) => (
                    <AgentChip
                      key={a.id}
                      id={a.id}
                      name={a.display_name || a.name}
                      working={a.status === 'IN_PROGRESS' || a.status === 'TESTING'}
                      attention={a.status === 'BLOCKED' || a.status === 'FAILED'}
                      sleeping={a.status === 'SLEEPING'}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Quick links */}
        <section className="flex gap-2" aria-label="quick links">
          <Link
            to={routes.chat()}
            className="flex items-center gap-1.5 rounded border border-border/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <MessageSquare className="h-3 w-3" aria-hidden /> message supervisor
          </Link>
          <Link
            to={routes.tasks()}
            className="flex items-center gap-1.5 rounded border border-border/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Activity className="h-3 w-3" aria-hidden /> task board
          </Link>
        </section>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  to,
  tone,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  sub: string;
  to: string;
  tone?: 'alert' | 'ok';
}) {
  return (
    <Link
      to={to}
      className="rounded border border-border/60 bg-card px-3 py-2 hover:bg-accent/40 transition-colors"
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p
        className={cn(
          'mt-1 font-mono text-lg font-semibold tabular-nums leading-none',
          tone === 'alert' && 'text-red-400',
          tone === 'ok' && 'text-emerald-500'
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{sub}</p>
    </Link>
  );
}

function AgentChip({
  id,
  name,
  working,
  attention,
  sleeping,
  supervisor,
}: {
  id: string;
  name: string;
  working?: boolean;
  attention?: boolean;
  sleeping?: boolean;
  supervisor?: boolean;
}) {
  return (
    <Link
      to={routes.agent(id)}
      className={cn(
        'flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] transition-colors',
        'border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground',
        supervisor && 'border-amber-500/40 text-amber-500',
        attention && 'border-red-500/50 text-red-400',
        sleeping && 'opacity-50'
      )}
    >
      <span
        className={cn(
          'h-1 w-1 rounded-full',
          working ? 'bg-emerald-500' : attention ? 'bg-red-400' : 'bg-muted-foreground/40'
        )}
        aria-hidden
      />
      {name}
    </Link>
  );
}
