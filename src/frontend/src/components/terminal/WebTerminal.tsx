import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { RotateCw, Search, X, ChevronUp, ChevronDown, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TERMINAL_WS_URL, TERMINAL_PING_INTERVAL } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useTerminalStore, type TerminalMode } from '@/stores/terminalStore';
import { useTerminalSettingsStore } from '@/stores/terminalSettingsStore';
import { useIsMobile } from '@/hooks/use-mobile';

type ConnectionStatus = 'connecting' | 'connected' | 'closed';

// Keys a phone keyboard doesn't have but a real shell session needs
// constantly — Ctrl+C to interrupt a hung command is the single most
// important one for "fix something while soren is misbehaving, from a
// phone" use. Sent through the exact same PTY input channel as a real
// keystroke (see sendRaw below / term.onData), so this is indistinguishable
// from typing them on a physical keyboard as far as the shell is concerned.
const MOBILE_KEYS: Array<{ label: string; data: string; title: string }> = [
  { label: 'Esc', data: '\x1b', title: 'Escape' },
  { label: 'Tab', data: '\t', title: 'Tab' },
  { label: '^C', data: '\x03', title: 'Ctrl+C — interrupt' },
  { label: '^D', data: '\x04', title: 'Ctrl+D — EOF' },
  { label: '^L', data: '\x0c', title: 'Ctrl+L — clear' },
  { label: '↑', data: '\x1b[A', title: 'Up — history' },
  { label: '↓', data: '\x1b[B', title: 'Down' },
  { label: '←', data: '\x1b[D', title: 'Left' },
  { label: '→', data: '\x1b[C', title: 'Right' },
];

const MONO_FONT_STACK =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Cascadia Mono', 'Roboto Mono', Consolas, monospace";

// zinc-950 bg / zinc-100 fg — matches the TerminalView aesthetic
const TERM_THEME = {
  background: '#09090b', // zinc-950
  foreground: '#f4f4f5', // zinc-100
  cursor: '#f4f4f5',
  cursorAccent: '#09090b',
  selectionBackground: '#3f3f46', // zinc-700
};

function closeMessage(code: number): string {
  switch (code) {
    case 4401:
      return 'Session expired — log in again.';
    case 4429:
      return 'Too many terminals open — close one and retry.';
    default:
      return `Disconnected (code ${code}).`;
  }
}

interface WebTerminalProps {
  /** Whether the terminal is currently visible (not display:none). */
  active: boolean;
}

/**
 * Interactive web terminal attached to WS /api/terminal/ws.
 *
 * - mode=shell → persistent tmux 'webterm' shell at the repo root
 * - mode=soren → live agent session view
 *
 * No auto-reconnect by design: on close a red message is written into the
 * terminal and a floating Reconnect button is shown (the shell itself
 * persists server-side in tmux).
 */
