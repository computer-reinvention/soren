import { ArrowDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/** Shared feed chrome for ChatMessages/InboxView. */

export function LoadingMoreRow({ visible }: { visible?: boolean }) {
  if (!visible) return null;
  return (
    <div className="flex items-center justify-center py-2">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
      <span className="ml-2 text-xs text-muted-foreground">Loading older messages...</span>
    </div>
  );
}

export function ScrollToBottomButton({
  unreadCount,
  isNearBottom,
  onClick,
}: {
  unreadCount: number;
  isNearBottom: boolean;
  onClick: () => void;
}) {
  if (unreadCount <= 0 || isNearBottom) return null;
  return (
    <div className="absolute bottom-4 right-4 z-10">
      <Button
        variant="secondary"
        size="icon"
        onClick={onClick}
        className="relative h-10 w-10 rounded-full shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
        aria-label={`scroll to bottom, ${unreadCount} unread`}
      >
        <ArrowDown className="h-5 w-5" aria-hidden />
        <Badge
          variant="destructive"
          className="absolute -top-2 -right-2 h-5 min-w-5 px-1.5 flex items-center justify-center"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </Badge>
      </Button>
    </div>
  );
}
