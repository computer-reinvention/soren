import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Bot, CheckCircle2, CircleDollarSign, GitBranch, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatTokenCount } from '@/lib/utils';
import { routes } from '@/lib/navigation';
import { useAgents } from '@/hooks/useAgents';
import { useProjects } from '@/hooks/useProjects';
import { groupAgentsByProject } from '@/components/sidebar/sidebar-utils';
import { PRICING } from '@/lib/pricing';

function formatUptime(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  if (h < 24) return `${h}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

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

  const { data: scorecard } = useQuery({
    queryKey: ['scorecard'],
    queryFn: () => api.getScorecard(),
    refetchInterval: 30_000,
  });

  const { data: reliability } = useQuery({
    queryKey: ['agent-reliability'],
    queryFn: () => api.getAgentReliability(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: heartbeatHistory } = useQuery({
    queryKey: ['heartbeat-history'],
    queryFn: () => api.getHeartbeatHistory(60),
    refetchInterval: 30_000,
  });

  const idleSeries = useMemo(
    () =>
      (heartbeatHistory?.heartbeats ?? [])
        .slice()
        .reverse()
        .map((h) => h.supervisor_idle_seconds ?? 0),
    [heartbeatHistory]
  );

  const topAgents = useMemo(
    () =>
      (reliability?.agents ?? [])
        .filter((a) => a.verified + a.failed > 0)
        .sort((a, b) => b.verified + b.failed - (a.verified + a.failed))
        .slice(0, 5),
    [reliability]
  );

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
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            system overview
          </h1>
          <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
            {scorecard && (
              <>
                <span className="flex items-center gap-1" title={scorecard.git_sha}>
                  <GitBranch className="h-3 w-3" aria-hidden />
                  {scorecard.git_branch}
                  <span className="text-muted-foreground dark:text-muted-foreground/80">@{scorecard.git_sha.slice(0, 7)}</span>
                </span>
                <span title="server uptime">up {formatUptime(scorecard.uptime_seconds)}</span>
              </>
            )}
            <span
              className={cn(
                'flex items-center gap-1.5',
                healthy ? 'text-emerald-700 dark:text-emerald-500' : 'text-red-400'
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
            icon={CheckCircle2}
            label="tasks today"
            value={String(scorecard?.tasks_completed_today ?? '—')}
            sub={`${fleet.sleeping} sleeping`}
            to={routes.tasks()}
          />
          <StatTile
            icon={CircleDollarSign}
            label="spend"
            value={spend.cost < 0.01 && spend.tokens > 0 ? '<$0.01' : `$${spend.cost.toFixed(2)}`}
            sub={`${formatTokenCount(spend.tokens)} tok`}
            to={routes.tasks()}
          />
        </div>

        {/* Reliability + supervisor idle */}
        <div className="grid gap-2 sm:grid-cols-2">
          <section
            aria-label="agent reliability"
            className="rounded border border-border/60 bg-card px-3 py-2"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground/80">
                verification success
              </h2>
              <Link
                to={routes.reliability()}
                className="font-mono text-[10px] text-muted-foreground dark:text-muted-foreground/80 hover:text-primary"
              >
                full dashboard →
              </Link>
            </div>
            {topAgents.length === 0 ? (
              <p className="mt-2 font-mono text-[10px] text-muted-foreground dark:text-muted-foreground/80">no verifications yet</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {topAgents.map((a) => (
                  <li key={a.agent_id} className="flex items-center gap-2 py-1">
                    <Link
                      to={routes.agent(a.agent_id)}
                      className="w-32 truncate py-1 font-mono text-[11px] text-foreground/90 hover:text-primary"
                    >
                      {a.agent_id}
                    </Link>
                    <div
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                      role="meter"
                      aria-valuenow={Math.round(a.success_rate * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${a.agent_id} success rate`}
                    >
                      <div
                        className={cn(
                          'h-full rounded-full',
                          a.success_rate >= 0.9
                            ? 'bg-emerald-500'
                            : a.success_rate >= 0.6
                              ? 'bg-amber-500'
                              : 'bg-red-400'
                        )}
                        style={{ width: `${Math.max(4, a.success_rate * 100)}%` }}
                      />
                    </div>
                    <span className="w-16 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                      {Math.round(a.success_rate * 100)}% · {a.verified + a.failed}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-label="supervisor idle history"
            className="rounded border border-border/60 bg-card px-3 py-2"
          >
            <h2 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground/80">
              supervisor idle (last {idleSeries.length || 0} beats)
            </h2>
            {idleSeries.length < 2 ? (
              <p className="mt-2 font-mono text-[10px] text-muted-foreground dark:text-muted-foreground/80">not enough data</p>
            ) : (
              <Sparkline data={idleSeries} className="mt-2 h-10 w-full text-primary" />
            )}
          </section>
        </div>

        {/* Fleet by project */}
        <section aria-label="fleet by project" className="space-y-2">
          <h2 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-muted-foreground/80">
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
                    {g.activeCount > 0 && <span className="text-emerald-700 dark:text-emerald-500">{g.activeCount} active · </span>}
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

/** Dependency-free inline sparkline (no recharts in the overview bundle). */
function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const w = 200;
  const h = 40;
  const max = Math.max(...data, 1);
  const points = data
    .map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`)
    .join(' ');
  const latest = data[data.length - 1] ?? 0;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label={`supervisor idle seconds, latest ${latest}s, peak ${max}s`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
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
          tone === 'ok' && 'text-emerald-700 dark:text-emerald-500'
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground dark:text-muted-foreground/85">{sub}</p>
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
