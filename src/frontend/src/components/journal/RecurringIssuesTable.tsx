import { useRecurringIssues } from '@/hooks/useJournal';
import { AlertTriangle } from 'lucide-react';

export function RecurringIssuesTable() {
  const { data, isLoading } = useRecurringIssues();

  if (isLoading) {
    return <div className="text-xs text-muted-foreground py-2 text-center">Loading...</div>;
  }

  if (!data?.recurring_issues.length) {
    return <div className="text-xs text-muted-foreground py-2 text-center">No recurring issues detected</div>;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <AlertTriangle className="h-3 w-3" />
        Recurring Issues
      </div>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Issue</th>
              <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Hits</th>
              <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Days</th>
            </tr>
          </thead>
          <tbody>
            {data.recurring_issues.slice(0, 8).map((issue) => (
              <tr key={issue.canonical_title} className="border-b last:border-0">
                <td
                  className="px-2 py-1.5 truncate max-w-[200px]"
                  title={issue.variant_titles.join(', ')}
                >
                  {issue.canonical_title}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{issue.occurrences}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{issue.distinct_dates}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
