import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { api } from '@/lib/api';
import { PRICING } from '@/lib/pricing';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, TrendingUp, Zap, DollarSign } from 'lucide-react';

function computeDayCost(day: {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}): number {
  return (
    (day.input_tokens / 1_000_000) * PRICING.input +
    (day.output_tokens / 1_000_000) * PRICING.output +
    (day.cache_read_tokens / 1_000_000) * PRICING.cache_read +
    (day.cache_creation_tokens / 1_000_000) * PRICING.cache_creation
  );
}

function formatCost(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v < 0.001) return '<$0.001';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function formatRate(v: number): string {
  if (v >= 0.995) return '100%';
  return `${(v * 100).toFixed(0)}%`;
}

function successRateColor(rate: number): string {
  if (rate >= 0.8) return 'text-green-700 dark:text-green-400';
  if (rate >= 0.5) return 'text-yellow-700 dark:text-yellow-400';
  return 'text-red-700 dark:text-red-400';
}

function firstPassColor(rate: number | null): string {
  if (rate == null) return 'text-muted-foreground';
  if (rate >= 0.8) return 'text-green-700 dark:text-green-400';
  if (rate >= 0.5) return 'text-yellow-700 dark:text-yellow-400';
  return 'text-red-700 dark:text-red-400';
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${m}m`;
}

function budgetBarColor(pct: number): string {
  if (pct >= 0.8) return 'bg-red-500';
  if (pct >= 0.6) return 'bg-yellow-500';
  return 'bg-green-500';
}

const QUERY_OPTS = {
  staleTime: 60_000,
  refetchInterval: 60_000,
  refetchOnWindowFocus: true,
} as const;

// ── Custom tooltip for the sparkline ─────────────────────────────────────────
interface SparkTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function SparkTooltip({ active, payload, label }: SparkTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border bg-popover px-2 py-1 text-xs shadow-md">
      <div className="font-medium">{label}</div>
      <div className="text-muted-foreground">{formatCost(payload[0].value)}</div>
    </div>
  );
}

// ── Section A: Budget Overview ────────────────────────────────────────────────
function BudgetOverview() {
  const { data: status } = useQuery({
    queryKey: ['budget-status'],
    queryFn: () => api.getBudgetStatus(),
    ...QUERY_OPTS,
  });

  const { data: daily } = useQuery({
    queryKey: ['budget-daily'],
    queryFn: () => api.getBudgetDaily(),
    ...QUERY_OPTS,
  });

  const chartData = useMemo(() => {
    if (!daily?.days) return [];
    const last7 = [...daily.days].reverse().slice(-7);
    return last7.map((d) => ({
      date: d.date.slice(5), // "MM-DD"
      cost: parseFloat(computeDayCost(d).toFixed(4)),
    }));
  }, [daily]);

  const pct = status ? status.percentage_used : 0;
  const barWidth = Math.min(pct * 100, 100);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <DollarSign className="h-3 w-3" />
        Budget
      </div>

      {status?.throttled && (
        <div className="flex items-center gap-2 rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Budget throttled — low-priority tasks deferred
        </div>
      )}

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatCost(status?.daily_spend_usd)} / {formatCost(status?.budget_limit_usd)}</span>
          <span className={pct >= 0.8 ? 'text-red-700 dark:text-red-400 font-medium' : pct >= 0.6 ? 'text-yellow-700 dark:text-yellow-400' : ''}>
            {(pct * 100).toFixed(1)}%
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${budgetBarColor(pct)}`}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>

      {/* 7-day sparkline */}
      {chartData.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">7-day spend</div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${v.toFixed(2)}`}
                  width={36}
                />
                <Tooltip content={<SparkTooltip />} />
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.5}
                  fill="url(#sparkGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section B: Agent Quality Table ────────────────────────────────────────────
