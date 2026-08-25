import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWeeklySummary } from '@/hooks/useJournal';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

function formatWeekLabel(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(s)} – ${fmt(e)}`;
}

export function WeeklySummaryCards() {
  const [weeksAgo, setWeeksAgo] = useState(0);
  const { data, isLoading } = useWeeklySummary(weeksAgo);

  if (isLoading) {
    return <div className="text-xs text-muted-foreground py-2 text-center">Loading...</div>;
  }

  if (!data) {
    return <div className="text-xs text-muted-foreground py-2 text-center">No summary available</div>;
  }

  const cards = [
    { label: 'Entries', value: String(data.total_entries) },
    { label: 'Commits', value: String(data.commit_count) },
    { label: 'Tasks done', value: String(data.task_completions) },
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <CalendarDays className="h-3 w-3" />
          Weekly Summary
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => setWeeksAgo((w) => w + 1)}
          >
            <ChevronLeft className="h-3 w-3" />
            <span className="sr-only">Previous week</span>
          </Button>
          <span className="text-[10px] text-muted-foreground min-w-[100px] text-center">
            {formatWeekLabel(data.week_start, data.week_end)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => setWeeksAgo((w) => Math.max(0, w - 1))}
            disabled={weeksAgo === 0}
          >
            <ChevronRight className="h-3 w-3" />
            <span className="sr-only">Next week</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {cards.map(({ label, value }) => (
          <div key={label} className="rounded-md border bg-muted/30 px-2 py-1.5 text-center">
            <div className="text-sm font-mono font-medium">{value}</div>
            <div className="text-[10px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {data.top_tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {data.top_tags.map((t) => (
            <Badge key={t.tag} variant="secondary" className="text-[10px]">
              {t.tag} ({t.count})
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
