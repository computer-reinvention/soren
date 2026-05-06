import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Filter } from 'lucide-react';
import type { ActivityType } from '@/types/activity';

interface ActivityFiltersProps {
  activeFilters: ActivityType[];
  onFiltersChange: (filters: ActivityType[]) => void;
}

const allFilters: { value: ActivityType; label: string }[] = [
  { value: 'tool_call', label: 'Tool Calls' },
  { value: 'message_sent', label: 'Messages Sent' },
  { value: 'message_received', label: 'Messages Received' },
  { value: 'status_change', label: 'Status Changes' },
  { value: 'webhook_received', label: 'Webhooks' },
  { value: 'user_message', label: 'User Messages' },
];

export function ActivityFilters({ activeFilters, onFiltersChange }: ActivityFiltersProps) {
  const toggleFilter = (filter: ActivityType) => {
    if (activeFilters.includes(filter)) {
      onFiltersChange(activeFilters.filter((f) => f !== filter));
    } else {
      onFiltersChange([...activeFilters, filter]);
    }
  };

  const hasFilters = activeFilters.length > 0 && activeFilters.length < allFilters.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6 relative">
          <Filter className="h-3.5 w-3.5" />
          {hasFilters && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-primary rounded-full" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {allFilters.map((filter) => (
          <DropdownMenuCheckboxItem
            key={filter.value}
            checked={activeFilters.length === 0 || activeFilters.includes(filter.value)}
            onCheckedChange={() => toggleFilter(filter.value)}
          >
            {filter.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
