import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { ArrowLeft, ShieldCheck, AlertOctagon, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';
import { api, type AgentReliability, type FailureLogEntry } from '@/lib/api';
import { cn } from '@/lib/utils';
import { routes } from '@/lib/navigation';

const QUERY_OPTS = {
  staleTime: 60_000,
  refetchOnWindowFocus: false,
} as const;

function successRateColor(rate: number): string {
  if (rate >= 0.9) return 'text-emerald-500';
  if (rate >= 0.6) return 'text-amber-500';
  return 'text-red-400';
}

function successRateBarColor(rate: number): string {
  if (rate >= 0.9) return 'bg-emerald-500';
  if (rate >= 0.6) return 'bg-amber-500';
  return 'bg-red-400';
}

function formatRate(v: number | null): string {
  if (v == null) return '—';
  return `${Math.round(v * 100)}%`;
}

// ── Sparkline tooltip ──────────────────────────────────────────────────────
interface SparkPayload {
  date: string;
  successPct: number | null;
  verified: number;
  failed: number;
}

function SparkTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: SparkPayload }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded border bg-popover px-2 py-1 font-mono text-[10px] shadow-md">
      <div className="font-medium">{d.date}</div>
      <div className="text-muted-foreground">
        {d.successPct == null ? 'no activity' : `${d.successPct}% · ${d.verified + d.failed} runs`}
      </div>
    </div>
  );
}