export function WebTerminal({ active }: WebTerminalProps) {
  const isMobile = useIsMobile();
  const terminalMode = useTerminalStore((s) => s.terminalMode);
  const setTerminalMode = useTerminalStore((s) => s.setTerminalMode);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<number>();
  const fitRafRef = useRef<number>();
  const activeRef = useRef(active);
  const prevModeRef = useRef<TerminalMode | null>(null);
  // Sockets we closed on purpose (mode switch / unmount / manual reconnect):
  // their onclose must not paint the disconnect UX.
  const intentionallyClosedRef = useRef(new WeakSet<WebSocket>());

  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [closeCode, setCloseCode] = useState<number | null>(null);

  // P5.7: in-terminal search (Ctrl/Cmd+F while the terminal has focus).
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [matchInfo, setMatchInfo] = useState<{ index: number; count: number } | null>(null);
  const { fontSize, increaseFontSize, decreaseFontSize } = useTerminalSettingsStore();

  // attachCustomKeyEventHandler is registered once at mount (see below) — it
  // needs a ref, not the searchOpen state value directly, or its closure
  // would only ever see searchOpen's value from that first render.
  useEffect(() => {
    searchOpenRef.current = searchOpen;
  }, [searchOpen]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchRef.current?.clearDecorations();
    setMatchInfo(null);
    termRef.current?.focus();
  }, []);

  const runSearch = useCallback((direction: 'next' | 'previous') => {
    const search = searchRef.current;
    if (!search || !searchQuery) return;
    const opts = {
      decorations: {
        matchBackground: '#3f3f46',
        matchBorder: '#71717a',
        matchOverviewRuler: '#71717a',
        activeMatchBackground: '#f0a030',
        activeMatchBorder: '#f0a030',
        activeMatchColorOverviewRuler: '#f0a030',
      },
    };
    if (direction === 'next') search.findNext(searchQuery, opts);
    else search.findPrevious(searchQuery, opts);
  }, [searchQuery]);

  // Fit the terminal to its container and report the new size to the PTY.
  const fitAndReport = useCallback(() => {
    const container = containerRef.current;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!container || !term || !fit) return;
    // Skip while hidden (display:none) — xterm can't measure a 0x0 box.
    // The ResizeObserver fires again on re-show and fits with real bounds.
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    fit.fit();
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }, []);

  const scheduleFit = useCallback(() => {
    if (fitRafRef.current !== undefined) cancelAnimationFrame(fitRafRef.current);
    fitRafRef.current = requestAnimationFrame(() => {
      fitRafRef.current = undefined;
      fitAndReport();
    });
  }, [fitAndReport]);

  // Mobile on-screen key row (MOBILE_KEYS) sends through this exact same
  // channel term.onData uses below for real keystrokes — from the PTY's
  // side there is no difference between this and a physical key press.
  // Re-focusing afterward matters: these are real DOM buttons, so tapping
  // one would otherwise blur xterm's hidden input and dismiss the on-screen
  // keyboard along with it.
  const sendRaw = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
    termRef.current?.focus();
  }, []);

  const closeSocket = useCallback(() => {
    if (pingRef.current !== undefined) {
      window.clearInterval(pingRef.current);
      pingRef.current = undefined;
    }
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      intentionallyClosedRef.current.add(ws);
      ws.close(1000);
    }
  }, []);

  const openSocket = useCallback(
    (mode: TerminalMode) => {
      closeSocket();
      const term = termRef.current;
      if (!term) return;

      setStatus('connecting');
      setCloseCode(null);

      const token = useAuthStore.getState().token ?? localStorage.getItem('soren_token');
      const params = new URLSearchParams();
      if (token) params.set('token', token);
      params.set('mode', mode);
      const ws = new WebSocket(`${TERMINAL_WS_URL}?${params.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        setStatus('connected');
        // Covers reconnect: re-fit and tell the fresh PTY its dimensions.
        fitAndReport();
        if (activeRef.current) term.focus();
        pingRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, TERMINAL_PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        try {
          const frame = JSON.parse(event.data as string);
          if (frame.type === 'output' && typeof frame.data === 'string') {
            term.write(frame.data);
          } else if (frame.type === 'ready') {
            const readyMode = typeof frame.mode === 'string' ? frame.mode : mode;
            term.write(
              `\x1b[2m[${readyMode}] ready — tmux attach -t soren inside shell mode\x1b[0m\r\n`
            );
            // The PTY exists now; make sure it has our current dimensions.
            fitAndReport();
          }
          // frame.type === 'pong' → keepalive ack, nothing to do
        } catch {
          // Ignore malformed frames
        }
      };

      ws.onclose = (event) => {
        if (pingRef.current !== undefined) {
          window.clearInterval(pingRef.current);
          pingRef.current = undefined;
        }
        if (intentionallyClosedRef.current.has(ws)) return;
        if (wsRef.current === ws) wsRef.current = null;
        setStatus('closed');
        setCloseCode(event.code);
        term.write(`\r\n\x1b[31m${closeMessage(event.code)}\x1b[0m\r\n`);
      };

      ws.onerror = () => {
        // onclose always follows; UX handled there.
      };
    },
    [closeSocket, fitAndReport]
  );

  // Create the xterm instance once, on mount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initial = useTerminalSettingsStore.getState();
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: MONO_FONT_STACK,
      fontSize: initial.fontSize,
      scrollback: initial.scrollback,
      theme: TERM_THEME,
      // SearchAddon's match-highlight decorations (P5.7) are a "proposed"
      // (not yet stabilized) xterm API — omitting this crashes the whole
      // terminal with "You must set the allowProposedApi option to true"
      // the moment a search actually runs a decorated find.
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    const searchResultsDisposable = search.onDidChangeResults(({ resultIndex, resultCount }) => {
      setMatchInfo({ index: resultIndex, count: resultCount });
    });

    term.open(container);

    // Ctrl+` is the app-level terminal toggle (registered in the Header) —
    // don't let xterm swallow it or type a backtick into the PTY. Ctrl/Cmd+F
    // opens the in-terminal search bar instead of the browser's native find
    // (only intercepted while xterm itself has focus, so page-level find
    // still works everywhere else).
    term.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Backquote') {
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && event.type === 'keydown') {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return false;
      }
      if (event.key === 'Escape' && event.type === 'keydown' && searchOpenRef.current) {
        closeSearch();
        return false;
      }
      return true;
    });

    const dataDisposable = term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Initial fit + refit whenever the container resizes (panel drags,
    // window resizes, re-show after display:none).
    scheduleFit();
    const observer = new ResizeObserver(() => scheduleFit());
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (fitRafRef.current !== undefined) {
        cancelAnimationFrame(fitRafRef.current);
        fitRafRef.current = undefined;
      }
      dataDisposable.dispose();
      searchResultsDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, [scheduleFit, closeSearch]);

  // Find-as-you-type: re-run the search on every keystroke (incremental
  // mode expands/contracts the current match instead of always jumping to
  // the next occurrence, matching typical editor find-bar behavior).
  useEffect(() => {
    if (!searchOpen) return;
    const search = searchRef.current;
    if (!search) return;
    if (!searchQuery) {
      search.clearDecorations();
      setMatchInfo(null);
      return;
    }
    search.findNext(searchQuery, {
      incremental: true,
      decorations: {
        matchBackground: '#3f3f46',
        matchBorder: '#71717a',
        matchOverviewRuler: '#71717a',
        activeMatchBackground: '#f0a030',
        activeMatchBorder: '#f0a030',
        activeMatchColorOverviewRuler: '#f0a030',
      },
    });
  }, [searchQuery, searchOpen]);

  // Connect on mount and reconnect whenever the mode changes.
  useEffect(() => {
    // Switching shell↔soren: clear the screen so the two sessions' output
    // doesn't interleave (tmux redraws on attach anyway).
    if (prevModeRef.current !== null && prevModeRef.current !== terminalMode) {
      termRef.current?.reset();
    }
    prevModeRef.current = terminalMode;
    openSocket(terminalMode);
    return () => closeSocket();
  }, [terminalMode, openSocket, closeSocket]);

  // Re-fit and focus when the terminal becomes visible again.
  useEffect(() => {
    activeRef.current = active;
    if (active) {
      scheduleFit();
      termRef.current?.focus();
    }
  }, [active, scheduleFit]);

  // Live font-size updates (P5.7) — xterm supports changing options on an
  // existing instance, so this avoids tearing down and recreating the
  // terminal (which would lose scrollback/PTY continuity) just to resize
  // text. Re-fit afterward since a new font size changes how many
  // cols/rows fit the same pixel box, and the PTY needs to know.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    scheduleFit();
  }, [fontSize, scheduleFit]);

  const statusDot = (
    <span
      className={cn(
        'h-2 w-2 rounded-full shrink-0',
        status === 'connected' && 'bg-green-500',
        status === 'connecting' && 'animate-pulse motion-reduce:animate-none bg-yellow-500',
        status === 'closed' && 'bg-red-500'
      )}
    />
  );

  const modeSwitcher = (mobile: boolean) => (
    <div className={cn(
      'flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-900 p-0.5 font-mono',
      mobile ? 'text-[11px]' : 'text-xs'
    )}>
      <button
        type="button"
        onClick={() => setTerminalMode('shell')}
        className={cn(
          'rounded px-2 py-0.5 transition-colors',
          terminalMode === 'shell'
            ? 'bg-zinc-700 text-zinc-100'
            : 'text-zinc-400 hover:text-zinc-300'
        )}
      >
        Shell
      </button>
      <button
        type="button"
        onClick={() => setTerminalMode('soren')}
        className={cn(
          'rounded px-2 py-0.5 transition-colors',
          terminalMode === 'soren'
            ? 'bg-zinc-700 text-zinc-100'
            : 'text-zinc-400 hover:text-zinc-300'
        )}
      >
        {mobile ? 'Soren' : 'Soren session'}
      </button>
    </div>
  );

  const searchButton = (
    <button
      type="button"
      onClick={() => {
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }}
      title="Search terminal (Ctrl+F)"
      aria-pressed={searchOpen}
      className={cn(
        'rounded-md border border-zinc-800 bg-zinc-900 p-1 shrink-0',
        searchOpen ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-300'
      )}
    >
      <Search className="h-3 w-3" />
    </button>
  );

  return (
    <div className="relative flex h-full flex-col bg-zinc-950">
      {/* Panel header: status + mode switcher. Mobile drops the "terminal"/
          mode-description labels and the inline font-size stepper (still
          reachable via Settings) entirely — there's only room for the
          essentials: connection dot, Shell/Soren toggle, search. */}
      {isMobile ? (
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-zinc-800 px-2">
          {statusDot}
          {modeSwitcher(true)}
          {searchButton}
        </div>
      ) : (
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 px-3">
          <div className="flex items-center gap-2 font-mono text-xs text-zinc-400">
            {statusDot}
            <span>terminal</span>
            <span className="text-zinc-400">
              {terminalMode === 'shell' ? 'tmux: webterm' : 'live agent session'}
            </span>
          </div>
          {modeSwitcher(false)}

          {/* Font size + search (P5.7) */}
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
              <button
                type="button"
                onClick={decreaseFontSize}
                title="Decrease font size"
                className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="w-6 text-center font-mono text-[10px] text-zinc-400">{fontSize}</span>
              <button
                type="button"
                onClick={increaseFontSize}
                title="Increase font size"
                className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            {searchButton}
          </div>
        </div>
      )}

      {/* xterm mounts here; FitAddon sizes off this box, so keep it padding-free */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />

      {/* Mobile on-screen key row — Ctrl+C/Esc/Tab/arrows aren't reachable
          any other way from a phone's on-screen keyboard. Horizontally
          scrollable as a safety net (it shouldn't need to scroll at
          practical phone widths, but never clip a key if it somehow
          doesn't fit rather than making it unreachable). Sits directly
          above wherever the OS keyboard appears since it's the last flex
          child in this column, right below the terminal content. */}
      {isMobile && (
        <div
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-zinc-800 bg-zinc-900 px-2 py-1.5"
          style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
        >
          {MOBILE_KEYS.map((key) => (
            <button
              key={key.label}
              type="button"
              title={key.title}
              // Prevent the button's own focus from stealing it away from
              // xterm's hidden input — that hidden input is what the OS
              // keyboard is actually attached to, and losing focus there
              // would dismiss the keyboard on every single tap.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => sendRaw(key.data)}
              className="shrink-0 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-300 active:bg-zinc-800"
            >
              {key.label}
            </button>
          ))}
        </div>
      )}

      {/* In-terminal search bar (P5.7) — replaces the browser's native find
          while the terminal has focus (see attachCustomKeyEventHandler). */}
      {searchOpen && (
        <div className="absolute right-3 top-11 z-20 flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1 shadow-lg">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch(e.shiftKey ? 'previous' : 'next');
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSearch();
              }
            }}
            placeholder="find in terminal"
            className="h-6 w-40 bg-transparent font-mono text-xs text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
          />
          {matchInfo && (
            <span className="font-mono text-[10px] text-zinc-400">
              {matchInfo.count === 0 ? '0/0' : `${matchInfo.index + 1}/${matchInfo.count}`}
            </span>
          )}
          <button
            type="button"
            onClick={() => runSearch('previous')}
            title="Previous match (Shift+Enter)"
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => runSearch('next')}
            title="Next match (Enter)"
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            title="Close (Esc)"
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Disconnect overlay — manual reconnect only, never automatic */}
      {status === 'closed' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/60">
          <div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-6 py-4 shadow-lg">
            <p className="font-mono text-sm text-zinc-300">
              {closeMessage(closeCode ?? 1006)}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="gap-2"
              onClick={() => openSocket(terminalMode)}
            >
              <RotateCw className="h-3.5 w-3.5" />
              Reconnect
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
