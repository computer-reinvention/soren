import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight, Calendar, FileText, BookOpen } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { FileTreeItem } from './FileTree';

interface JournalTreeProps {
  journalFolder: FileTreeItem;
  onFileSelect?: (item: FileTreeItem) => void;
  selectedPath?: string;
}

interface MonthGroup {
  key: string; // e.g., "2026-02"
  label: string; // e.g., "February 2026"
  dates: FileTreeItem[];
}

// Get today's date in YYYY-MM-DD format using local timezone
function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Parse date from folder name (YYYY-MM-DD)
function parseDate(name: string): Date | null {
  const match = name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
}

// Get month key from date folder name
function getMonthKey(name: string): string {
  const parts = name.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return name;
}

// Format month key to display label
function formatMonthLabel(key: string): string {
  const [year, month] = key.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Format date for display (e.g., "Mon 3" for February 3rd)
function formatDateLabel(name: string): string {
  const date = parseDate(name);
  if (!date) return name;
  const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
  const dayNum = date.getDate();
  return `${dayName} ${dayNum}`;
}

export function JournalTree({ journalFolder, onFileSelect, selectedPath }: JournalTreeProps) {
  const today = getTodayString();
  const currentMonthKey = today.substring(0, 7); // YYYY-MM

  // Group dates by month, sorted in reverse chronological order
  const monthGroups = useMemo((): MonthGroup[] => {
    if (!journalFolder.children) return [];

    // Filter to only date directories (YYYY-MM-DD format)
    const dateFolders = journalFolder.children.filter(
      item => item.type === 'directory' && parseDate(item.name)
    );

    // Group by month
    const groups = new Map<string, FileTreeItem[]>();
    for (const folder of dateFolders) {
      const monthKey = getMonthKey(folder.name);
      if (!groups.has(monthKey)) {
        groups.set(monthKey, []);
      }
      groups.get(monthKey)!.push(folder);
    }

    // Sort dates within each group (most recent first)
    for (const [, dates] of groups) {
      dates.sort((a, b) => b.name.localeCompare(a.name));
    }

    // Convert to array and sort by month (most recent first)
    return Array.from(groups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, dates]) => ({
        key,
        label: formatMonthLabel(key),
        dates,
      }));
  }, [journalFolder.children]);

  // Handle non-date items (like attachments folder at root level)
  const otherItems = useMemo(() => {
    if (!journalFolder.children) return [];
    return journalFolder.children.filter(
      item => item.type !== 'directory' || !parseDate(item.name)
    );
  }, [journalFolder.children]);

  if (monthGroups.length === 0 && otherItems.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        No journal entries yet
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {/* Month groups */}
      {monthGroups.map((group) => (
        <MonthGroupItem
          key={group.key}
          group={group}
          isCurrentMonth={group.key === currentMonthKey}
          today={today}
          onFileSelect={onFileSelect}
          selectedPath={selectedPath}
        />
      ))}

      {/* Other items (non-date folders or files) */}
      {otherItems.map((item) => (
        <JournalFileItem
          key={item.path}
          item={item}
          onFileSelect={onFileSelect}
          selectedPath={selectedPath}
          level={0}
        />
      ))}
    </div>
  );
}

interface MonthGroupItemProps {
  group: MonthGroup;
  isCurrentMonth: boolean;
  today: string;
  onFileSelect?: (item: FileTreeItem) => void;
  selectedPath?: string;
}

function MonthGroupItem({
  group,
  isCurrentMonth,
  today,
  onFileSelect,
  selectedPath,
}: MonthGroupItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            'w-full flex items-center gap-1.5 px-2 py-1 text-sm rounded-md transition-colors text-left',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            isCurrentMonth && 'text-blue-600 dark:text-blue-400 font-medium'
          )}
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform flex-shrink-0',
              isOpen && 'rotate-90'
            )}
          />
          <BookOpen className={cn(
            'h-4 w-4 flex-shrink-0',
            isCurrentMonth ? 'text-blue-600 dark:text-blue-400' : 'text-amber-700 dark:text-amber-500'
          )} />
          <span className="truncate flex-1">{group.label}</span>
          <span className="text-xs text-muted-foreground">{group.dates.length}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-2">
        {group.dates.map((dateFolder) => (
          <DateFolderItem
            key={dateFolder.path}
            item={dateFolder}
            isToday={dateFolder.name === today}
            onFileSelect={onFileSelect}
            selectedPath={selectedPath}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface DateFolderItemProps {
  item: FileTreeItem;
  isToday: boolean;
  onFileSelect?: (item: FileTreeItem) => void;
  selectedPath?: string;
}

function DateFolderItem({
  item,
  isToday,
  onFileSelect,
  selectedPath,
}: DateFolderItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasChildren = item.children && item.children.length > 0;
  const dateLabel = formatDateLabel(item.name);

  if (!hasChildren) {
    return (
      <button
        className={cn(
          'w-full flex items-center gap-1.5 pl-6 pr-2 py-1 text-sm rounded-md transition-colors text-left',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-muted-foreground'
        )}
      >
        <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="truncate">{dateLabel}</span>
        <span className="text-[10px] ml-auto opacity-50">(empty)</span>
      </button>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            'w-full flex items-center gap-1.5 pl-4 pr-2 py-1 text-sm rounded-md transition-colors text-left',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            isToday && 'text-green-700 dark:text-green-400 font-medium'
          )}
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 text-muted-foreground transition-transform flex-shrink-0',
              isOpen && 'rotate-90'
            )}
          />
          <Calendar className={cn(
            'h-3.5 w-3.5 flex-shrink-0',
            isToday ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'
          )} />
          <span className="truncate flex-1">{dateLabel}</span>
          {isToday && (
            <span className="text-[10px] text-green-700 dark:text-green-400 font-medium">TODAY</span>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-2">
        {item.children?.map((child) => (
          <JournalFileItem
            key={child.path}
            item={child}
            onFileSelect={onFileSelect}
            selectedPath={selectedPath}
            level={1}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface JournalFileItemProps {
  item: FileTreeItem;
  onFileSelect?: (item: FileTreeItem) => void;
  selectedPath?: string;
  level: number;
}

function JournalFileItem({
  item,
  onFileSelect,
  selectedPath,
  level,
}: JournalFileItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isSelected = selectedPath === item.path;
  const isDirectory = item.type === 'directory';
  const indent = 24 + level * 12; // Base indent + level offset

  if (isDirectory) {
    return (
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button
            style={{ paddingLeft: `${indent}px` }}
            className={cn(
              'w-full flex items-center gap-1.5 pr-2 py-1 text-sm rounded-md transition-colors text-left',
              'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            )}
          >
            <ChevronRight
              className={cn(
                'h-3 w-3 text-muted-foreground transition-transform flex-shrink-0',
                isOpen && 'rotate-90'
              )}
            />
            <span className="truncate">{item.name}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {item.children?.map((child) => (
            <JournalFileItem
              key={child.path}
              item={child}
              onFileSelect={onFileSelect}
              selectedPath={selectedPath}
              level={level + 1}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <button
      onClick={() => onFileSelect?.(item)}
      style={{ paddingLeft: `${indent + 12}px` }}
      className={cn(
        'w-full flex items-center gap-1.5 pr-2 py-1 text-sm rounded-md transition-colors text-left',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        isSelected && 'bg-sidebar-accent text-sidebar-accent-foreground'
      )}
    >
      <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <span className="truncate">{item.name}</span>
    </button>
  );
}
