import { useState } from 'react';
import { HelpCircle, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PendingQuestion } from '@/lib/api';

interface QuestionCardProps {
  question: PendingQuestion;
  /** Sends the answer back to the agent as a plain chat message — reuses
   * the exact same delivery path as a normal typed message (opencode
   * accepts an option's label typed as a normal prompt while the
   * question tool is pending). No separate answer-delivery mechanism. */
  onAnswer: (answerText: string) => void;
  isSubmitting: boolean;
}

/**
 * Renders a pending opencode `question` tool call with clickable options,
 * so it can actually be answered from the dashboard instead of only being
 * visible (or not visible at all) in the terminal.
 *
 * opencode's question tool accepts an array of questions per call, but
 * every real example observed so far has exactly one — rendering just
 * the first is a deliberate simplification, not a truncation bug.
 */
export function QuestionCard({ question, onAnswer, isSubmitting }: QuestionCardProps) {
  const first = question.questions[0];
  const isMultiple = !!first?.multiple;
  const [selected, setSelected] = useState<string[]>([]);

  if (!first) return null;

  const toggleOption = (label: string) => {
    if (isSubmitting) return;
    if (!isMultiple) {
      onAnswer(label);
      return;
    }
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const submitMultiple = () => {
    if (selected.length === 0) return;
    // Matches the comma-separated format opencode's own tool_output
    // shows for a real multi-select answer (e.g. "Activate projects
    // only, Set up permanent teams").
    onAnswer(selected.join(', '));
  };

  return (
    <div className="mx-4 mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-500" />
        <div className="flex-1 space-y-2">
          <div>
            {first.header && (
              <div className="text-[10px] font-mono uppercase tracking-wide text-amber-800/70 dark:text-amber-400/70">
                {first.header}
              </div>
            )}
            <p className="text-sm font-medium text-foreground">{first.question}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            {first.options.map((opt) => {
              const isSelected = selected.includes(opt.label);
              return (
                <button
                  key={opt.label}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => toggleOption(opt.label)}
                  className={cn(
                    'flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                    isSelected
                      ? 'border-amber-600 bg-amber-500/20'
                      : 'border-border bg-background hover:bg-accent'
                  )}
                >
                  {isMultiple && (
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        isSelected ? 'border-amber-600 bg-amber-600 text-white' : 'border-muted-foreground/40'
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                  )}
                  <span className="flex-1">
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && (
                      <span className="block text-xs text-muted-foreground">{opt.description}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {isMultiple && (
            <Button
              size="sm"
              onClick={submitMultiple}
              disabled={selected.length === 0 || isSubmitting}
              className="gap-1.5"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Submit ({selected.length} selected)
            </Button>
          )}

          {!isMultiple && isSubmitting && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Sending answer…
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            Or just type your own answer below instead.
          </p>
        </div>
      </div>
    </div>
  );
}