function QualityTable() {
  const { data, isLoading } = useQuery({
    queryKey: ['quality-metrics'],
    queryFn: () => api.getQualityMetrics(),
    ...QUERY_OPTS,
  });

  const { data: durationData } = useQuery({
    queryKey: ['quality-duration'],
    queryFn: () => api.getQualityDuration(),
    ...QUERY_OPTS,
  });

  const sorted = useMemo(() => {
    if (!data?.agents) return [];
    return [...data.agents].sort((a, b) => {
      const av = a.completions_per_dollar ?? -1;
      const bv = b.completions_per_dollar ?? -1;
      return bv - av;
    });
  }, [data]);

  if (isLoading) {
    return <div className="text-xs text-muted-foreground py-4 text-center">Loading…</div>;
  }

  if (!sorted.length) {
    return <div className="text-xs text-muted-foreground py-4 text-center">No agent data yet</div>;
  }

  const best = data?.summary?.most_cost_effective_agent;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <Zap className="h-3 w-3" />
        Agent Quality
      </div>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Agent</th>
              <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Done</th>
              <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Fail</th>
              <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Cost</th>
              <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">$/comp</th>
              <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Rate</th>
              <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">1st Pass</th>
              <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Avg Dur</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent) => (
              <tr
                key={agent.agent_id}
                className={`border-b last:border-0 ${agent.agent_id === best ? 'bg-green-500/5' : ''}`}
              >
                <td className="px-2 py-1.5 font-mono truncate max-w-[100px]" title={agent.agent_id}>
                  {agent.agent_id === best && (
                    <span className="mr-1 text-green-700 dark:text-green-400">★</span>
                  )}
                  {agent.agent_id}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{agent.completions}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{agent.failures}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-mono">{formatCost(agent.total_cost_usd)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-mono text-muted-foreground">
                  {agent.cost_per_completion_usd != null ? formatCost(agent.cost_per_completion_usd) : '—'}
                </td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${successRateColor(agent.success_rate)}`}>
                  {formatRate(agent.success_rate)}
                </td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${firstPassColor(agent.first_pass_rate)}`}>
                  {agent.first_pass_rate != null ? formatRate(agent.first_pass_rate) : '—'}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                  {durationData?.agents[agent.agent_id]
                    ? formatDuration(durationData.agents[agent.agent_id].avg_seconds)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          {data?.summary && (
            <tfoot>
              <tr className="bg-muted/30 border-t">
                <td className="px-2 py-1.5 font-medium text-muted-foreground">Total</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium">{data.summary.total_completions}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{data.summary.total_failures}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-mono font-medium">{formatCost(data.summary.total_cost_usd)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-mono text-muted-foreground">
                  {formatCost(data.summary.system_cost_per_completion_usd)}
                </td>
                <td className="px-2 py-1.5" />
                <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${firstPassColor(data.summary.system_first_pass_rate)}`}>
                  {data.summary.system_first_pass_rate != null ? formatRate(data.summary.system_first_pass_rate) : '—'}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                  {durationData?.overall_avg != null ? formatDuration(durationData.overall_avg) : '—'}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Section C: System Summary ─────────────────────────────────────────────────
function SystemSummary() {
  const { data } = useQuery({
    queryKey: ['quality-metrics'],
    queryFn: () => api.getQualityMetrics(),
    ...QUERY_OPTS,
  });

  if (!data?.summary) return null;

  const { summary } = data;

  const cards = [
    { label: 'Total cost', value: formatCost(summary.total_cost_usd) },
    { label: 'Completions', value: String(summary.total_completions) },
    { label: 'Cost/completion', value: formatCost(summary.system_cost_per_completion_usd) },
    { label: '1st pass rate', value: summary.system_first_pass_rate != null ? formatRate(summary.system_first_pass_rate) : '—' },
    { label: 'Best agent', value: summary.most_cost_effective_agent ?? '—' },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <TrendingUp className="h-3 w-3" />
        System Summary
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(({ label, value }) => (
          <div key={label} className="rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-sm font-mono font-medium truncate" title={value}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function ObservabilityPanel() {
  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-5">
        <BudgetOverview />
        <div className="border-t" />
        <QualityTable />
        <div className="border-t" />
        <SystemSummary />
      </div>
    </ScrollArea>
  );
}
