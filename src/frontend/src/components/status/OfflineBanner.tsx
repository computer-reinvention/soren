import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useConnectionStore } from '@/stores/connectionStore';

/**
 * P4.3: connection-status visibility. StatusBar (desktop) shows a
 * "Connected"/"Disconnected" dot, but it's easy to miss and — since
 * MobileNav replaced StatusBar on mobile (P4.1) — mobile had NO connection
 * indicator at all. This banner is rendered at Layout level so it's visible
 * everywhere, on every viewport.
 *
 * A short delay before showing avoids a flash on normal page load (the
 * WebSocket briefly reports disconnected/reconnecting before its first
 * successful open, which is not something worth alarming the user about).
 */
const SHOW_DELAY_MS = 1500;

export function OfflineBanner() {
  const isConnected = useConnectionStore((s) => s.isConnected);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isConnected) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isConnected]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center justify-center gap-2 bg-amber-500 px-3 py-1 font-mono text-[11px] font-medium text-black"
    >
      <WifiOff className="h-3 w-3 shrink-0" aria-hidden />
      offline — reconnecting, some data may be stale
    </div>
  );
}