// ── Per-agent sparkline (real day-bucketed data, not synthetic) ────────────
function Sparkline({ history }: { history: AgentReliability['history'] }) {
  const chartData: SparkPayload[] = useMemo(
    () =>
      history.map((d) => ({
        date: d.date.slice(5), // "MM-DD"
        successPct: d.success_rate == null ? null : Math.round(d.success_rate * 100),
        verified: d.verified,
        failed: d.failed,
      })),
    [history]
  );

  const hasActivity = chartData.some((d) => d.successPct != null);
  if (!hasActivity) {
    return <div className="h-8 w-28 shrink-0 font-mono text-[10px] text-muted-foreground/50">no activity</div>;
  }

  return (
    <div className="h-8 w-28 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="reliabilitySparkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <RechartsTooltip content={<SparkTooltip />} />
          <Area
            type="monotone"
            dataKey="successPct"
            stroke="hsl(var(--primary))"
            strokeWidth={1.5}
            fill="url(#reliabilitySparkGrad)"
            // Sparse history (a single active day, common for young/quiet
            // agents) has nothing for connectNulls to draw a line between —
            // a small dot keeps that one real data point visible instead of
            // the chart silently rendering as blank.
            dot={{ r: 1.5, strokeWidth: 0, fill: 'hsl(var(--primary))' }}
            connectNulls
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Section 1: Leaderboard (success rate + first-pass rate + sparkline) ────
function Leaderboard() {
  const { data: reliability, isLoading } = useQuery({
    queryKey: ['agent-reliability'],
    queryFn: () => api.getAgentReliability(),
    ...QUERY_OPTS,
  });

  const { data: quality } = useQuery({
    queryKey: ['quality-metrics'],
    queryFn: () => api.getQualityMetrics(),
    ...QUERY_OPTS,
  });

  const firstPassByAgent = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const a of quality?.agents ?? []) map.set(a.agent_id, a.first_pass_rate);
    return map;
  }, [quality]);

  const sorted = useMemo(() => {
    return [...(reliability?.agents ?? [])].sort((a, b) => {
      const at = a.verified + a.failed;
      const bt = b.verified + b.failed;
      if (at === 0 && bt === 0) return a.agent_id.localeCompare(b.agent_id);
      return bt - at; // most active first
    });
  }, [reliability]);

  if (isLoading) {
    return <p className="font-mono text-xs text-muted-foreground/60">loading…</p>;
  }

  if (sorted.length === 0) {
    return <p className="font-mono text-xs text-muted-foreground/60">no verification history yet</p>;
  }

  return (
    <div className="overflow-hidden rounded border border-border/60">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/60 bg-muted/40">
            <th className="px-2 py-1.5 text-left font-mono font-medium text-muted-foreground">agent</th>
            <th className="px-2 py-1.5 text-left font-mono font-medium text-muted-foreground">14d trend</th>
            <th className="px-2 py-1.5 text-right font-mono font-medium text-muted-foreground">verified</th>
            <th className="px-2 py-1.5 text-right font-mono font-medium text-muted-foreground">failed</th>
            <th className="px-2 py-1.5 text-right font-mono font-medium text-muted-foreground">success</th>
            <th className="px-2 py-1.5 text-right font-mono font-medium text-muted-foreground">1st pass</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => {
            const total = a.verified + a.failed;
            const firstPass = firstPassByAgent.get(a.agent_id) ?? null;
            return (
              <tr key={a.agent_id} className="border-b border-border/40 last:border-0">
                <td className="px-2 py-1.5 font-mono">
                  <Link to={routes.agent(a.agent_id)} className="text-foreground/90 hover:text-primary hover:underline">
                    {a.agent_id}
                  </Link>
                </td>
                <td className="px-2 py-1.5">
                  <Sparkline history={a.history} />
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{a.verified}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{a.failed}</td>
                <td className="px-2 py-1.5 text-right">
                  {total === 0 ? (
                    <span className="font-mono text-muted-foreground/50">—</span>
                  ) : (
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full', successRateBarColor(a.success_rate))}
                          style={{ width: `${Math.max(4, a.success_rate * 100)}%` }}
                        />
                      </div>
                      <span className={cn('w-9 font-mono tabular-nums font-medium', successRateColor(a.success_rate))}>
                        {formatRate(a.success_rate)}
                      </span>
                    </div>
                  )}
                </td>
                <td className={cn('px-2 py-1.5 text-right font-mono tabular-nums font-medium', firstPass == null ? 'text-muted-foreground/50' : successRateColor(firstPass))}>
                  {formatRate(firstPass)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Section 2: Failure breakdown by type ────────────────────────────────────
function FailureBreakdown({ byType, total }: { byType: Record<string, number>; total: number }) {
  const entries = useMemo(
    () => Object.entries(byType).sort((a, b) => b[1] - a[1]),
    [byType]
  );

  if (total === 0) {
    return (
      <div className="flex items-center gap-1.5 font-mono text-xs text-emerald-500">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        no logged failures
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {entries.map(([type, count]) => (
        <li key={type} className="flex items-center gap-2">
          <span className="w-32 shrink-0 truncate font-mono text-[11px] text-foreground/80">{type}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-red-400"
              style={{ width: `${Math.max(4, (count / total) * 100)}%` }}
            />
          </div>
          <span className="w-6 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{count}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Section 3: Recent failure timeline ──────────────────────────────────────
function FailureRow({ failure }: { failure: FailureLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(failure.commit_sha || failure.root_cause);

  return (
    <li className="border-b border-border/40 py-2 last:border-0">
      <button
        type="button"
        onClick={() => hasDetail && setExpanded((v) => !v)}
        className={cn(
          'flex w-full items-start gap-2 text-left',
          hasDetail && 'cursor-pointer'
        )}
        aria-expanded={hasDetail ? expanded : undefined}
      >
        {hasDetail ? (
          expanded ? (
            <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          )
        ) : (
          <span className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'rounded px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide',
                failure.resolved ? 'bg-muted text-muted-foreground' : 'bg-red-500/15 text-red-400'
              )}
            >
              {failure.failure_type}
            </span>
            <Link
              to={routes.agent(failure.agent_id)}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-[11px] text-foreground/80 hover:text-primary hover:underline"
            >
              {failure.agent_id}
            </Link>
            <span className="font-mono text-[10px] text-muted-foreground/70">
              {formatDistanceToNow(new Date(failure.timestamp), { addSuffix: true })}
            </span>
            {failure.resolved && (
              <span className="font-mono text-[9px] text-emerald-500">resolved</span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-foreground/90" title={failure.description}>
            {failure.description}
          </p>
          {expanded && (
            <div className="mt-1.5 space-y-1 rounded border border-border/40 bg-muted/30 px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
              {failure.commit_sha && (
                <div>
                  commit:{' '}
                  <Link to={`/diff/${failure.commit_sha}`} className="text-primary hover:underline">
                    {failure.commit_sha.slice(0, 10)}
                  </Link>
                </div>
              )}
              {failure.root_cause && (
                <pre className="whitespace-pre-wrap break-words">{failure.root_cause}</pre>
              )}
            </div>
          )}
        </div>
      </button>
    </li>
  );
}

/**
 * P5.3 — Agent reliability dashboard. A dedicated route (not a right-rail
 * tab) since it deserves table + chart real estate: verification success
 * rates with a real 14-day trend sparkline per agent (backed by day-bucketed
 * history the backend now computes from mailbox timestamps — no synthetic
 * data), a failure-type breakdown, and a recent-failures timeline sourced
 * from the `failure_log` table.
 */
export function ReliabilityDashboardPage() {
  const { data: failures } = useQuery({
    queryKey: ['failure-stats'],
    queryFn: () => api.getFailureStats(),
    ...QUERY_OPTS,
  });

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center gap-2">
          <Link
            to={routes.overview()}
            className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden />
            overview
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            agent reliability
          </h1>
        </div>

        <section aria-label="reliability leaderboard" className="space-y-2">
          <h2 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            verification leaderboard
          </h2>
          <Leaderboard />
        </section>

        <section aria-label="failure breakdown" className="rounded border border-border/60 bg-card px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            <AlertOctagon className="h-3 w-3" aria-hidden />
            failures by type{failures ? ` (${failures.total})` : ''}
          </div>
          <FailureBreakdown byType={failures?.by_type ?? {}} total={failures?.total ?? 0} />
        </section>

        <section aria-label="recent failures" className="rounded border border-border/60 bg-card px-3 py-2.5">
          <h2 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            recent failures
          </h2>
          {!failures || failures.recent.length === 0 ? (
            <p className="mt-2 font-mono text-[10px] text-muted-foreground/60">none logged</p>
          ) : (
            <ul className="mt-1">
              {failures.recent.map((f) => (
                <FailureRow key={f.id} failure={f} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
