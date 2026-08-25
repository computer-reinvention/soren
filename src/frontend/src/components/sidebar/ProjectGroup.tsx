import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { AgentRow } from './AgentRow';
import type { ProjectGroupData } from './sidebar-utils';

interface ProjectGroupProps {
  group: ProjectGroupData;
  tokensByAgent: Map<string, number>;
  /** Force-open (used while searching so matches are visible). */
  forceOpen?: boolean;
}

/**
 * One project, one collapsible group: header with live counts, supervisor
 * pinned first, then the project's agents. That's the whole hierarchy.
 */
export function ProjectGroup({ group, tokensByAgent, forceOpen = false }: ProjectGroupProps) {
  const [isOpen, setIsOpen] = useState(true);
  const open = forceOpen || isOpen;
  const total = group.agents.length + (group.supervisor ? 1 : 0);

  return (
    <Collapsible open={open} onOpenChange={setIsOpen}>
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-1.5 rounded px-1.5 py-1',
          'hover:bg-accent/40 transition-colors'
        )}
        // See AgentRow.tsx's aria-label comment — same accepted tradeoff
        // with axe's zero-weight label-content-name-mismatch rule.
        aria-label={
          `${group.name} project, ${total} agents` +
          (group.attentionCount > 0 ? `, ${group.attentionCount} need attention` : '')
        }
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
            open && 'rotate-90'
          )}
          aria-hidden
        />
        <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {group.name}
        </span>
        {group.isSystem && (
          <span className="shrink-0 rounded-sm border border-primary/40 px-1 font-mono text-[9px] uppercase leading-4 text-primary">
            sys
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[9px] tabular-nums text-muted-foreground dark:text-muted-foreground/85">
          {group.attentionCount > 0 && (
            <span className="text-red-400">{group.attentionCount}!</span>
          )}
          {group.activeCount > 0 && (
            <span className="text-emerald-700 dark:text-emerald-500">{group.activeCount}●</span>
          )}
          <span>{total}</span>
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="ml-2 border-l border-border/40 pl-1.5 py-0.5 space-y-px">
          {group.supervisor && (
            <AgentRow
              agent={group.supervisor}
              isSupervisor
              tokens={tokensByAgent.get(group.supervisor.id)}
            />
          )}
          {group.agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} tokens={tokensByAgent.get(agent.id)} />
          ))}
          {total === 0 && (
            <p className="px-2 py-1 font-mono text-[10px] text-muted-foreground dark:text-muted-foreground/80">
              no agents
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
