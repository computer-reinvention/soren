import { cn } from '@/lib/utils';
import { Badge } from '../ui/badge';
import type { Activity } from '@/types/activity';

interface ActivityItemProps {
  activity: Activity;
}

const typeColors: Record<Activity['type'], string> = {
  tool_call: 'border-l-blue-500',
  message_sent: 'border-l-green-500',
  message_received: 'border-l-purple-500',
  status_change: 'border-l-yellow-500',
  webhook_received: 'border-l-orange-500',
  user_message: 'border-l-pink-500',
  mailbox_message: 'border-l-cyan-500',
  heartbeat: 'border-l-red-500',
};

export function ActivityItem({ activity }: ActivityItemProps) {
  const time = new Date(activity.timestamp).toLocaleTimeString();

  return (
    <div className={cn(
      'p-2 border-l-2 bg-card rounded text-xs',
      typeColors[activity.type]
    )}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] h-5">
            {activity.agent_id}
          </Badge>
          <span className="text-muted-foreground capitalize">
            {activity.type.replace('_', ' ')}
          </span>
        </div>
        <span className="text-muted-foreground">{time}</span>
      </div>
      <div className="text-muted-foreground truncate">
        {getActivitySummary(activity)}
      </div>
    </div>
  );
}

function getActivitySummary(activity: Activity): string {
  switch (activity.type) {
    case 'tool_call':
      return activity.data?.tool_name
        ? `Tool: ${activity.data.tool_name}`
        : 'Tool executed';
    case 'user_message':
      return String(activity.data?.content || 'Message sent').slice(0, 100);
    case 'message_sent':
      return String(activity.data?.content || 'Message').slice(0, 100);
    case 'mailbox_message': {
      const from = activity.data?.from_agent || 'unknown';
      const to = activity.data?.to_agent || 'unknown';
      const content = String(activity.data?.content || '').slice(0, 60);
      return `${from} → ${to}: ${content}`;
    }
    case 'webhook_received':
      return `From: ${activity.data?.source || 'external'}`;
    case 'status_change':
      return `Status: ${activity.data?.status || 'changed'}`;
    case 'heartbeat': {
      if (activity.data?.highest_priority) return String(activity.data.highest_priority);
      const sections = activity.data?.sections as Record<string, string> | undefined;
      if (sections) {
        const keys = Object.keys(sections).filter((k) => sections[k]);
        if (keys.length > 0) return keys.join(', ');
      }
      return 'System alert';
    }
    default:
      return activity.type;
  }
}
