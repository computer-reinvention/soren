import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight, File, Folder, FileText, Loader2 } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { api } from '@/lib/api';

export interface FileTreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeItem[];
}

interface FileTreeProps {
  items: FileTreeItem[];
  onFileSelect?: (item: FileTreeItem) => void;
  selectedPath?: string;
}

function getFileIcon(name: string, type: 'file' | 'directory') {
  if (type === 'directory') return Folder;
  if (name.endsWith('.md') || name.endsWith('.log')) return FileText;
  return File;
}

export function FileTree({ items, onFileSelect, selectedPath }: FileTreeProps) {
  return (
    <div className="space-y-0.5">
      {items.map((item) => (
        <FileTreeNode
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

interface FileTreeNodeProps {
  item: FileTreeItem;
  onFileSelect?: (item: FileTreeItem) => void;
  selectedPath?: string;
  level: number;
}

function FileTreeNode({ item, onFileSelect, selectedPath, level }: FileTreeNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<FileTreeItem[] | undefined>(item.children);
  const [loading, setLoading] = useState(false);
  const Icon = getFileIcon(item.name, item.type);
  const isSelected = selectedPath === item.path;
  const isDirectory = item.type === 'directory';
  const indent = level * 12;

  const handleToggle = useCallback(async (open: boolean) => {
    setIsOpen(open);
    // Lazy-load children if directory is opened and has no children yet
    if (open && isDirectory && (!children || children.length === 0)) {
      setLoading(true);
      try {
        const result = await api.getFilesystem(item.path);
        setChildren(result.items);
      } catch {
        // silently fail — folder just stays empty
      } finally {
        setLoading(false);
      }
    }
  }, [isDirectory, children, item.path]);

  if (isDirectory) {
    return (
      <Collapsible open={isOpen} onOpenChange={handleToggle}>
        <CollapsibleTrigger asChild>
          <button
            style={{ paddingLeft: `${indent + 8}px` }}
            className={cn(
              'w-full flex items-center gap-1.5 pr-2 py-1 text-sm rounded-md transition-colors text-left',
              'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            )}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin motion-reduce:animate-none flex-shrink-0" />
            ) : (
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground transition-transform flex-shrink-0',
                  isOpen && 'rotate-90'
                )}
              />
            )}
            <Folder className="h-4 w-4 text-amber-700 dark:text-amber-500 flex-shrink-0" />
            <span className="truncate">{item.name}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {children?.map((child) => (
            <FileTreeNode
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
      style={{ paddingLeft: `${indent + 8 + 18}px` }}
      className={cn(
        'w-full flex items-center gap-1.5 pr-2 py-1 text-sm rounded-md transition-colors text-left',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        isSelected && 'bg-sidebar-accent text-sidebar-accent-foreground'
      )}
    >
      <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <span className="truncate">{item.name}</span>
    </button>
  );
}
