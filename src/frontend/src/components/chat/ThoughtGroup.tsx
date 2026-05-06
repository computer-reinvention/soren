import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Brain, ChevronRight } from 'lucide-react';
import type { Thought } from '@/stores/thoughtStore';

interface ThoughtGroupProps {
  thoughts: Thought[];
}

export function ThoughtGroup({ thoughts }: ThoughtGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const reasoningThoughts = thoughts.filter(
    (t) => t.thought_type === 'reasoning' && t.content
  );

  if (reasoningThoughts.length === 0) return null;

  const firstLine = reasoningThoughts[0].content?.split('\n')[0] || '';
  const preview =
    firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine;

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex items-center gap-1.5 text-[11px] rounded-md px-2 py-0.5',
          'text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted/50 transition-colors'
        )}
      >
        <Brain className="h-3 w-3 text-purple-500/70" />
        <span>
          {reasoningThoughts.length} thought
          {reasoningThoughts.length !== 1 ? 's' : ''}
        </span>
        {!isExpanded && (
          <span className="text-muted-foreground/40 truncate max-w-[200px] italic">
            {preview}
          </span>
        )}
        <ChevronRight
          className={cn(
            'h-3 w-3 transition-transform',
            isExpanded && 'rotate-90'
          )}
        />
      </button>

      {isExpanded && (
        <div className="mt-1 ml-1 pl-2 border-l-2 border-purple-500/20 space-y-1 animate-in slide-in-from-top-1 duration-150">
          {reasoningThoughts.map((thought) => (
            <ThoughtItem key={thought.id} thought={thought} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThoughtItem({ thought }: { thought: Thought }) {
  return (
    <p className="text-[11px] text-muted-foreground/50 italic py-0.5 whitespace-pre-wrap">
      {thought.content}
    </p>
  );
}
