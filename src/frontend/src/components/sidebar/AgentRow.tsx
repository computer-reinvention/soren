import { NavLink } from 'react-router-dom';
import { cn, formatTokenCount, getAgentBadgeLabel, getAgentBadgeColor } from '@/lib/utils';
import { routes } from '@/lib/navigation';
import { STATUS_DOT, relativeActivity } from './sidebar-utils';
import type { Agent } from '@/types/agent';

interface AgentRowProps {
  agent: Agent;
  /** Pinned supervisor variant: subtle emphasis, always at the top. */
  isSupervisor?: boolean;
  /** Shown as a tooltip only — row space belongs to the name. */
  tokens?: number;
}

/**
 * One agent, one row, one link. Status dot + mono name + tier badge +
 * activity age + token count. Active state comes from the router (NavLink),
 * not from a selection store.
 */
export function AgentRow({ agent, isSupervisor = false, tokens }: AgentRowProps) {
  const isWorking = agent.status === 'IN_PROGRESS' || agent.status === 'TESTING';
  const needsAttention = agent.status === 'BLOCKED' || agent.status === 'FAILED';
  const isSleeping = agent.status === 'SLEEPING';
  const displayName = agent.display_name || agent.name;
  const badge = getAgentBadgeLabel(agent);
  const age = relativeActivity(agent.last_activity);

  return (
    <NavLink
      to={routes.agent(agent.id)}
      className={({ isActive }) =>
        cn(
          'group flex w-full items-center gap-2 rounded px-2 py-1 text-left',
          'compact:py-0.5',
          'hover:bg-accent/60 transition-colors',
          isActive && 'bg-accent',
          isSleeping && 'opacity-55'
        )
      }
      // Deliberately richer than the visible text (name + tiny badge + age):
      // includes the full status word so screen reader users get the same
      // information sighted users get from the colored status dot alone.
      // axe's label-content-name-mismatch rule (zero-weight, doesn't affect
      // the Lighthouse score) flags any aria-label that isn't near-verbatim
      // visible text — accepted tradeoff, since trimming this down to
      // satisfy it would mean silently dropping the status for AT users.
      aria-label={`${displayName} — ${agent.status.toLowerCase().replace('_', ' ')}`}
      title={tokens ? `${displayName} · ${formatTokenCount(tokens)} tok` : displayName}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          STATUS_DOT[agent.status] ?? 'bg-muted-foreground/50',
          isWorking && 'animate-pulse motion-reduce:animate-none'
        )}
        aria-hidden
      />
      <span
        className={cn(
          'flex-1 truncate font-mono text-xs',
          isSupervisor ? 'font-semibold text-foreground' : 'text-foreground/90',
          needsAttention && 'text-red-700 dark:text-red-400'
        )}
      >
        {displayName}
      </span>
      {badge && (
        <span
          className={cn(
            'shrink-0 rounded-sm border px-1 font-mono text-[9px] uppercase leading-4',
            getAgentBadgeColor(badge)
          )}
        >
          {badge}
        </span>
      )}
      {age && (
        <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground dark:text-muted-foreground/80 w-6 text-right">
          {age}
        </span>
      )}
    </NavLink>
  );
}
