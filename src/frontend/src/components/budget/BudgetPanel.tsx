import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatTokenCount } from '@/lib/utils';
import { PRICING } from '@/lib/pricing';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Coins } from 'lucide-react';

function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

/**
 * Compact cost statusline for the header.
 * Shows total cost + total tokens, with breakdown on hover.
 * When budget is throttled, the Coins icon turns red with a pulsing dot.
 */
export function BudgetStatusline() {
  const { data: budgetData } = useQuery({
    queryKey: ['budget'],
    queryFn: () => api.getBudget(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const { data: statusData } = useQuery({
    queryKey: ['budget-status'],
    queryFn: () => api.getBudgetStatus(),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const totals = useMemo(() => {
    if (!budgetData?.agents || budgetData.agents.length === 0) return null;
    return budgetData.agents.reduce(
      (acc, a) => ({
        input: acc.input + a.input_tokens,
        output: acc.output + a.output_tokens,
        cache_read: acc.cache_read + a.cache_read_tokens,
        cache_write: acc.cache_write + a.cache_creation_tokens,
      }),
      { input: 0, output: 0, cache_read: 0, cache_write: 0 }
    );
  }, [budgetData]);

  if (!totals) return null;

  const totalTokens = totals.input + totals.output;
  const totalCost =
    (totals.input / 1_000_000) * PRICING.input +
    (totals.output / 1_000_000) * PRICING.output +
    (totals.cache_read / 1_000_000) * PRICING.cache_read +
    (totals.cache_write / 1_000_000) * PRICING.cache_creation;

  const throttled = statusData?.throttled ?? false;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono cursor-default">
          <span className="relative inline-flex items-center">
            <Coins className={`h-3 w-3 ${throttled ? 'text-red-500' : ''}`} />
            {throttled && (
              <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            )}
          </span>
          <span className={throttled ? 'text-red-500 font-medium' : ''}>{formatCost(totalCost)}</span>
          <span className="opacity-50">·</span>
          <span>{formatTokenCount(totalTokens)} tok</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs font-mono">
        <div className="space-y-0.5">
          {throttled && (
            <div className="text-red-500 font-medium pb-1 border-b border-border mb-1">
              ⚠ Budget throttled
            </div>
          )}
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Input</span>
            <span>{formatTokenCount(totals.input)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Output</span>
            <span>{formatTokenCount(totals.output)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Cache read</span>
            <span>{formatTokenCount(totals.cache_read)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Cache write</span>
            <span>{formatTokenCount(totals.cache_write)}</span>
          </div>
          {statusData && (
            <div className="flex justify-between gap-4 pt-1 border-t border-border mt-1">
              <span className="text-muted-foreground">Daily budget</span>
              <span>{(statusData.percentage_used * 100).toFixed(1)}% used</span>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
