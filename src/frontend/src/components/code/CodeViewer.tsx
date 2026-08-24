import { useEffect, useMemo, useRef, useState } from 'react';
import { codeToHtml } from 'shiki/bundle/web';
import { ChevronDown, ChevronUp, Search, WrapText, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { languageFromFilename } from '@/lib/syntax';

interface CodeViewerProps {
  code: string;
  filename: string;
  className?: string;
}

/**
 * Syntax-highlighted file viewer with line numbers and in-file search
 * (P3.1). Reuses shiki (already installed for chat code blocks, P0.2) —
 * shiki wraps every line in `<span class="line">`, so line numbers are a
 * pure-CSS counter with no extra parsing.
 *
 * Search is line-granular (find → scroll → flash), not token-granular: it
 * locates matching lines by scanning the raw source, then highlights the
 * corresponding rendered `.line` element by index. Simple, and correct as
 * long as line count in the DOM matches line count in the source — which
 * it always does, since shiki emits exactly one `.line` per source line.
 */
export function CodeViewer({ code, filename, className }: CodeViewerProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [wrap, setWrap] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const lang = useMemo(() => languageFromFilename(filename), [filename]);
  const lines = useMemo(() => code.split('\n'), [code]);

  useEffect(() => {
    if (!lang) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    codeToHtml(code, { lang, theme: 'github-dark-default' })
      .then((result) => { if (!cancelled) setHtml(result); })
      .catch(() => { if (!cancelled) setHtml(null); });
    return () => { cancelled = true; };
  }, [code, lang]);

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const result: number[] = [];
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(q)) result.push(i);
    });
    return result;
  }, [lines, query]);

  // Clamp match index and scroll/flash the active match whenever it changes.
  useEffect(() => {
    if (matches.length === 0) return;
    const clamped = ((matchIndex % matches.length) + matches.length) % matches.length;
    const lineEls = containerRef.current?.querySelectorAll<HTMLElement>('.line');
    const target = lineEls?.[matches[clamped]];
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('code-line-flash');
      const timer = setTimeout(() => target.classList.remove('code-line-flash'), 900);
      return () => clearTimeout(timer);
    }
  }, [matches, matchIndex]);

  // Cmd/Ctrl+F opens in-viewer search instead of the browser's find bar.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };
    const el = containerRef.current?.closest('[data-code-viewer-root]');
    el?.addEventListener('keydown', onKeyDown as EventListener);
    return () => el?.removeEventListener('keydown', onKeyDown as EventListener);
  }, [searchOpen]);

  return (
    <div data-code-viewer-root tabIndex={-1} className={cn('flex flex-col outline-none', className)}>
      <div className="flex items-center gap-1 border-b border-border/50 bg-muted/20 px-2 py-1">
        <button
          onClick={() => setSearchOpen((v) => !v)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title="Search in file (⌘F)"
        >
          <Search className="h-3 w-3" aria-hidden />
          find
        </button>
        <button
          onClick={() => setWrap((v) => !v)}
          className={cn(
            'flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors',
            wrap ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
          title="Toggle word wrap"
          aria-pressed={wrap}
        >
          <WrapText className="h-3 w-3" aria-hidden />
          wrap
        </button>
        {searchOpen && (
          <div className="ml-1 flex flex-1 items-center gap-1">
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setMatchIndex(0); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setMatchIndex((i) => i + (e.shiftKey ? -1 : 1));
              }}
              placeholder="find in file…"
              className="h-5 flex-1 rounded border border-border/60 bg-background px-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="w-14 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
              {matches.length > 0 ? `${(matchIndex % matches.length + matches.length) % matches.length + 1}/${matches.length}` : '0/0'}
            </span>
            <button
              onClick={() => setMatchIndex((i) => i - 1)}
              disabled={matches.length === 0}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
              aria-label="previous match"
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              onClick={() => setMatchIndex((i) => i + 1)}
              disabled={matches.length === 0}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
              aria-label="next match"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            <button
              onClick={() => setSearchOpen(false)}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="close search"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        className={cn(
          'code-viewer-lines flex-1 overflow-auto text-xs font-mono leading-5',
          wrap && 'code-viewer-wrap'
        )}
      >
        {html ? (
          <div
            className="[&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_code]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="p-0 m-0">
            <code>
              {lines.map((line, i) => (
                <span key={i} className="line block px-0">
                  {line || '\u00A0'}
                </span>
              ))}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
}
