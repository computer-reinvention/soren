import { useConnectionStore } from '@/stores/connectionStore';
import { cn } from '@/lib/utils';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';

export function ConnectionIndicator() {
  const { isConnected, isReconnecting } = useConnectionStore();

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'w-2 h-2 rounded-full',
          isConnected ? 'bg-green-500' : 'bg-red-500',
          isReconnecting && 'animate-pulse bg-yellow-500'
        )}
      />
      {isReconnecting ? (
        <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
      ) : isConnected ? (
        <Wifi className="h-4 w-4 text-green-500" />
      ) : (
        <WifiOff className="h-4 w-4 text-red-500" />
      )}
      <span className="text-sm">
        {isReconnecting
          ? 'Reconnecting...'
          : isConnected
          ? 'Connected'
          : 'Disconnected'}
      </span>
    </div>
  );
}
