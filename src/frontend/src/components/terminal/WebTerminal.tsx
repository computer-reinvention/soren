import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TERMINAL_WS_URL, TERMINAL_PING_INTERVAL } from '@/lib/constants';
import { useAuthStore } from '@/stores/authStore';
import { useTerminalStore, type TerminalMode } from '@/stores/terminalStore';

type ConnectionStatus = 'connecting' | 'connected' | 'closed';

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
  const terminalMode = useTerminalStore((s) => s.terminalMode);
  const setTerminalMode = useTerminalStore((s) => s.setTerminalMode);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
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

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: MONO_FONT_STACK,
      fontSize: 13,
      scrollback: 5000,
      theme: TERM_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    term.open(container);

    // Ctrl+` is the app-level terminal toggle (registered in the Header) —
    // don't let xterm swallow it or type a backtick into the PTY.
    term.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Backquote') {
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
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [scheduleFit]);

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

  return (
    <div className="relative flex h-full flex-col bg-zinc-950">
      {/* Panel header: status + mode switcher */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 px-3">
        <div className="flex items-center gap-2 font-mono text-xs text-zinc-400">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              status === 'connected' && 'bg-green-500',
              status === 'connecting' && 'animate-pulse bg-yellow-500',
              status === 'closed' && 'bg-red-500'
            )}
          />
          <span>terminal</span>
          <span className="text-zinc-600">
            {terminalMode === 'shell' ? 'tmux: webterm' : 'live agent session'}
          </span>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-900 p-0.5 font-mono text-xs">
          <button
            type="button"
            onClick={() => setTerminalMode('shell')}
            className={cn(
              'rounded px-2 py-0.5 transition-colors',
              terminalMode === 'shell'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
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
                : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            Soren session
          </button>
        </div>
      </div>

      {/* xterm mounts here; FitAddon sizes off this box, so keep it padding-free */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />

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
