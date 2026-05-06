import { Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agentStore';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

const MENTION_REGEX = /@([\w-]+)/g;

/**
 * Splits a text string into parts, highlighting @mentions.
 */
function renderMentionsInText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(MENTION_REGEX)) {
    const mentionFull = match[0];
    const matchIndex = match.index!;

    if (matchIndex > lastIndex) {
      parts.push(<Fragment key={key++}>{text.slice(lastIndex, matchIndex)}</Fragment>);
    }

    const mentionName = match[1];
    parts.push(
      <button
        key={key++}
        className="inline-flex items-center bg-primary/20 text-primary font-medium rounded px-1 py-0.5 text-[0.9em] hover:bg-primary/30 transition-colors cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          useAgentStore.getState().selectAgent(mentionName);
        }}
      >
        {mentionFull}
      </button>
    );

    lastIndex = matchIndex + mentionFull.length;
  }

  if (parts.length === 0) return text;

  if (lastIndex < text.length) {
    parts.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  }

  return <>{parts}</>;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Style code blocks
          pre: ({ children, ...props }) => (
            <pre
              className="bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-md p-3 overflow-x-auto text-xs border border-zinc-200 dark:border-zinc-700"
              {...props}
            >
              {children}
            </pre>
          ),
          code: ({ children, className, ...props }) => {
            const isInline = !className;
            return isInline ? (
              <code
                className="bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded px-1.5 py-0.5 text-xs font-mono border border-zinc-200/60 dark:border-zinc-700/60"
                {...props}
              >
                {children}
              </code>
            ) : (
              <code className="text-xs font-mono" {...props}>
                {children}
              </code>
            );
          },
          // Style links
          a: ({ children, ...props }) => (
            <a
              className="text-primary underline underline-offset-2 hover:text-primary/80"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          ),
          // Style lists
          ul: ({ children, ...props }) => (
            <ul className="list-disc pl-4 space-y-1" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="list-decimal pl-4 space-y-1" {...props}>
              {children}
            </ol>
          ),
          // Style paragraphs
          p: ({ children, ...props }) => (
            <p className="mb-2 last:mb-0" {...props}>
              {children}
            </p>
          ),
          // Highlight @mentions in text nodes
          text: ({ children }) => {
            if (typeof children === 'string' && children.includes('@')) {
              return renderMentionsInText(children);
            }
            return <>{children}</>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
