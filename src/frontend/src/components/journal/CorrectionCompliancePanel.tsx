import { useCorrectionCompliance } from '@/hooks/useJournal';
import { Badge } from '../ui/badge';
import { ShieldCheck } from 'lucide-react';

function complianceColor(rate: number): string {
  if (rate >= 90) return 'text-green-700 dark:text-green-400';
  if (rate >= 70) return 'text-yellow-700 dark:text-yellow-400';
  return 'text-red-700 dark:text-red-400';
}

export function CorrectionCompliancePanel() {
  const { data, isLoading } = useCorrectionCompliance();

  if (isLoading) {
    return <div className="text-xs text-muted-foreground py-2 text-center">Loading...</div>;
  }

  if (!data?.corrections.length) {
    return <div className="text-xs text-muted-foreground py-2 text-center">No correction rules tracked</div>;
  }

  const sorted = [...data.corrections].sort((a, b) => a.compliance_rate - b.compliance_rate).slice(0, 8);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <ShieldCheck className="h-3 w-3" />
        Correction Compliance
        <span className={`ml-auto text-sm font-bold ${complianceColor(data.overall_compliance)}`}>
          {data.overall_compliance.toFixed(0)}%
        </span>
      </div>
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Category</th>
              <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Rule</th>
              <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Violations</th>
              <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">Compliance</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-2 py-1.5">
                  <Badge variant="outline" className="text-[10px] font-normal">{c.category}</Badge>
                </td>
                <td className="px-2 py-1.5 truncate max-w-[180px]" title={c.rule}>{c.rule}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{c.violations}</td>
                <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${complianceColor(c.compliance_rate)}`}>
                  {c.compliance_rate.toFixed(0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
