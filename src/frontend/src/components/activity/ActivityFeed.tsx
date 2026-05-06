import { useActivity } from '@/hooks/useActivity';
import { ActivityItem } from './ActivityItem';
import { ScrollArea } from '../ui/scroll-area';

export function ActivityFeed() {
  const { activities } = useActivity();

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg">Activity</h2>
        <p className="text-sm text-muted-foreground">
          {activities.length} events
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {activities.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">
              No activity yet. Events will appear here as agents work.
            </p>
          ) : (
            activities.slice(0, 50).map((activity) => (
              <ActivityItem key={activity.id} activity={activity} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
