import { Fragment, useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agentStore';
import { Copy, Check } from 'lucide-react';
import { codeToHtml, type BundledLanguage } from 'shiki';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

const MENTION_REGEX = /@([\w-]+)/g;

// Languages to support — add more as needed, shiki lazy-loads grammars
const SUPPORTED_LANGS = new Set<string>([
  'javascript', 'js', 'typescript', 'ts', 'tsx', 'jsx',
  'python', 'py', 'bash', 'sh', 'shell', 'zsh',
  'json', 'yaml', 'yml', 'toml', 'css', 'html', 'xml',
  'sql', 'rust', 'go', 'c', 'cpp', 'java', 'ruby', 'rb',
  'markdown', 'md', 'diff', 'dockerfile', 'makefile',
]);

function normalizeLanguage(lang: string | undefined): BundledLanguage | null {
  if (!lang) return null;
  const l = lang.toLowerCase().replace('language-', '');
  // Map aliases
  const aliases: Record<string, string> = {
    js: 'javascript', ts: 'typescript', py: 'python',
    sh: 'bash', shell: 'bash', zsh: 'bash',
    yml: 'yaml', rb: 'ruby', md: 'markdown',
  };
  const resolved = aliases[l] || l;
  return SUPPORTED_LANGS.has(l) || SUPPORTED_LANGS.has(resolved)
    ? (resolved as BundledLanguage)
    : null;
}

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

/** Copy-to-clipboard button for code blocks */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 hover:bg-background border border-border/50 text-muted-foreground hover:text-foreground transition-all opacity-0 group-hover:opacity-100"
      title={copied ? 'Copied!' : 'Copy code'}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-status-green" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

/** Syntax-highlighted code block using shiki */
function HighlightedCode({ code, language, className }: { code: string; language: string | undefined; className?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const lang = normalizeLanguage(language);

  useEffect(() => {
    if (!lang) {
      setHtml(null);
      return;
    }

    let cancelled = false;

    codeToHtml(code, {
      lang,
      theme: 'github-dark-default',
    }).then((result) => {
      if (!cancelled) setHtml(result);
    }).catch(() => {
      if (!cancelled) setHtml(null);
    });

    return () => { cancelled = true; };
  }, [code, lang]);

  if (html) {
    return (
      <div
        className={cn('shiki-wrapper text-xs font-mono [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_code]:!bg-transparent', className)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Fallback: plain code
  return (
    <code className={cn('text-xs font-mono', className)}>
      {code}
    </code>
  );
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn('prose prose-sm dark:prose-invert max-w-none', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Code blocks with syntax highlighting and copy button
          pre: ({ children, ...props }) => {
            // Extract code text for copy button
            const codeElement = (children as React.ReactElement)?.props;
            const codeText = typeof codeElement?.children === 'string' ? codeElement.children : '';

            return (
              <div className="group relative">
                <pre
                  className="bg-card rounded-md p-3 overflow-x-auto text-xs border border-border font-mono"
                  {...props}
                >
                  {children}
                </pre>
                {codeText && <CopyButton text={codeText.replace(/\n$/, '')} />}
              </div>
            );
          },
          code: ({ children, className: codeClassName, ...props }) => {
            const isInline = !codeClassName;
            const language = codeClassName?.replace('language-', '');
            const codeString = typeof children === 'string' ? children : String(children || '');

            return isInline ? (
              <code
                className="bg-card text-foreground rounded px-1.5 py-0.5 text-xs font-mono border border-border/60"
                {...props}
              >
                {children}
              </code>
            ) : (
              <HighlightedCode
                code={codeString.replace(/\n$/, '')}
                language={language}
              />
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
          // Style tables for Terminal Console look
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto my-2">
              <table className="w-full text-xs font-mono border-collapse" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="border-b border-border" {...props}>
              {children}
            </thead>
          ),
          th: ({ children, ...props }) => (
            <th className="text-left text-2xs uppercase tracking-wider text-muted-foreground font-medium px-2 py-1.5" {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="px-2 py-1.5 border-b border-border/50 text-xs" {...props}>
              {children}
            </td>
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
