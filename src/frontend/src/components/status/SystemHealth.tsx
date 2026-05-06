import { useAgentStore } from '@/stores/agentStore';
import { useActivityStore } from '@/stores/activityStore';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

export function SystemHealth() {
  const { agents } = useAgentStore();
  const { activities } = useActivityStore();

  const stats = {
    total: agents.length,
    active: agents.filter((a) => a.status === 'IN_PROGRESS').length,
    complete: agents.filter((a) => a.status === 'COMPLETE').length,
    blocked: agents.filter((a) => a.status === 'BLOCKED').length,
    failed: agents.filter((a) => a.status === 'FAILED').length,
    recentActivities: activities.slice(0, 10).length,
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">System Health</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Agents</span>
            <span className="font-medium">{stats.total}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Active</span>
            <Badge variant="default" className="h-5">
              {stats.active}
            </Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Complete</span>
            <Badge variant="secondary" className="h-5 bg-green-500 text-white">
              {stats.complete}
            </Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Blocked</span>
            <Badge variant="secondary" className="h-5 bg-red-500 text-white">
              {stats.blocked}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
