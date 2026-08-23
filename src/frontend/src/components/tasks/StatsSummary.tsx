import { cn } from '@/lib/utils';
import { ALL_STATUSES, STATUS_CONFIGS } from './task-utils';

/** Per-status count strip shown above the task list. */
export function StatsSummary({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (total === 0) return null;
  const items = ALL_STATUSES.filter((s) => counts[s]).map((s) => ({
    status: s,
    count: counts[s],
    config: STATUS_CONFIGS[s],
  }));

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-[10px] flex-wrap">
      <span className="text-muted-foreground font-medium">{total} total</span>
      <span className="text-border">|</span>
      {items.map(({ status, count, config }) => (
        <span key={status} className="inline-flex items-center gap-1 text-muted-foreground">
          <span className={cn('w-1.5 h-1.5 rounded-full', config.dot)} />
          {count} {config.label.toLowerCase()}
        </span>
      ))}
    </div>
  );
}
